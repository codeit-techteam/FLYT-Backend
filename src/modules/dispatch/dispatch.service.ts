import { AvailabilityStatus, RideOfferStatus, RideStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { getRedis } from '../../config/redis';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';
import { canTransition } from '../../common/constants/ride';
import { matchingService } from '../matching/matching.service';
import { getSocketGateway } from '../../config/socket';
import { enqueueOfferExpiry } from '../../infrastructure/queues/ride.queue';
import { logger } from '../../config/logger';

export class DispatchService {
  async startDispatch(rideId: string): Promise<void> {
    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        customer: { include: { modeSetting: true } },
        serviceCategory: true,
      },
    });

    if (!ride) throw AppError.notFound('Ride not found');
    if (ride.status !== RideStatus.REQUESTED && ride.status !== RideStatus.SEARCHING) {
      throw AppError.conflict(`Cannot dispatch ride in status ${ride.status}`);
    }

    if (ride.status === RideStatus.REQUESTED) {
      await this.transition(rideId, RideStatus.SEARCHING, 'system');
    }

    const redis = getRedis();
    const attemptKey = `dispatch:attempts:${rideId}`;
    const attempts = Number((await redis.get(attemptKey)) ?? 0);

    if (attempts >= env().DISPATCH_MAX_RETRIES) {
      await this.transition(rideId, RideStatus.NO_PILOT_FOUND, 'system');
      getSocketGateway()?.emitToCustomer(ride.customerId, 'customer:ride:status', {
        rideId,
        status: RideStatus.NO_PILOT_FOUND,
      });
      return;
    }

    await redis.incr(attemptKey);
    await redis.expire(attemptKey, 3600);

    const sheRulesApply = ride.mode === 'SHE';
    const candidates = await matchingService.findCandidates({
      pickup: { lat: Number(ride.pickupLat), lng: Number(ride.pickupLng) },
      mode: ride.mode,
      sheRulesApply,
      sheFallbackPolicy:
        ride.customer.modeSetting?.sheFallbackPolicy ?? 'FAIL_WITH_MESSAGE',
      vehicleCategoryId: ride.serviceCategory.vehicleCategoryId,
    });

    // Exclude pilots already offered this ride
    const priorOffers = await prisma.rideOffer.findMany({
      where: { rideId },
      select: { pilotId: true },
    });
    const offeredIds = new Set(priorOffers.map((o) => o.pilotId));
    const next = candidates.find((c) => !offeredIds.has(c.pilotId));

    if (!next) {
      if (attempts + 1 >= env().DISPATCH_MAX_RETRIES) {
        await this.transition(rideId, RideStatus.NO_PILOT_FOUND, 'system');
        getSocketGateway()?.emitToCustomer(ride.customerId, 'customer:ride:status', {
          rideId,
          status: RideStatus.NO_PILOT_FOUND,
        });
      } else {
        // Schedule retry via queue
        const { enqueueDispatchRetry } = await import('../../infrastructure/queues/ride.queue');
        await enqueueDispatchRetry(rideId, 5);
      }
      return;
    }

    const expiresAt = new Date(Date.now() + env().DISPATCH_OFFER_TIMEOUT_SECONDS * 1000);

    const offer = await prisma.$transaction(async (tx) => {
      await tx.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.OFFERED },
      });

      await tx.rideEvent.create({
        data: {
          rideId,
          type: 'OFFER_CREATED',
          actorType: 'system',
          payload: { pilotId: next.pilotId, score: next.score },
        },
      });

      return tx.rideOffer.create({
        data: {
          rideId,
          pilotId: next.pilotId,
          status: RideOfferStatus.PENDING,
          score: next.score,
          distanceM: next.distanceM,
          etaSeconds: next.etaSeconds,
          expiresAt,
        },
      });
    });

    await enqueueOfferExpiry(offer.id, env().DISPATCH_OFFER_TIMEOUT_SECONDS);

    getSocketGateway()?.emitToPilot(next.pilotId, 'pilot:ride:offer', {
      offerId: offer.id,
      rideId,
      expiresAt,
      pickup: { lat: Number(ride.pickupLat), lng: Number(ride.pickupLng), address: ride.pickupAddress },
      drop: { lat: Number(ride.dropLat), lng: Number(ride.dropLng), address: ride.dropAddress },
      estimatedFare: Number(ride.estimatedFare),
      mode: ride.mode,
      etaSeconds: next.etaSeconds,
      distanceM: next.distanceM,
    });

    getSocketGateway()?.emitToCustomer(ride.customerId, 'customer:ride:status', {
      rideId,
      status: RideStatus.OFFERED,
    });

    getSocketGateway()?.emitToAdmin('admin:dispatch:update', {
      rideId,
      offerId: offer.id,
      pilotId: next.pilotId,
      status: 'OFFERED',
    });

    logger.info({ rideId, offerId: offer.id, pilotId: next.pilotId }, 'Ride offer dispatched');
  }

  async acceptOffer(offerId: string, pilotId: string): Promise<{ rideId: string }> {
    return prisma.$transaction(async (tx) => {
      const offer = await tx.rideOffer.findUnique({
        where: { id: offerId },
        include: { ride: true },
      });

      if (!offer || offer.pilotId !== pilotId) {
        throw AppError.notFound('Offer not found');
      }
      if (offer.status !== RideOfferStatus.PENDING) {
        throw AppError.conflict(`Offer is ${offer.status}`);
      }
      if (offer.expiresAt < new Date()) {
        await tx.rideOffer.update({
          where: { id: offerId },
          data: { status: RideOfferStatus.EXPIRED, respondedAt: new Date() },
        });
        throw AppError.conflict('Offer has expired');
      }

      // Atomic assignment — prevent duplicate pilots
      const updated = await tx.ride.updateMany({
        where: {
          id: offer.rideId,
          pilotId: null,
          status: { in: [RideStatus.OFFERED, RideStatus.SEARCHING] },
        },
        data: {
          pilotId,
          status: RideStatus.ACCEPTED,
          acceptedAt: new Date(),
        },
      });

      if (updated.count !== 1) {
        throw new AppError(
          'Ride already assigned to another pilot',
          409,
          'DUPLICATE_ASSIGNMENT',
        );
      }

      await tx.rideOffer.update({
        where: { id: offerId },
        data: { status: RideOfferStatus.ACCEPTED, respondedAt: new Date() },
      });

      // Cancel other pending offers
      await tx.rideOffer.updateMany({
        where: {
          rideId: offer.rideId,
          id: { not: offerId },
          status: RideOfferStatus.PENDING,
        },
        data: { status: RideOfferStatus.CANCELLED, respondedAt: new Date() },
      });

      await tx.pilotAvailability.update({
        where: { pilotId },
        data: { status: AvailabilityStatus.BUSY },
      });

      const vehicle = await tx.vehicle.findFirst({
        where: { pilotId, status: 'ACTIVE', isPrimary: true },
      });
      if (vehicle) {
        await tx.ride.update({
          where: { id: offer.rideId },
          data: { vehicleId: vehicle.id },
        });
      }

      await tx.rideEvent.create({
        data: {
          rideId: offer.rideId,
          type: 'OFFER_ACCEPTED',
          actorType: 'pilot',
          actorId: pilotId,
        },
      });

      const pilot = await tx.pilot.findUnique({
        where: { id: pilotId },
        include: { vehicles: { where: { isPrimary: true }, take: 1 } },
      });

      // Emit outside transaction via setImmediate to avoid holding locks
      setImmediate(() => {
        const gateway = getSocketGateway();
        gateway?.emitToCustomer(offer.ride.customerId, 'customer:pilot:assigned', {
          rideId: offer.rideId,
          pilot: pilot
            ? {
                id: pilot.id,
                firstName: pilot.firstName,
                lastName: pilot.lastName,
                ratingAvg: Number(pilot.ratingAvg),
                vehicle: pilot.vehicles[0]
                  ? {
                      make: pilot.vehicles[0].make,
                      model: pilot.vehicles[0].model,
                      plateNumber: pilot.vehicles[0].plateNumber,
                      color: pilot.vehicles[0].color,
                    }
                  : null,
              }
            : null,
        });
        gateway?.emitToCustomer(offer.ride.customerId, 'customer:ride:status', {
          rideId: offer.rideId,
          status: RideStatus.ACCEPTED,
        });
        gateway?.emitToPilot(pilotId, 'pilot:ride:accepted', { rideId: offer.rideId, offerId });
        gateway?.emitToAdmin('admin:ride:update', {
          rideId: offer.rideId,
          status: RideStatus.ACCEPTED,
          pilotId,
        });
      });

      return { rideId: offer.rideId };
    });
  }

  async rejectOffer(offerId: string, pilotId: string): Promise<void> {
    const offer = await prisma.rideOffer.findUnique({ where: { id: offerId } });
    if (!offer || offer.pilotId !== pilotId) {
      throw AppError.notFound('Offer not found');
    }
    if (offer.status !== RideOfferStatus.PENDING) {
      throw AppError.conflict(`Offer is ${offer.status}`);
    }

    await prisma.rideOffer.update({
      where: { id: offerId },
      data: { status: RideOfferStatus.REJECTED, respondedAt: new Date() },
    });

    await prisma.rideEvent.create({
      data: {
        rideId: offer.rideId,
        type: 'OFFER_REJECTED',
        actorType: 'pilot',
        actorId: pilotId,
      },
    });

    getSocketGateway()?.emitToPilot(pilotId, 'pilot:ride:rejected', {
      offerId,
      rideId: offer.rideId,
    });

    // Continue dispatch
    await this.transition(offer.rideId, RideStatus.SEARCHING, 'system');
    await this.startDispatch(offer.rideId);
  }

  async expireOffer(offerId: string): Promise<void> {
    const offer = await prisma.rideOffer.findUnique({ where: { id: offerId } });
    if (!offer || offer.status !== RideOfferStatus.PENDING) return;

    await prisma.rideOffer.update({
      where: { id: offerId },
      data: { status: RideOfferStatus.EXPIRED, respondedAt: new Date() },
    });

    await prisma.rideEvent.create({
      data: {
        rideId: offer.rideId,
        type: 'OFFER_EXPIRED',
        actorType: 'system',
        payload: { offerId },
      },
    });

    const ride = await prisma.ride.findUnique({ where: { id: offer.rideId } });
    if (ride && !ride.pilotId && ride.status === RideStatus.OFFERED) {
      await this.transition(offer.rideId, RideStatus.SEARCHING, 'system');
      await this.startDispatch(offer.rideId);
    }
  }

  private async transition(
    rideId: string,
    to: RideStatus,
    actorType: string,
  ): Promise<void> {
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) return;
    if (!canTransition(ride.status, to)) {
      logger.warn({ from: ride.status, to, rideId }, 'Invalid ride transition skipped');
      return;
    }
    await prisma.ride.update({ where: { id: rideId }, data: { status: to } });
    await prisma.rideEvent.create({
      data: { rideId, type: `STATUS_${to}`, actorType },
    });
  }
}

export const dispatchService = new DispatchService();
