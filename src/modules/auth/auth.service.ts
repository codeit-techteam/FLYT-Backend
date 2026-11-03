import { UserType, type User } from '@prisma/client';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';
import { generateOtp, hashOtp, hashPassword, verifyPassword } from '../../common/utils/crypto';
import { getSmsProvider } from '../../infrastructure/sms';
import { getRedis } from '../../config/redis';
import {
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from './token.service';

export class AuthService {
  async sendOtp(input: {
    phone: string;
    purpose: string;
    userType: UserType;
  }): Promise<{ expiresIn: number; cooldownSeconds: number; devOtp?: string }> {
    const phone = normalizePhone(input.phone);
    await this.enforceOtpRateLimit(phone);

    const existingPending = await prisma.otpVerification.findFirst({
      where: {
        phone,
        purpose: input.purpose,
        verifiedAt: null,
        consumedAt: null,
        createdAt: { gte: new Date(Date.now() - env().OTP_RESEND_COOLDOWN_SECONDS * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingPending) {
      throw AppError.rateLimited(
        `Please wait ${env().OTP_RESEND_COOLDOWN_SECONDS}s before requesting another OTP`,
      );
    }

    const otp = generateOtp(env().OTP_LENGTH);
    const codeHash = hashOtp(otp, phone);
    const expiresAt = new Date(Date.now() + env().OTP_EXPIRY_SECONDS * 1000);

    await prisma.otpVerification.create({
      data: {
        phone,
        purpose: input.purpose,
        codeHash,
        maxAttempts: env().OTP_MAX_ATTEMPTS,
        expiresAt,
      },
    });

    await getSmsProvider().sendOtp({ phone, otp });

    const result: { expiresIn: number; cooldownSeconds: number; devOtp?: string } = {
      expiresIn: env().OTP_EXPIRY_SECONDS,
      cooldownSeconds: env().OTP_RESEND_COOLDOWN_SECONDS,
    };

    if (env().OTP_PROVIDER === 'development' && env().NODE_ENV !== 'production') {
      result.devOtp = otp;
    }

    return result;
  }

  async verifyOtp(input: {
    phone: string;
    otp: string;
    purpose: string;
    userType: UserType;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{
    accessToken: string;
    refreshToken: string;
    user: { id: string; phone: string; userType: UserType };
    isNewUser: boolean;
  }> {
    const phone = normalizePhone(input.phone);

    const record = await prisma.otpVerification.findFirst({
      where: {
        phone,
        purpose: input.purpose,
        verifiedAt: null,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new AppError('OTP not found. Request a new one.', 400, 'OTP_INVALID');
    }

    if (record.expiresAt < new Date()) {
      throw new AppError('OTP has expired', 400, 'OTP_EXPIRED');
    }

    if (record.attempts >= record.maxAttempts) {
      throw new AppError('Maximum OTP attempts exceeded', 400, 'OTP_MAX_ATTEMPTS');
    }

    const expected = hashOtp(input.otp, phone);
    if (expected !== record.codeHash) {
      await prisma.otpVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppError('Invalid OTP', 400, 'OTP_INVALID');
    }

    await prisma.otpVerification.update({
      where: { id: record.id },
      data: { verifiedAt: new Date(), consumedAt: new Date() },
    });

    const { user, isNewUser } = await this.findOrCreateUser(phone, input.userType);

    const roles = await prisma.userRole.findMany({
      where: { userId: user.id },
      include: { role: true },
    });

    const accessToken = signAccessToken({
      sub: user.id,
      userType: user.userType,
      roles: roles.map((r) => r.role.name),
    });

    const { token: refreshToken } = await issueRefreshToken(user.id, {
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, phone: user.phone, userType: user.userType },
      isNewUser,
    };
  }

  async refresh(
    refreshToken: string,
    meta?: { userAgent?: string; ipAddress?: string },
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const rotated = await rotateRefreshToken(refreshToken, meta);
    return {
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await revokeRefreshToken(refreshToken);
  }

  async adminLogin(input: {
    email: string;
    password: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ accessToken: string; refreshToken: string; user: { id: string; email: string } }> {
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      include: {
        admin: true,
        roles: { include: { role: true } },
      },
    });

    if (!user || user.userType !== UserType.ADMIN || !user.passwordHash || !user.admin) {
      throw AppError.unauthorized('Invalid credentials');
    }

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) {
      throw AppError.unauthorized('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      throw AppError.forbidden('Account is not active');
    }

    const accessToken = signAccessToken({
      sub: user.id,
      userType: user.userType,
      roles: user.roles.map((r) => r.role.name),
    });

    const { token: refreshToken } = await issueRefreshToken(user.id, {
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email! },
    };
  }

  private async findOrCreateUser(
    phone: string,
    userType: UserType,
  ): Promise<{ user: User; isNewUser: boolean }> {
    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      if (existing.userType !== userType) {
        throw AppError.conflict(
          `Phone is already registered as ${existing.userType.toLowerCase()}`,
        );
      }
      return { user: existing, isNewUser: false };
    }

    const roleName =
      userType === UserType.CUSTOMER
        ? 'customer'
        : userType === UserType.PILOT
          ? 'pilot'
          : 'admin';

    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      throw new AppError(`Role ${roleName} is not configured`, 500, 'INTERNAL_ERROR');
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          phone,
          userType,
          roles: { create: { roleId: role.id } },
        },
      });

      if (userType === UserType.CUSTOMER) {
        await tx.customer.create({
          data: {
            userId: created.id,
            modeSetting: { create: {} },
          },
        });
      } else if (userType === UserType.PILOT) {
        await tx.pilot.create({
          data: {
            userId: created.id,
            availability: { create: {} },
            verification: { create: {} },
          },
        });
      } else if (userType === UserType.ADMIN) {
        await tx.admin.create({ data: { userId: created.id } });
      }

      return created;
    });

    return { user, isNewUser: true };
  }

  private async enforceOtpRateLimit(phone: string): Promise<void> {
    if (env().NODE_ENV === 'test') return;

    const redis = getRedis();
    const key = `otp:rate:${phone}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, Math.ceil(env().RATE_LIMIT_WINDOW_MS / 1000));
    }
    if (count > env().OTP_RATE_LIMIT_MAX) {
      throw AppError.rateLimited('OTP rate limit exceeded');
    }
  }
}

export const authService = new AuthService();

export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.length === 10) return `+91${trimmed}`;
  return `+${trimmed.replace(/^\+/, '')}`;
}

export { hashPassword };
