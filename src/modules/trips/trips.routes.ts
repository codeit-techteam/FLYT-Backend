import { Router } from 'express';
import { UserType } from '@prisma/client';
import { z } from 'zod';
import { authenticate, authorize } from '../../common/middleware/authenticate';
import { validateRequest } from '../../common/middleware/validateRequest';
import { completeTripSchema, tripOtpSchema, tripsController } from './trips.controller';

const rideIdParams = z.object({ rideId: z.string().uuid() });

export const tripsRouter = Router();

tripsRouter.use(authenticate, authorize(UserType.PILOT));

tripsRouter.post(
  '/:rideId/arrived',
  validateRequest({ params: rideIdParams }),
  tripsController.arrived,
);

tripsRouter.post(
  '/:rideId/verify-otp',
  validateRequest({ params: rideIdParams, body: tripOtpSchema }),
  tripsController.verifyOtp,
);

tripsRouter.post(
  '/:rideId/start',
  validateRequest({ params: rideIdParams, body: tripOtpSchema }),
  tripsController.start,
);

tripsRouter.post(
  '/:rideId/complete',
  validateRequest({ params: rideIdParams, body: completeTripSchema }),
  tripsController.complete,
);
