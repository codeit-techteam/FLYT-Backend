import type { UserType } from '@prisma/client';

export interface AuthUser {
  id: string;
  userType: UserType;
  roles: string[];
  customerId?: string;
  pilotId?: string;
  adminId?: string;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: AuthUser;
    }
  }
}

export {};
