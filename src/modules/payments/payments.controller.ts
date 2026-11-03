import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors/AppError';
import { sendSuccess } from '../../common/utils/response';
import { paymentsService } from './payments.service';

export const createOrderSchema = z.object({
  rideId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const verifyPaymentSchema = z.object({
  paymentId: z.string().uuid(),
  orderId: z.string().min(3),
  providerPaymentId: z.string().min(3),
  signature: z.string().min(3),
});

export class PaymentsController {
  createOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.customerId) throw AppError.forbidden();
      const result = await paymentsService.createOrder({
        rideId: req.body.rideId,
        customerId: req.user.customerId,
        idempotencyKey: req.body.idempotencyKey,
      });
      sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  verify = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.customerId) throw AppError.forbidden();
      const result = await paymentsService.verifyPayment({
        ...req.body,
        customerId: req.user.customerId,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  webhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const signature = req.header('x-razorpay-signature') ?? '';
      const rawBody =
        typeof req.body === 'string' || Buffer.isBuffer(req.body)
          ? req.body.toString()
          : JSON.stringify(req.body);
      const result = await paymentsService.handleRazorpayWebhook(rawBody, signature);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await paymentsService.getPayment(
        req.params.paymentId!,
        req.user?.userType === 'CUSTOMER' ? req.user.customerId : undefined,
      );
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}

export const paymentsController = new PaymentsController();
