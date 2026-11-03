import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ExperienceMode, Gender } from '@prisma/client';
import { AppError } from '../../common/errors/AppError';
import { sendSuccess } from '../../common/utils/response';
import { customersService } from './customers.service';

export const updateCustomerSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  gender: z.nativeEnum(Gender).optional(),
  dateOfBirth: z.string().date().optional(),
  experience: z.nativeEnum(ExperienceMode).optional(),
  preferredMode: z.nativeEnum(ExperienceMode).optional(),
});

export const emergencyContactSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(10).max(20),
  relation: z.string().max(64).optional(),
  isPrimary: z.boolean().optional(),
});

export class CustomersController {
  me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.customerId) throw AppError.forbidden();
      sendSuccess(res, await customersService.getMe(req.user.customerId));
    } catch (error) {
      next(error);
    }
  };

  updateMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.customerId) throw AppError.forbidden();
      sendSuccess(res, await customersService.updateMe(req.user.customerId, req.body));
    } catch (error) {
      next(error);
    }
  };

  listEmergencyContacts = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user?.customerId) throw AppError.forbidden();
      sendSuccess(res, await customersService.listEmergencyContacts(req.user.customerId));
    } catch (error) {
      next(error);
    }
  };

  addEmergencyContact = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user?.customerId) throw AppError.forbidden();
      sendSuccess(
        res,
        await customersService.addEmergencyContact(req.user.customerId, req.body),
        201,
      );
    } catch (error) {
      next(error);
    }
  };
}

export const customersController = new CustomersController();
