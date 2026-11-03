import { createServer } from 'http';
import { loadEnv, env } from './config/env';
import { logger } from './config/logger';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { createApp } from './app';
import { initSocketGateway, getSocketGateway } from './config/socket';

async function bootstrap(): Promise<void> {
  loadEnv();

  await connectDatabase();
  await connectRedis();

  const app = createApp();
  const httpServer = createServer(app);
  initSocketGateway(httpServer);

  const port = env().PORT;
  httpServer.listen(port, () => {
    logger.info(
      {
        port,
        env: env().NODE_ENV,
        docs: `${env().API_BASE_URL}/docs`,
      },
      'FLYT API server started',
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Graceful shutdown initiated');
    httpServer.close(async () => {
      try {
        await getSocketGateway()?.close();
        await disconnectRedis();
        await disconnectDatabase();
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
