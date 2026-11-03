import { CancelledBy, RideStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../common/errors/AppError';
import { canTransition } from '../../common/constants/ride';
import { generateRideNumber } from '../../common/utils/crypto';
import { pricingService } from '../pricing/pricing.service';
import { dispatchService } from '../dispatch/dispatch.service';
import { getSocketGateway } from '../../config/socket';
import type { ExperienceMode } from '@prisma/client';

export class BookingsService {
  async createQuote(
    customerId: string,
    input: {
      serviceCategoryId: string;
      pickup: { lat: number; lng: number; address?: string };
      drop: { lat: number; lng: number; address?: string };
      mode?: ExperienceMode;
      idempotencyKey?: string;
    },
  ) {
    return pricingService.quote({
      customerId,
      serviceCategoryId: input.serviceCategoryId,
      pickup: input.pickup,
      drop: input.drop,
      mode: input.mode,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async createRide(
    customerId: string,
    input: { quoteId: string; paymentMethod: 'RAZORPAY' | 'CASH'; idempotencyKey?: string },
  ) {
    if (input.idempotencyKey) {
      const existing = await prisma.ride.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return this.getRide(existing.id, customerId);
    }

    const quote = await prisma.fareQuote.findUnique({
      where: { id: input.quoteId },
      include: { breakdown: true, ride: true },
    });

    if (!quote || quote.customerId !== customerId) {
      throw AppError.notFound('Fare quote not found');
    }
    if (quote.expiresAt < new Date()) {
      throw AppError.badRequest('Fare quote has expired');
    }
    if (quote.ride) {
      throw AppError.conflict('Ride already created for this quote');
    }

    // Ensure customer has no active ride
    const active = await prisma.ride.findFirst({
      where: {
        customerId,
        status: {
          in: [
            RideStatus.REQUESTED,
            RideStatus.SEARCHING,
            RideStatus.OFFERED,
            RideStatus.ACCEPTED,
            RideStatus.ARRIVED,
            RideStatus.IN_PROGRESS,
          ],
        },
      },
    });
    if (active) {
      throw AppError.conflict('Customer already has an active ride');
    }

    const ride = await prisma.$transaction(async (tx) => {
      const created = await tx.ride.create({
        data: {
          rideNumber: generateRideNumber(),
          customerId,
          serviceCategoryId: quote.serviceCategoryId,
          fareQuoteId: quote.id,
          status: RideStatus.REQUESTED,
          mode: quote.mode,
          pickupLat: quote.pickupLat,
          pickupLng: quote.pickupLng,
          dropLat: quote.dropLat,
          dropLng: quote.dropLng,
          distanceKm: quote.distanceKm,
          durationMinutes: quote.durationMinutes,
          estimatedFare: quote.estimatedFare,
          idempotencyKey: input.idempotencyKey,
        },
      });

      await tx.rideEvent.create({
        data: {
          rideId: created.id,
          type: 'RIDE_CREATED',
          actorType: 'customer',
          actorId: customerId,
          payload: { paymentMethod: input.paymentMethod },
        },
      });

      return created;
    });

    getSocketGateway()?.emitToCustomer(customerId, 'customer:ride:created', {
      rideId: ride.id,
      rideNumber: ride.rideNumber,
      status: ride.status,
    });

    // Kick off matching asynchronously
    setImmediate(() => {
      void dispatchService.startDispatch(ride.id).catch(() => undefined);
    });

    return this.getRide(ride.id, customerId);
  }

  async getRide(rideId: string, requesterId?: string, role?: 'customer' | 'pilot' | 'admin') {
    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        pilot: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            ratingAvg: true,
            avatarUrl: true,
            user: { select: { phone: true } },
          },
        },
        vehicle: true,
        serviceCategory: true,
        fareQuote: { include: { breakdown: true } },
        cancellation: true,
        payment: true,
        commission: true,
        offers: { orderBy: { createdAt: 'desc' }, take: 10 },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!ride) throw AppError.notFound('Ride not found');

    if (role === 'customer' && ride.customerId !== requesterId) {
      throw AppError.forbidden();
    }
    if (role === 'pilot' && ride.pilotId !== requesterId) {
      throw AppError.forbidden();
    }

    return ride;
  }

  async cancelRide(
    rideId: string,
    actor: { customerId?: string; pilotId?: string; adminId?: string },
    reason?: { reasonCode?: string; reasonText?: string },
  ) {
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw AppError.notFound('Ride not found');

    if (actor.customerId && ride.customerId !== actor.customerId) {
      throw AppError.forbidden();
    }
    if (actor.pilotId && ride.pilotId !== actor.pilotId) {
      throw AppError.forbidden();
    }

    if (!canTransition(ride.status, RideStatus.CANCELLED)) {
      throw new AppError(
        `Cannot cancel ride in status ${ride.status}`,
        409,
        'INVALID_STATE_TRANSITION',
      );
    }

    const cancelledBy: CancelledBy = actor.adminId
      ? CancelledBy.ADMIN
      : actor.pilotId
        ? CancelledBy.PILOT
        : CancelledBy.CUSTOMER;

    await prisma.$transaction(async (tx) => {
      await tx.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.CANCELLED, cancelledAt: new Date() },
      });

      await tx.rideCancellation.create({
        data: {
          rideId,
          cancelledBy,
          reasonCode: reason?.reasonCode,
          reasonText: reason?.reasonText,
        },
      });

      await tx.rideOffer.updateMany({
        where: { rideId, status: 'PENDING' },
        data: { status: 'CANCELLED', respondedAt: new Date() },
      });

      if (ride.pilotId) {
        await tx.pilotAvailability.update({
          where: { pilotId: ride.pilotId },
          data: { status: 'ONLINE' },
        });
      }

      await tx.rideEvent.create({
        data: {
          rideId,
          type: 'RIDE_CANCELLED',
          actorType: cancelledBy.toLowerCase(),
          payload: reason,
        },
      });
    });

    const gateway = getSocketGateway();
    gateway?.emitToCustomer(ride.customerId, 'customer:ride:cancelled', { rideId });
    if (ride.pilotId) {
      gateway?.emitToPilot(ride.pilotId, 'pilot:ride:cancelled', { rideId });
    }
    gateway?.emitToAdmin('admin:ride:update', { rideId, status: RideStatus.CANCELLED });

    return this.getRide(rideId);
  }
}

export const bookingsService = new BookingsService();
