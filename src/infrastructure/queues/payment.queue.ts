import { Queue } from 'bullmq';
import { getBullConnection } from './connection';

export const PAYMENT_QUEUE = 'payment-jobs';

let paymentQueue: Queue | null = null;

export function getPaymentQueue(): Queue {
  if (!paymentQueue) {
    paymentQueue = new Queue(PAYMENT_QUEUE, {
      connection: getBullConnection(),
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
      },
    });
  }
  return paymentQueue;
}

export async function enqueueWebhookProcessing(eventId: string): Promise<void> {
  await getPaymentQueue().add(
    'webhook-process',
    { eventId },
    { jobId: `webhook:${eventId}`, attempts: 5 },
  );
}
