import { Router } from 'express';
import { UserType, type Ride, type RideOffer } from '@prisma/client';
import { z } from 'zod';
import { authenticate, authorize } from '../../common/middleware/authenticate';
import { validateRequest } from '../../common/middleware/validateRequest';
import { AppError } from '../../common/errors/AppError';
import { sendSuccess } from '../../common/utils/response';
import { prisma } from '../../config/database';
import { pilotsService } from './pilots.service';
import { dispatchService } from '../dispatch/dispatch.service';
import { tripsService } from '../trips/trips.service';
import { bookingsService } from '../bookings/bookings.service';

/**
 * Compatibility layer for FLYT-Pilot HTTP adapters (docs/DISPATCH_API.md, TRIP_LIFECYCLE_API.md).
 * Canonical REST paths remain under /pilots and /rides; these aliases preserve the Pilot app contract.
 */

const locationBody = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  recordedAt: z.string().optional(),
  heading: z.number().optional(),
  speedMps: z.number().optional(),
});

function mapRideStatus(status: string): string {
  switch (status) {
    case 'OFFERED':
      return 'offered';
    case 'ACCEPTED':
      return 'accepted';
    case 'ARRIVED':
      return 'awaiting_rider_verification';
    case 'IN_PROGRESS':
      return 'in_progress';
    case 'COMPLETED':
    case 'PAYMENT_PENDING':
    case 'PAID':
    case 'SETTLED':
      return 'completed';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return status.toLowerCase();
  }
}

function toOfferContract(
  offer: RideOffer & { ride?: Ride | null },
  ride?: Ride | null,
) {
  const r = ride ?? offer.ride;
  return {
    offerId: offer.id,
    rideId: offer.rideId,
    status: mapRideStatus(r?.status ?? 'OFFERED'),
    expiresAt: offer.expiresAt.toISOString(),
    estimatedFare: r ? Number(r.estimatedFare) : undefined,
    currency: r?.currency ?? 'INR',
    mode: r?.mode ?? 'STANDARD',
    pickup: r
      ? {
          latitude: Number(r.pickupLat),
          longitude: Number(r.pickupLng),
          address: r.pickupAddress,
        }
      : undefined,
    drop: r
      ? {
          latitude: Number(r.dropLat),
          longitude: Number(r.dropLng),
          address: r.dropAddress,
        }
      : undefined,
    etaSeconds: offer.etaSeconds,
    distanceM: offer.distanceM ? Number(offer.distanceM) : undefined,
    score: offer.score ? Number(offer.score) : undefined,
  };
}

async function loadRideContract(rideId: string, pilotId: string) {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: {
      customer: { select: { firstName: true, lastName: true } },
      vehicle: true,
      fareQuote: { include: { breakdown: true } },
      commission: true,
    },
  });
  if (!ride || ride.pilotId !== pilotId) {
    throw AppError.forbidden('Ride not assigned to this pilot');
  }

  return {
    offerId: ride.id,
    rideId: ride.id,
    status: mapRideStatus(ride.status),
    estimatedFare: Number(ride.estimatedFare),
    finalFare: ride.finalFare != null ? Number(ride.finalFare) : undefined,
    currency: ride.currency,
    mode: ride.mode,
    pickup: {
      latitude: Number(ride.pickupLat),
      longitude: Number(ride.pickupLng),
      address: ride.pickupAddress,
    },
    drop: {
      latitude: Number(ride.dropLat),
      longitude: Number(ride.dropLng),
      address: ride.dropAddress,
    },
    customerName: [ride.customer.firstName, ride.customer.lastName].filter(Boolean).join(' ') || 'Customer',
    fareBreakdown: ride.fareQuote?.breakdown
      ? {
          base: Number(ride.fareQuote.breakdown.baseFare),
          distance: Number(ride.fareQuote.breakdown.distanceCharge),
          time: Number(ride.fareQuote.breakdown.timeCharge),
          discount: Number(ride.fareQuote.breakdown.discountAmount),
          total: Number(ride.fareQuote.breakdown.total),
        }
      : undefined,
    pilotPayable: ride.commission ? Number(ride.commission.pilotPayable) : undefined,
  };
}

