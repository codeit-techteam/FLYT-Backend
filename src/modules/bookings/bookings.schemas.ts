import { z } from 'zod';
import { ExperienceMode } from '@prisma/client';

const coords = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(500).optional(),
});

export const quoteSchema = z.object({
  serviceCategoryId: z.string().uuid(),
  pickup: coords,
  drop: coords,
  mode: z.nativeEnum(ExperienceMode).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const createRideSchema = z.object({
  quoteId: z.string().uuid(),
  paymentMethod: z.enum(['RAZORPAY', 'CASH']).default('RAZORPAY'),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const cancelRideSchema = z.object({
  reasonCode: z.string().max(64).optional(),
  reasonText: z.string().max(500).optional(),
});

export const rideIdParams = z.object({
  rideId: z.string().uuid(),
});

export const offerIdParams = z.object({
  offerId: z.string().uuid(),
});
