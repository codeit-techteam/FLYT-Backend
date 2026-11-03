import { Worker } from 'bullmq';
import { loadEnv } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { connectRedis, disconnectRedis } from '../config/redis';
import { logger } from '../config/logger';
import { getBullConnection } from '../infrastructure/queues/connection';
import { RIDE_QUEUE } from '../infrastructure/queues/ride.queue';
import { PAYMENT_QUEUE } from '../infrastructure/queues/payment.queue';
import { NOTIFICATION_QUEUE } from '../infrastructure/queues/notification.queue';
import { dispatchService } from '../modules/dispatch/dispatch.service';
import { paymentsService } from '../modules/payments/payments.service';
import { prisma } from '../config/database';
import { getPushProvider } from '../infrastructure/notifications';

async function main(): Promise<void> {
  loadEnv();
  await connectDatabase();
  await connectRedis();

  const connection = getBullConnection();

  const rideWorker = new Worker(
    RIDE_QUEUE,
    async (job) => {
      if (job.name === 'offer-expiry') {
        await dispatchService.expireOffer(job.data.offerId as string);
      } else if (job.name === 'dispatch-retry') {
        await dispatchService.startDispatch(job.data.rideId as string);
      } else if (job.name === 'cleanup-locations') {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        await prisma.pilotLocationHistory.deleteMany({
          where: { recordedAt: { lt: cutoff } },
        });
      }
    },
    { connection },
  );

  const paymentWorker = new Worker(
    PAYMENT_QUEUE,
    async (job) => {
      if (job.name === 'webhook-process') {
        await paymentsService.processWebhookEvent(job.data.eventId as string);
      }
    },
    { connection },
  );

  const notificationWorker = new Worker(
    NOTIFICATION_QUEUE,
    async (job) => {
      if (job.name === 'push') {
        const tokens = await prisma.deviceToken.findMany({
          where: { userId: job.data.userId as string, isActive: true },
        });
        if (tokens.length) {
          await getPushProvider().sendToTokens(
            tokens.map((t) => t.token),
            {
              title: job.data.title as string,
              body: job.data.body as string,
              data: job.data.data as Record<string, string> | undefined,
            },
          );
        }
      }
    },
    { connection },
  );

  for (const worker of [rideWorker, paymentWorker, notificationWorker]) {
    worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, name: job?.name, err }, 'Worker job failed');
    });
    worker.on('completed', (job) => {
      logger.debug({ jobId: job.id, name: job.name }, 'Worker job completed');
    });
  }

  logger.info('FLYT background workers started');

  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await Promise.all([rideWorker.close(), paymentWorker.close(), notificationWorker.close()]);
    await disconnectRedis();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  logger.error({ err }, 'Worker failed to start');
  process.exit(1);
});
