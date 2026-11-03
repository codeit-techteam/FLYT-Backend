import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { UserType } from '@prisma/client';
import { loadEnv } from '../../src/config/env';
import { connectDatabase, disconnectDatabase, prisma } from '../../src/config/database';
import { connectRedis, disconnectRedis, getRedis } from '../../src/config/redis';
import { createApp } from '../../src/app';

describe('Authentication', () => {
  const app = createApp();
  const suffix = Date.now().toString().slice(-8);

  beforeAll(async () => {
    loadEnv();
    await connectDatabase();
    await connectRedis();
    const redis = getRedis();
    const keys = await redis.keys('otp:rate:*');
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    await disconnectRedis();
    await disconnectDatabase();
  });

  it('sends and verifies OTP for customer', async () => {
    const phone = `+91970${suffix}01`;

    const send = await request(app).post('/api/v1/auth/send-otp').send({
      phone,
      userType: UserType.CUSTOMER,
    });
    expect(send.status).toBe(200);
    expect(send.body.data.devOtp).toBeDefined();

    const verify = await request(app).post('/api/v1/auth/verify-otp').send({
      phone,
      otp: send.body.data.devOtp,
      userType: UserType.CUSTOMER,
    });

    expect(verify.status).toBe(200);
    expect(verify.body.data.accessToken).toBeTruthy();
    expect(verify.body.data.refreshToken).toBeTruthy();
    expect(verify.body.data.user.userType).toBe('CUSTOMER');
  });

  it('rejects customer token on pilot routes', async () => {
    const phone = `+91970${suffix}02`;
    const send = await request(app).post('/api/v1/auth/send-otp').send({
      phone,
      userType: UserType.CUSTOMER,
    });
    expect(send.status).toBe(200);

    const verify = await request(app).post('/api/v1/auth/verify-otp').send({
      phone,
      otp: send.body.data.devOtp,
      userType: UserType.CUSTOMER,
    });
    expect(verify.status).toBe(200);

    const res = await request(app)
      .get('/api/v1/pilots/me')
      .set('Authorization', `Bearer ${verify.body.data.accessToken}`);

    expect(res.status).toBe(403);
  });

  it('logs in admin with password', async () => {
    const admin = await prisma.user.findUnique({ where: { email: 'admin@flyt.local' } });
    if (!admin) {
      return;
    }

    const res = await request(app).post('/api/v1/auth/admin/login').send({
      email: 'admin@flyt.local',
      password: 'Admin@Flyt2026!',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it('rotates and revokes refresh tokens', async () => {
    const phone = `+91970${suffix}03`;
    const send = await request(app).post('/api/v1/auth/send-otp').send({
      phone,
      userType: UserType.CUSTOMER,
    });
    expect(send.status).toBe(200);

    const verify = await request(app).post('/api/v1/auth/verify-otp').send({
      phone,
      otp: send.body.data.devOtp,
      userType: UserType.CUSTOMER,
    });
    expect(verify.status).toBe(200);

    const refresh = await request(app).post('/api/v1/auth/refresh').send({
      refreshToken: verify.body.data.refreshToken,
    });
    expect(refresh.status).toBe(200);

    const logout = await request(app).post('/api/v1/auth/logout').send({
      refreshToken: refresh.body.data.refreshToken,
    });
    expect(logout.status).toBe(200);

    const reuse = await request(app).post('/api/v1/auth/refresh').send({
      refreshToken: refresh.body.data.refreshToken,
    });
    expect(reuse.status).toBe(401);
  });
});
