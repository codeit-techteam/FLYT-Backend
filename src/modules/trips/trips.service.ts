import { PaymentMethod, RideStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../common/errors/AppError';
import { canTransition } from '../../common/constants/ride';
import { generateOtp, hashOtp } from '../../common/utils/crypto';
import { getSocketGateway } from '../../config/socket';
import { commissionsService } from '../commissions/commissions.service';
import { ledgerService } from '../payments/ledger.service';
import { env } from '../../config/env';

export class TripsService {
  async markArrived(rideId: string, pilotId: string) {
    const ride = await this.requirePilotRide(rideId, pilotId);
    this.assertTransition(ride.status, RideStatus.ARRIVED);

    const otp = generateOtp(env().OTP_LENGTH);
    const startOtpHash = hashOtp(otp, rideId);

    await prisma.ride.update({
      where: { id: rideId },
      data: { status: RideStatus.ARRIVED, arrivedAt: new Date(), startOtpHash },
    });

    await prisma.rideEvent.create({
      data: {
        rideId,
        type: 'PILOT_ARRIVED',
        actorType: 'pilot',
        actorId: pilotId,
      },
    });

    // Share OTP with customer only (never log OTP)
    getSocketGateway()?.emitToCustomer(ride.customerId, 'customer:ride:status', {
      rideId,
      status: RideStatus.ARRIVED,
      startOtp: env().NODE_ENV === 'development' ? otp : undefined,
      message: 'Pilot has arrived. Share your trip OTP to start.',
    });

    // Persist OTP delivery via SMS in production through notification job
    if (env().NODE_ENV === 'development') {
      // OTP included in socket payload for local testing only
    }

    return { rideId, status: RideStatus.ARRIVED, ...(env().NODE_ENV === 'development' ? { startOtp: otp } : {}) };
  }

  async verifyStartOtp(rideId: string, pilotId: string, otp: string) {
    const ride = await this.requirePilotRide(rideId, pilotId);
    if (ride.status !== RideStatus.ARRIVED) {
      throw new AppError('Ride must be ARRIVED to verify OTP', 409, 'INVALID_STATE_TRANSITION');
    }
    if (!ride.startOtpHash) {
      throw AppError.badRequest('Start OTP not issued');
    }

    const expected = hashOtp(otp, rideId);
    if (expected !== ride.startOtpHash) {
      throw new AppError('Invalid trip OTP', 400, 'OTP_INVALID');
    }

    return { verified: true };
  }

  async startTrip(rideId: string, pilotId: string, otp: string) {
    await this.verifyStartOtp(rideId, pilotId, otp);
    const ride = await this.requirePilotRide(rideId, pilotId);
    this.assertTransition(ride.status, RideStatus.IN_PROGRESS);

    await prisma.ride.update({
      where: { id: rideId },
      data: {
        status: RideStatus.IN_PROGRESS,
        startedAt: new Date(),
        startOtpHash: null,
      },
    });

    await prisma.rideEvent.create({
      data: {
        rideId,
        type: 'TRIP_STARTED',
        actorType: 'pilot',
        actorId: pilotId,
      },
    });

    getSocketGateway()?.emitToCustomer(ride.customerId, 'customer:ride:status', {
      rideId,
      status: RideStatus.IN_PROGRESS,
    });
    getSocketGateway()?.emitToPilot(pilotId, 'pilot:trip:started', { rideId });

    return { rideId, status: RideStatus.IN_PROGRESS };
  }

  async completeTrip(
    rideId: string,
    pilotId: string,
    input?: { actualDistanceKm?: number; actualDurationMinutes?: number; paymentMethod?: PaymentMethod },
  ) {
    const ride = await this.requirePilotRide(rideId, pilotId);
    this.assertTransition(ride.status, RideStatus.COMPLETED);

    const finalFare = Number(ride.estimatedFare);
    const paymentMethod = input?.paymentMethod ?? PaymentMethod.RAZORPAY;

    await prisma.$transaction(async (tx) => {
      await tx.ride.update({
        where: { id: rideId },
        data: {
          status: paymentMethod === PaymentMethod.CASH ? RideStatus.PAID : RideStatus.PAYMENT_PENDING,
          completedAt: new Date(),
          finalFare,
          distanceKm: input?.actualDistanceKm ?? ride.distanceKm,
          durationMinutes: input?.actualDurationMinutes ?? ride.durationMinutes,
        },
      });

      await tx.rideEvent.create({
        data: {
          rideId,
          type: 'TRIP_COMPLETED',
          actorType: 'pilot',
          actorId: pilotId,
          payload: { finalFare, paymentMethod },
        },
      });

      await tx.pilotAvailability.update({
        where: { pilotId },
        data: { status: 'ONLINE' },
      });

      await tx.pilot.update({
        where: { id: pilotId },
        data: { totalTrips: { increment: 1 } },
      });
    });

    const commission = await commissionsService.calculateForRide(rideId);

    if (paymentMethod === PaymentMethod.CASH) {
      await prisma.cashCollection.create({
        data: {
          rideId,
          pilotId,
          amountCollected: finalFare,
          commissionDue: commission.commissionAmount,
        },
      });
      await ledgerService.recordCashRideSettlement({
        rideId,
        fareAmount: finalFare,
        commissionAmount: Number(commission.commissionAmount),
        pilotPayable: Number(commission.pilotPayable),
      });
    }

    getSocketGateway()?.emitToCustomer(ride.customerId, 'customer:trip:completed', {
      rideId,
      finalFare,
      status: paymentMethod === PaymentMethod.CASH ? RideStatus.PAID : RideStatus.PAYMENT_PENDING,
    });
    getSocketGateway()?.emitToPilot(pilotId, 'pilot:trip:completed', {
      rideId,
      finalFare,
      pilotPayable: Number(commission.pilotPayable),
    });
    getSocketGateway()?.emitToAdmin('admin:ride:update', {
      rideId,
      status: RideStatus.COMPLETED,
    });

    return {
      rideId,
      finalFare,
      commission,
      status: paymentMethod === PaymentMethod.CASH ? RideStatus.PAID : RideStatus.PAYMENT_PENDING,
    };
  }

  private async requirePilotRide(rideId: string, pilotId: string) {
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw AppError.notFound('Ride not found');
    if (ride.pilotId !== pilotId) throw AppError.forbidden('Ride not assigned to this pilot');
    return ride;
  }

  private assertTransition(from: RideStatus, to: RideStatus): void {
    if (!canTransition(from, to)) {
      throw new AppError(
        `Invalid transition from ${from} to ${to}`,
        409,
        'INVALID_STATE_TRANSITION',
      );
    }
  }
}

export const tripsService = new TripsService();
