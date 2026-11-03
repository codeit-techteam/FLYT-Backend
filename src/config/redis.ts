import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

let redisClient: Redis | null = null;
let redisSubscriber: Redis | null = null;
let redisPublisher: Redis | null = null;

function createRedis(url: string, label: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  client.on('connect', () => logger.info({ label }, 'Redis connecting'));
  client.on('ready', () => logger.info({ label }, 'Redis ready'));
  client.on('error', (err) => logger.error({ err, label }, 'Redis error'));
  client.on('close', () => logger.warn({ label }, 'Redis connection closed'));

  return client;
}

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = createRedis(env().REDIS_URL, 'main');
  }
  return redisClient;
}

export function getRedisPubSub(): { pub: Redis; sub: Redis } {
  if (!redisPublisher) {
    redisPublisher = createRedis(env().REDIS_URL, 'pub');
  }
  if (!redisSubscriber) {
    redisSubscriber = createRedis(env().REDIS_URL, 'sub');
  }
  return { pub: redisPublisher, sub: redisSubscriber };
}

export async function connectRedis(): Promise<void> {
  const client = getRedis();
  if (client.status === 'wait' || client.status === 'end') {
    await client.connect();
  }
  const pong = await client.ping();
  if (pong !== 'PONG') {
    throw new Error('Redis ping failed');
  }
  logger.info('Redis connected');
}

export async function disconnectRedis(): Promise<void> {
  const clients = [redisClient, redisPublisher, redisSubscriber].filter(Boolean) as Redis[];
  await Promise.all(clients.map((c) => c.quit().catch(() => c.disconnect())));
  redisClient = null;
  redisPublisher = null;
  redisSubscriber = null;
  logger.info('Redis disconnected');
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedis();
    if (client.status !== 'ready') {
      if (client.status === 'wait') await client.connect();
    }
    return (await client.ping()) === 'PONG';
  } catch {
    return false;
  }
}
