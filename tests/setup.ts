import { beforeAll } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.PORT = process.env.PORT ?? '5001';
  process.env.API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:5001';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    'postgresql://flyt:flyt_secret@localhost:5432/flyt_db?schema=public';
  process.env.DIRECT_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  process.env.REDIS_URL =
    process.env.REDIS_URL ?? 'redis://:flyt_redis_secret@localhost:6379';
  process.env.JWT_ACCESS_SECRET =
    process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-min-32-characters!!';
  process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-min-32-characters!';
  process.env.OTP_PROVIDER = 'development';
  process.env.PAYMENT_PROVIDER = 'development';
  process.env.MAPS_PROVIDER = 'development';
  process.env.PUSH_PROVIDER = 'development';
  process.env.STORAGE_PROVIDER = 'development';
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  process.env.LOG_LEVEL = 'error';
});
