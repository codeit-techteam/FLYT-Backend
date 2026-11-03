import { createHash, randomInt, randomBytes } from 'crypto';
import * as argon2 from 'argon2';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateOtp(length = 6): string {
  const max = 10 ** length;
  const min = 10 ** (length - 1);
  return String(randomInt(min, max));
}

export function hashOtp(otp: string, phone: string): string {
  return createHash('sha256').update(`${phone}:${otp}`).digest('hex');
}

export function generateSecureToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateRideNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(3).toString('hex').toUpperCase();
  return `FLT${ts}${rand}`;
}
