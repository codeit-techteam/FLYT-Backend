import { Router } from 'express';
import { UserType } from '@prisma/client';
import { authenticate, authorize } from '../../common/middleware/authenticate';
import { adminController } from './admin.controller';

export const adminRouter = Router();

adminRouter.use(authenticate, authorize(UserType.ADMIN));

adminRouter.get('/dashboard', adminController.dashboard);
adminRouter.get('/rides', adminController.rides);
adminRouter.get('/rides/:rideId', adminController.rideDetail);
adminRouter.get('/pilots', adminController.pilots);
adminRouter.get('/customers', adminController.customers);
adminRouter.get('/payments', adminController.payments);
