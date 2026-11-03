import jwt from 'jsonwebtoken';
import { UserType } from '@prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';
import { generateSecureToken, hashToken } from '../../common/utils/crypto';
import { prisma } from '../../config/database';

export interface AccessTokenPayload {
  sub: string;
  userType: UserType;
  roles: string[];
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env().JWT_ACCESS_SECRET, {
    expiresIn: env().JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env().JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch {
    throw AppError.unauthorized('Invalid or expired access token');
  }
}

export async function issueRefreshToken(
  userId: string,
  meta?: { userAgent?: string; ipAddress?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSecureToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + parseDurationMs(env().JWT_REFRESH_EXPIRES_IN));

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      userAgent: meta?.userAgent,
      ipAddress: meta?.ipAddress,
    },
  });

  return { token, expiresAt };
}

export async function rotateRefreshToken(
  rawToken: string,
  meta?: { userAgent?: string; ipAddress?: string },
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date; userId: string }> {
  const tokenHash = hashToken(rawToken);

  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          roles: { include: { role: true } },
        },
      },
    },
  });

  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    if (existing && !existing.revokedAt) {
      await prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
    }
    throw AppError.unauthorized('Invalid refresh token');
  }

  const { token: newRefresh, expiresAt } = await issueRefreshToken(existing.userId, meta);

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: {
      revokedAt: new Date(),
      replacedBy: hashToken(newRefresh),
    },
  });

  const accessToken = signAccessToken({
    sub: existing.user.id,
    userType: existing.user.userType,
    roles: existing.user.roles.map((r) => r.role.name),
  });

  return {
    accessToken,
    refreshToken: newRefresh,
    expiresAt,
    userId: existing.userId,
  };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

function parseDurationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    return 30 * 24 * 60 * 60 * 1000;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * (multipliers[unit!] ?? 86_400_000);
}
