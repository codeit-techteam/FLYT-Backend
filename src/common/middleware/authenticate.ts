import type { NextFunction, Request, Response } from 'express';
import { UserType } from '@prisma/client';
import { AppError } from '../errors/AppError';
import { verifyAccessToken } from '../../modules/auth/token.service';
import { prisma } from '../../config/database';

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw AppError.unauthorized('Missing or invalid authorization header');
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw AppError.unauthorized('Missing access token');
    }

    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: { include: { role: true } },
        customer: true,
        pilot: true,
        admin: true,
      },
    });

    if (!user || user.status !== 'ACTIVE' || user.deletedAt) {
      throw AppError.unauthorized('User is not active');
    }

    req.user = {
      id: user.id,
      userType: user.userType,
      roles: user.roles.map((r) => r.role.name),
      customerId: user.customer?.id,
      pilotId: user.pilot?.id,
      adminId: user.admin?.id,
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    next(AppError.unauthorized('Invalid or expired token'));
  }
}

export function authorize(...allowed: UserType[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(AppError.unauthorized());
      return;
    }
    if (allowed.length > 0 && !allowed.includes(req.user.userType)) {
      next(AppError.forbidden('Insufficient permissions for this resource'));
      return;
    }
    next();
  };
}

export function requireRoles(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(AppError.unauthorized());
      return;
    }
    const hasRole = roles.some((role) => req.user!.roles.includes(role));
    if (!hasRole) {
      next(AppError.forbidden('Missing required role'));
      return;
    }
    next();
  };
}
