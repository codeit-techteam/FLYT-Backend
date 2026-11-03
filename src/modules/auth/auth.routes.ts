import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validateRequest } from '../../common/middleware/validateRequest';
import { env } from '../../config/env';
import { authController } from './auth.controller';
import {
  adminLoginSchema,
  logoutSchema,
  refreshSchema,
  sendOtpSchema,
  verifyOtpSchema,
} from './auth.schemas';

const otpLimiter = rateLimit({
  windowMs: env().RATE_LIMIT_WINDOW_MS,
  max: env().OTP_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many OTP requests' } },
});

export const authRouter = Router();

const otpGuards = env().NODE_ENV === 'test' ? [] : [otpLimiter];

authRouter.post(
  '/send-otp',
  ...otpGuards,
  validateRequest({ body: sendOtpSchema }),
  authController.sendOtp,
);

authRouter.post(
  '/verify-otp',
  ...otpGuards,
  validateRequest({ body: verifyOtpSchema }),
  authController.verifyOtp,
);

authRouter.post('/refresh', validateRequest({ body: refreshSchema }), authController.refresh);

authRouter.post('/logout', validateRequest({ body: logoutSchema }), authController.logout);

authRouter.post(
  '/admin/login',
  validateRequest({ body: adminLoginSchema }),
  authController.adminLogin,
);
