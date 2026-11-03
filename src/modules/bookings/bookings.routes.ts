import { Router } from 'express';
import { UserType } from '@prisma/client';
import { authenticate, authorize } from '../../common/middleware/authenticate';
import { validateRequest } from '../../common/middleware/validateRequest';
import { bookingsController } from './bookings.controller';
import {
  cancelRideSchema,
  createRideSchema,
  quoteSchema,
  rideIdParams,
} from './bookings.schemas';

export const bookingsRouter = Router();

bookingsRouter.use(authenticate);

bookingsRouter.post(
  '/quote',
  authorize(UserType.CUSTOMER),
  validateRequest({ body: quoteSchema }),
  bookingsController.quote,
);

bookingsRouter.post(
  '/',
  authorize(UserType.CUSTOMER),
  validateRequest({ body: createRideSchema }),
  bookingsController.create,
);

bookingsRouter.get(
  '/:rideId',
  validateRequest({ params: rideIdParams }),
  bookingsController.get,
);

bookingsRouter.post(
  '/:rideId/cancel',
  validateRequest({ params: rideIdParams, body: cancelRideSchema }),
  bookingsController.cancel,
);
