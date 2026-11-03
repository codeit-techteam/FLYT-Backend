import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  API_BASE_URL: z.string().url().default('http://localhost:5000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),

  REDIS_URL: z.string().min(1),
  REDIS_PASSWORD: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  OTP_EXPIRY_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_PROVIDER: z.enum(['development', 'msg91']).default('development'),

  MSG91_AUTH_KEY: z.string().optional().default(''),
  MSG91_SENDER_ID: z.string().optional().default(''),
  MSG91_TEMPLATE_ID: z.string().optional().default(''),

  GOOGLE_MAPS_API_KEY: z.string().optional().default(''),
  MAPS_PROVIDER: z.enum(['development', 'google']).default('development'),

  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
  PAYMENT_PROVIDER: z.enum(['development', 'razorpay']).default('development'),

  FIREBASE_PROJECT_ID: z.string().optional().default(''),
  FIREBASE_CLIENT_EMAIL: z.string().optional().default(''),
  FIREBASE_PRIVATE_KEY: z.string().optional().default(''),
  PUSH_PROVIDER: z.enum(['development', 'firebase']).default('development'),

  R2_ACCOUNT_ID: z.string().optional().default(''),
  R2_ACCESS_KEY_ID: z.string().optional().default(''),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(''),
  R2_BUCKET_NAME: z.string().optional().default('flyt-private'),
  R2_ENDPOINT: z.string().optional().default(''),
  R2_PUBLIC_BASE_URL: z.string().optional().default(''),
  STORAGE_PROVIDER: z.enum(['development', 'r2']).default('development'),

  MATCHING_RADIUS_METERS: z.coerce.number().positive().default(5000),
  MATCHING_WEIGHT_ETA: z.coerce.number().default(0.4),
  MATCHING_WEIGHT_DISTANCE: z.coerce.number().default(0.2),
  MATCHING_WEIGHT_ELIGIBILITY: z.coerce.number().default(0.15),
  MATCHING_WEIGHT_AVAILABILITY: z.coerce.number().default(0.15),
  MATCHING_WEIGHT_QUALITY: z.coerce.number().default(0.1),
  DISPATCH_OFFER_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
  DISPATCH_MAX_RETRIES: z.coerce.number().int().positive().default(5),
  LOCATION_STALE_SECONDS: z.coerce.number().int().positive().default(60),

  SILVER_DISCOUNT_PERCENT: z.coerce.number().min(0).max(100).default(10),
  DEFAULT_COMMISSION_PERCENT: z.coerce.number().min(0).max(100).default(20),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  OTP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),

  SOCKET_PING_INTERVAL: z.coerce.number().int().positive().default(25_000),
  SOCKET_PING_TIMEOUT: z.coerce.number().int().positive().default(20_000),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.OTP_PROVIDER === 'msg91' && !parsed.data.MSG91_AUTH_KEY) {
      throw new Error('MSG91_AUTH_KEY is required when OTP_PROVIDER=msg91 in production');
    }
    if (parsed.data.PAYMENT_PROVIDER === 'razorpay' && !parsed.data.RAZORPAY_KEY_ID) {
      throw new Error('RAZORPAY credentials required when PAYMENT_PROVIDER=razorpay in production');
    }
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function env(): Env {
  if (!cachedEnv) {
    return loadEnv();
  }
  return cachedEnv;
}

export function corsOrigins(): string[] {
  return env()
    .CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
