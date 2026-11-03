import { Queue } from 'bullmq';
import { getBullConnection } from './connection';

export const NOTIFICATION_QUEUE = 'notification-jobs';

let notificationQueue: Queue | null = null;

export function getNotificationQueue(): Queue {
  if (!notificationQueue) {
    notificationQueue = new Queue(NOTIFICATION_QUEUE, {
      connection: getBullConnection(),
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    });
  }
  return notificationQueue;
}

export async function enqueuePush(input: {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<void> {
  await getNotificationQueue().add('push', input, {
    jobId: `push:${input.userId}:${Date.now()}`,
  });
}
