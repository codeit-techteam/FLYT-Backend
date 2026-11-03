import { Router } from 'express';
import { UserType } from '@prisma/client';
import { z } from 'zod';
import { authenticate, authorize } from '../../common/middleware/authenticate';
import { validateRequest } from '../../common/middleware/validateRequest';
import {
  createOrderSchema,
  paymentsController,
  verifyPaymentSchema,
} from './payments.controller';

export const paymentsRouter = Router();

paymentsRouter.post('/webhooks/razorpay', paymentsController.webhook);

paymentsRouter.use(authenticate);

paymentsRouter.post(
  '/create-order',
  authorize(UserType.CUSTOMER),
  validateRequest({ body: createOrderSchema }),
  paymentsController.createOrder,
);

paymentsRouter.post(
  '/verify',
  authorize(UserType.CUSTOMER),
  validateRequest({ body: verifyPaymentSchema }),
  paymentsController.verify,
);

paymentsRouter.get(
  '/:paymentId',
  validateRequest({ params: z.object({ paymentId: z.string().uuid() }) }),
  paymentsController.get,
);
