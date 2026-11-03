import type { NextFunction, Request, Response } from 'express';
import { UserType } from '@prisma/client';
import { AppError } from '../../common/errors/AppError';
import { sendSuccess } from '../../common/utils/response';
import { bookingsService } from './bookings.service';

export class BookingsController {
  quote = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.customerId) throw AppError.forbidden();
      const result = await bookingsService.createQuote(req.user.customerId, req.body);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.customerId) throw AppError.forbidden();
      const result = await bookingsService.createRide(req.user.customerId, req.body);
      sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rideId = req.params.rideId!;
      let role: 'customer' | 'pilot' | 'admin' | undefined;
      let requesterId: string | undefined;

      if (req.user?.userType === UserType.CUSTOMER) {
        role = 'customer';
        requesterId = req.user.customerId;
      } else if (req.user?.userType === UserType.PILOT) {
        role = 'pilot';
        requesterId = req.user.pilotId;
      } else if (req.user?.userType === UserType.ADMIN) {
        role = 'admin';
      }

      const result = await bookingsService.getRide(rideId, requesterId, role);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await bookingsService.cancelRide(
        req.params.rideId!,
        {
          customerId: req.user?.customerId,
          pilotId: req.user?.pilotId,
          adminId: req.user?.adminId,
        },
        req.body,
      );
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}

export const bookingsController = new BookingsController();
