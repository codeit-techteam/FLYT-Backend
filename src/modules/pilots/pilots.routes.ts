import { Router } from 'express';
import { UserType } from '@prisma/client';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize } from '../../common/middleware/authenticate';
import { validateRequest } from '../../common/middleware/validateRequest';
import {
  locationSchema,
  pilotsController,
  updatePilotSchema,
} from './pilots.controller';

const locationLimiter = rateLimit({
  windowMs: 10_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

export const pilotsRouter = Router();

pilotsRouter.use(authenticate, authorize(UserType.PILOT));

pilotsRouter.get('/me', pilotsController.me);
pilotsRouter.patch(
  '/me',
  validateRequest({ body: updatePilotSchema }),
  pilotsController.updateMe,
);
pilotsRouter.post('/availability/online', pilotsController.online);
pilotsRouter.post('/availability/offline', pilotsController.offline);
pilotsRouter.post(
  '/location',
  locationLimiter,
  validateRequest({ body: locationSchema }),
  pilotsController.location,
);

export const pilotOffersRouter = Router();

pilotOffersRouter.use(authenticate, authorize(UserType.PILOT));

pilotOffersRouter.get('/offers', pilotsController.listOffers);
pilotOffersRouter.post(
  '/offers/:offerId/accept',
  validateRequest({ params: z.object({ offerId: z.string().uuid() }) }),
  pilotsController.acceptOffer,
);
pilotOffersRouter.post(
  '/offers/:offerId/reject',
  validateRequest({ params: z.object({ offerId: z.string().uuid() }) }),
  pilotsController.rejectOffer,
);
