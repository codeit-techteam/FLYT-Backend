import type { NextFunction, Request, Response } from 'express';
import { sendSuccess } from '../../common/utils/response';
import { adminService } from './admin.service';

export class AdminController {
  dashboard = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(res, await adminService.dashboard());
    } catch (error) {
      next(error);
    }
  };

  rides = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(
        res,
        await adminService.listRides({
          status: req.query.status as string | undefined,
          page: req.query.page ? Number(req.query.page) : undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        }),
      );
    } catch (error) {
      next(error);
    }
  };

  rideDetail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(res, await adminService.getRideDetail(req.params.rideId!));
    } catch (error) {
      next(error);
    }
  };

  pilots = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(
        res,
        await adminService.listPilots({
          status: req.query.status as string | undefined,
          page: req.query.page ? Number(req.query.page) : undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        }),
      );
    } catch (error) {
      next(error);
    }
  };

  customers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(
        res,
        await adminService.listCustomers({
          page: req.query.page ? Number(req.query.page) : undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        }),
      );
    } catch (error) {
      next(error);
    }
  };

  payments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(
        res,
        await adminService.listPayments({
          page: req.query.page ? Number(req.query.page) : undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        }),
      );
    } catch (error) {
      next(error);
    }
  };
}

export const adminController = new AdminController();
