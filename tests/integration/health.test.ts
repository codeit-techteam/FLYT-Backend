import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadEnv } from '../../src/config/env';
import { connectDatabase, disconnectDatabase } from '../../src/config/database';
import { connectRedis, disconnectRedis } from '../../src/config/redis';
import { createApp } from '../../src/app';

const app = createApp();

describe('Health & infrastructure', () => {
  beforeAll(async () => {
    loadEnv();
    await connectDatabase();
    await connectRedis();
  });

  afterAll(async () => {
    await disconnectRedis();
    await disconnectDatabase();
  });

  it('responds on /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.checks.database).toBe(true);
    expect(res.body.data.checks.redis).toBe(true);
  });

  it('exposes OpenAPI docs', async () => {
    const res = await request(app).get('/openapi.yaml');
    expect(res.status).toBe(200);
    expect(res.text).toContain('FLYT Mobility API');
  });
});
