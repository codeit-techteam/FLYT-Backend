import { describe, expect, it } from 'vitest';
import { RideStatus } from '@prisma/client';
import { canTransition } from '../../src/common/constants/ride';

describe('Ride state transitions', () => {
  it('allows REQUESTED -> SEARCHING', () => {
    expect(canTransition(RideStatus.REQUESTED, RideStatus.SEARCHING)).toBe(true);
  });

  it('prevents COMPLETED -> ACCEPTED', () => {
    expect(canTransition(RideStatus.COMPLETED, RideStatus.ACCEPTED)).toBe(false);
  });

  it('allows ACCEPTED -> ARRIVED -> IN_PROGRESS -> COMPLETED', () => {
    expect(canTransition(RideStatus.ACCEPTED, RideStatus.ARRIVED)).toBe(true);
    expect(canTransition(RideStatus.ARRIVED, RideStatus.IN_PROGRESS)).toBe(true);
    expect(canTransition(RideStatus.IN_PROGRESS, RideStatus.COMPLETED)).toBe(true);
  });

  it('allows PAID -> SETTLED only', () => {
    expect(canTransition(RideStatus.PAID, RideStatus.SETTLED)).toBe(true);
    expect(canTransition(RideStatus.PAID, RideStatus.IN_PROGRESS)).toBe(false);
  });
});
