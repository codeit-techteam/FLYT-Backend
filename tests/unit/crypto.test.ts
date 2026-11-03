import { describe, expect, it } from 'vitest';
import { generateOtp, hashOtp, hashPassword, verifyPassword } from '../../src/common/utils/crypto';

describe('crypto utils', () => {
  it('generates numeric OTP of expected length', () => {
    const otp = generateOtp(6);
    expect(otp).toHaveLength(6);
    expect(otp).toMatch(/^\d+$/);
  });

  it('hashes OTP deterministically with phone salt', () => {
    const a = hashOtp('123456', '+919999999999');
    const b = hashOtp('123456', '+919999999999');
    const c = hashOtp('123456', '+918888888888');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('hashes and verifies passwords with argon2', async () => {
    const hash = await hashPassword('SecurePass123!');
    expect(await verifyPassword(hash, 'SecurePass123!')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});
