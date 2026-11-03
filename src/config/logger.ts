import pino from 'pino';
import { env } from './env';

const isDev = () => {
  try {
    return env().NODE_ENV !== 'production';
  } catch {
    return process.env.NODE_ENV !== 'production';
  }
};

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: isDev()
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'otp',
      'token',
      'accessToken',
      'refreshToken',
      'secret',
      'authorization',
    ],
    censor: '[REDACTED]',
  },
});

export type Logger = typeof logger;
