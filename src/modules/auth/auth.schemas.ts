import { z } from 'zod';
import { UserType } from '@prisma/client';

export const sendOtpSchema = z.object({
  phone: z
    .string()
    .min(10)
    .max(20)
    .regex(/^\+?[0-9]+$/, 'Phone must be digits with optional leading +'),
  purpose: z.enum(['login', 'signup', 'ride_start']).default('login'),
  userType: z.nativeEnum(UserType).default(UserType.CUSTOMER),
});

export const verifyOtpSchema = z.object({
  phone: z.string().min(10).max(20),
  otp: z.string().min(4).max(8),
  purpose: z.enum(['login', 'signup', 'ride_start']).default('login'),
  userType: z.nativeEnum(UserType).default(UserType.CUSTOMER),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(20),
});

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
