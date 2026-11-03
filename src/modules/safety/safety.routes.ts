import { Router } from 'express';
import { UserType } from '@prisma/client';
import { z } from 'zod';
import { authenticate, authorize } from '../../common/middleware/authenticate';
import { validateRequest } from '../../common/middleware/validateRequest';
import { AppError } from '../../common/errors/AppError';
import { sendSuccess } from '../../common/utils/response';
import { safetyService } from './safety.service';

export const safetyRouter = Router();

safetyRouter.use(authenticate, authorize(UserType.CUSTOMER));

safetyRouter.post(
  '/sos',
  validateRequest({
    body: z.object({
      rideId: z.string().uuid().optional(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      notes: z.string().max(500).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      if (!req.user?.customerId) throw AppError.forbidden();
      sendSuccess(
        res,
        await safetyService.triggerSos({ customerId: req.user.customerId, ...req.body }),
        201,
      );
    } catch (error) {
      next(error);
    }
  },
);

safetyRouter.post(
  '/trip-share',
  validateRequest({
    body: z.object({
      rideId: z.string().uuid(),
      expiresInMinutes: z.number().int().positive().max(1440).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      if (!req.user?.customerId) throw AppError.forbidden();
      sendSuccess(
        res,
        await safetyService.createTripShare(
          req.user.customerId,
          req.body.rideId,
          req.body.expiresInMinutes,
        ),
        201,
      );
    } catch (error) {
      next(error);
    }
  },
);