export const pilotCompatRouter = Router();

pilotCompatRouter.use(authenticate, authorize(UserType.PILOT));

pilotCompatRouter.post('/dispatch/online', async (req, res, next) => {
  try {
    if (!req.user?.pilotId) throw AppError.forbidden();
    const body = locationBody.partial({ latitude: true, longitude: true }).parse(req.body ?? {});
    const result = await pilotsService.goOnline(req.user.pilotId);
    if (body.latitude != null && body.longitude != null) {
      await pilotsService.updateLocation(req.user.pilotId, {
        latitude: body.latitude,
        longitude: body.longitude,
      });
    }
    sendSuccess(res, {
      confirmed: true,
      sessionId: req.user.pilotId,
      message: null,
      status: result.status,
    });
  } catch (error) {
    next(error);
  }
});

pilotCompatRouter.post('/dispatch/offline', async (req, res, next) => {
  try {
    if (!req.user?.pilotId) throw AppError.forbidden();
    await pilotsService.goOffline(req.user.pilotId);
    sendSuccess(res, { confirmed: true });
  } catch (error) {
    next(error);
  }
});

pilotCompatRouter.get('/dispatch/availability', async (req, res, next) => {
  try {
    if (!req.user?.pilotId) throw AppError.forbidden();
    const me = await pilotsService.getMe(req.user.pilotId);
    sendSuccess(res, {
      online: me.availability?.status === 'ONLINE' || me.availability?.status === 'BUSY',
      sessionId: req.user.pilotId,
      dispatchMode: 'standard',
      updatedAt: me.availability?.updatedAt?.toISOString() ?? new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

pilotCompatRouter.post(
  '/dispatch/location',
  validateRequest({ body: locationBody }),
  async (req, res, next) => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      await pilotsService.updateLocation(req.user.pilotId, req.body);
      sendSuccess(res, { updated: true });
    } catch (error) {
      next(error);
    }
  },
);

pilotCompatRouter.get('/dispatch/offers/pending', async (req, res, next) => {
  try {
    if (!req.user?.pilotId) throw AppError.forbidden();
    const offers = await prisma.rideOffer.findMany({
      where: {
        pilotId: req.user.pilotId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      include: { ride: true },
      orderBy: { createdAt: 'desc' },
    });
    sendSuccess(res, { offers: offers.map((o) => toOfferContract(o, o.ride)) });
  } catch (error) {
    next(error);
  }
});

pilotCompatRouter.get('/dispatch/current-ride', async (req, res, next) => {
  try {
    if (!req.user?.pilotId) throw AppError.forbidden();
    const ride = await prisma.ride.findFirst({
      where: {
        pilotId: req.user.pilotId,
        status: { in: ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] },
      },
      orderBy: { updatedAt: 'desc' },
    });
    sendSuccess(res, {
      ride: ride ? await loadRideContract(ride.id, req.user.pilotId) : null,
    });
  } catch (error) {
    next(error);
  }
});

pilotCompatRouter.post(
  '/dispatch/offers/accept',
  validateRequest({ body: z.object({ offerId: z.string().uuid() }) }),
  async (req, res, next) => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      const { rideId } = await dispatchService.acceptOffer(req.body.offerId, req.user.pilotId);
      sendSuccess(res, { ride: await loadRideContract(rideId, req.user.pilotId) });
    } catch (error) {
      next(error);
    }
  },
);

pilotCompatRouter.post(
  '/dispatch/offers/decline',
  validateRequest({ body: z.object({ offerId: z.string().uuid() }) }),
  async (req, res, next) => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      await dispatchService.rejectOffer(req.body.offerId, req.user.pilotId);
      sendSuccess(res, { confirmed: true });
    } catch (error) {
      next(error);
    }
  },
);

