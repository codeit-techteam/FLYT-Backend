import { Router } from 'express';
import { UserType } from '@prisma/client';
import { authenticate, authorize } from '../../common/middleware/authenticate';
import { validateRequest } from '../../common/middleware/validateRequest';
import {
  customersController,
  emergencyContactSchema,
  updateCustomerSchema,
} from './customers.controller';

export const customersRouter = Router();

customersRouter.use(authenticate, authorize(UserType.CUSTOMER));

customersRouter.get('/me', customersController.me);
customersRouter.patch(
  '/me',
  validateRequest({ body: updateCustomerSchema }),
  customersController.updateMe,
);
customersRouter.get('/me/emergency-contacts', customersController.listEmergencyContacts);
customersRouter.post(
  '/me/emergency-contacts',
  validateRequest({ body: emergencyContactSchema }),
  customersController.addEmergencyContact,
);
