import type { ConnectionOptions } from 'bullmq';
import { env } from '../../config/env';

export function getBullConnection(): ConnectionOptions {
  const url = new URL(env().REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || env().REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  };
}