pilotCompatRouter.post('/trips/:rideId/arrive', async (req, res, next) => {
  try {
    if (!req.user?.pilotId) throw AppError.forbidden();
    await tripsService.markArrived(req.params.rideId!, req.user.pilotId);
    sendSuccess(res, { ride: await loadRideContract(req.params.rideId!, req.user.pilotId) });
  } catch (error) {
    next(error);
  }
});

pilotCompatRouter.post(
  '/trips/:rideId/verify-otp',
  validateRequest({ body: z.object({ otp: z.string().min(4).max(8) }) }),
  async (req, res, next) => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      // Pilot app treats successful OTP as trip start
      await tripsService.startTrip(req.params.rideId!, req.user.pilotId, req.body.otp);
      sendSuccess(res, { ride: await loadRideContract(req.params.rideId!, req.user.pilotId) });
    } catch (error) {
      next(error);
    }
  },
);

pilotCompatRouter.post('/trips/:rideId/complete', async (req, res, next) => {
  try {
    if (!req.user?.pilotId) throw AppError.forbidden();
    await tripsService.completeTrip(req.params.rideId!, req.user.pilotId, {
      paymentMethod: req.body?.paymentMethod,
    });
    sendSuccess(res, { ride: await loadRideContract(req.params.rideId!, req.user.pilotId) });
  } catch (error) {
    next(error);
  }
});

pilotCompatRouter.post('/trips/:rideId/cancel', async (req, res, next) => {
  try {
    if (!req.user?.pilotId) throw AppError.forbidden();
    await bookingsService.cancelRide(
      req.params.rideId!,
      { pilotId: req.user.pilotId },
      {
        reasonCode: req.body?.reasonId,
        reasonText: req.body?.reasonLabel ?? req.body?.note,
      },
    );
    sendSuccess(res, { ride: await loadRideContract(req.params.rideId!, req.user.pilotId) });
  } catch (error) {
    next(error);
  }
});

pilotCompatRouter.get('/trips', async (req, res, next) => {
  try {
    if (!req.user?.pilotId) throw AppError.forbidden();
    const rides = await prisma.ride.findMany({
      where: { pilotId: req.user.pilotId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    sendSuccess(res, {
      trips: rides.map((r) => ({
        id: r.id,
        rideId: r.id,
        status: mapRideStatus(r.status),
        fare: Number(r.finalFare ?? r.estimatedFare),
        currency: r.currency,
        completedAt: r.completedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

pilotCompatRouter.get('/earnings', async (req, res, next) => {
  try {
    if (!req.user?.pilotId) throw AppError.forbidden();
    const period = String(req.query.period ?? 'today');
    const since = periodStart(period);
    const commissions = await prisma.commission.findMany({
      where: {
        ride: { pilotId: req.user.pilotId, completedAt: { gte: since } },
      },
      include: { ride: true },
    });
    const gross = commissions.reduce((s, c) => s + Number(c.fareAmount), 0);
    const net = commissions.reduce((s, c) => s + Number(c.pilotPayable), 0);
    sendSuccess(res, {
      label: period,
      gross,
      net,
      trips: commissions.length,
      currency: 'INR',
    });
  } catch (error) {
    next(error);
  }
});

pilotCompatRouter.get('/payouts', async (req, res, next) => {
  try {
    if (!req.user?.pilotId) throw AppError.forbidden();
    const payouts = await prisma.pilotPayout.findMany({
      where: { pilotId: req.user.pilotId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    sendSuccess(res, {
      payouts: payouts.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        currency: p.currency,
        status: p.status.toLowerCase(),
        periodStart: p.periodStart.toISOString(),
        periodEnd: p.periodEnd.toISOString(),
        processedAt: p.processedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

function periodStart(period: string): Date {
  const now = new Date();
  if (period === 'week') return new Date(now.getTime() - 7 * 86400000);
  if (period === 'month') return new Date(now.getTime() - 30 * 86400000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
