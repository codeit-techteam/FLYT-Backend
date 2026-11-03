import { RideStatus } from '@prisma/client';

export const RIDE_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
  REQUESTED: [RideStatus.SEARCHING, RideStatus.CANCELLED, RideStatus.EXPIRED],
  SEARCHING: [
    RideStatus.OFFERED,
    RideStatus.NO_PILOT_FOUND,
    RideStatus.CANCELLED,
    RideStatus.EXPIRED,
  ],
  OFFERED: [
    RideStatus.ACCEPTED,
    RideStatus.SEARCHING,
    RideStatus.NO_PILOT_FOUND,
    RideStatus.CANCELLED,
    RideStatus.EXPIRED,
  ],
  ACCEPTED: [RideStatus.ARRIVED, RideStatus.CANCELLED],
  ARRIVED: [RideStatus.IN_PROGRESS, RideStatus.CANCELLED],
  IN_PROGRESS: [RideStatus.COMPLETED, RideStatus.CANCELLED],
  COMPLETED: [RideStatus.PAYMENT_PENDING, RideStatus.PAID],
  PAYMENT_PENDING: [RideStatus.PAID, RideStatus.COMPLETED],
  PAID: [RideStatus.SETTLED],
  SETTLED: [],
  CANCELLED: [],
  REJECTED: [],
  EXPIRED: [],
  NO_PILOT_FOUND: [RideStatus.CANCELLED, RideStatus.SEARCHING],
};

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return RIDE_TRANSITIONS[from]?.includes(to) ?? false;
}
