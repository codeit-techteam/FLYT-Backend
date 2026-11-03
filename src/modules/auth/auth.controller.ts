import type { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { sendSuccess } from '../../common/utils/response';

export class AuthController {
  sendOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.sendOtp(req.body);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  verifyOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.verifyOtp({
        ...req.body,
        userAgent: req.header('user-agent') ?? undefined,
        ipAddress: req.ip,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.refresh(req.body.refreshToken, {
        userAgent: req.header('user-agent') ?? undefined,
        ipAddress: req.ip,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await authService.logout(req.body.refreshToken);
      sendSuccess(res, { loggedOut: true });
    } catch (error) {
      next(error);
    }
  };

  adminLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.adminLogin({
        ...req.body,
        userAgent: req.header('user-agent') ?? undefined,
        ipAddress: req.ip,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}

export const authController = new AuthController();
