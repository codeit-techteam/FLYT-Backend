import { Queue } from 'bullmq';
import { getBullConnection } from './connection';

export const RIDE_QUEUE = 'ride-jobs';

let rideQueue: Queue | null = null;

export function getRideQueue(): Queue {
  if (!rideQueue) {
    rideQueue = new Queue(RIDE_QUEUE, {
      connection: getBullConnection(),
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    });
  }
  return rideQueue;
}

export async function enqueueOfferExpiry(offerId: string, delaySeconds: number): Promise<void> {
  await getRideQueue().add(
    'offer-expiry',
    { offerId },
    {
      jobId: `offer-expiry:${offerId}`,
      delay: delaySeconds * 1000,
      attempts: 1,
    },
  );
}

export async function enqueueDispatchRetry(rideId: string, delaySeconds: number): Promise<void> {
  await getRideQueue().add(
    'dispatch-retry',
    { rideId },
    {
      jobId: `dispatch-retry:${rideId}:${Date.now()}`,
      delay: delaySeconds * 1000,
    },
  );
}
