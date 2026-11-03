import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { Gender } from '@prisma/client';
import { AppError } from '../../common/errors/AppError';
import { sendSuccess } from '../../common/utils/response';
import { pilotsService } from './pilots.service';
import { dispatchService } from '../dispatch/dispatch.service';

export const updatePilotSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  gender: z.nativeEnum(Gender).optional(),
  city: z.string().max(100).optional(),
});

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
  speedMps: z.number().min(0).optional(),
  accuracyM: z.number().min(0).optional(),
});

export class PilotsController {
  me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      sendSuccess(res, await pilotsService.getMe(req.user.pilotId));
    } catch (error) {
      next(error);
    }
  };

  updateMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      sendSuccess(res, await pilotsService.updateMe(req.user.pilotId, req.body));
    } catch (error) {
      next(error);
    }
  };

  online = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      sendSuccess(res, await pilotsService.goOnline(req.user.pilotId));
    } catch (error) {
      next(error);
    }
  };

  offline = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      sendSuccess(res, await pilotsService.goOffline(req.user.pilotId));
    } catch (error) {
      next(error);
    }
  };

  location = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      sendSuccess(res, await pilotsService.updateLocation(req.user.pilotId, req.body));
    } catch (error) {
      next(error);
    }
  };

  listOffers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      sendSuccess(res, await pilotsService.listOffers(req.user.pilotId));
    } catch (error) {
      next(error);
    }
  };

  acceptOffer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      sendSuccess(
        res,
        await dispatchService.acceptOffer(req.params.offerId!, req.user.pilotId),
      );
    } catch (error) {
      next(error);
    }
  };

  rejectOffer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      await dispatchService.rejectOffer(req.params.offerId!, req.user.pilotId);
      sendSuccess(res, { rejected: true });
    } catch (error) {
      next(error);
    }
  };
}

export const pilotsController = new PilotsController();
