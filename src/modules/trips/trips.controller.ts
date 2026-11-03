import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors/AppError';
import { sendSuccess } from '../../common/utils/response';
import { tripsService } from './trips.service';

export const tripOtpSchema = z.object({
  otp: z.string().min(4).max(8),
});

export const completeTripSchema = z.object({
  actualDistanceKm: z.number().positive().optional(),
  actualDurationMinutes: z.number().positive().optional(),
  paymentMethod: z.enum(['RAZORPAY', 'CASH']).optional(),
});

export class TripsController {
  arrived = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      const result = await tripsService.markArrived(req.params.rideId!, req.user.pilotId);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  verifyOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      const result = await tripsService.verifyStartOtp(
        req.params.rideId!,
        req.user.pilotId,
        req.body.otp,
      );
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  start = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      const result = await tripsService.startTrip(
        req.params.rideId!,
        req.user.pilotId,
        req.body.otp,
      );
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  complete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.pilotId) throw AppError.forbidden();
      const result = await tripsService.completeTrip(
        req.params.rideId!,
        req.user.pilotId,
        req.body,
      );
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}

export const tripsController = new TripsController();
