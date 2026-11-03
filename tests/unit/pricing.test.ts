import { describe, expect, it } from 'vitest';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import type { PricingConfiguration } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const basePricing = {
  id: '00000000-0000-0000-0000-000000000001',
  serviceCategoryId: '00000000-0000-0000-0000-000000000002',
  vehicleCategoryId: '00000000-0000-0000-0000-000000000003',
  zoneId: null,
  currency: 'INR',
  baseFare: new Decimal(25),
  perKmRate: new Decimal(8),
  perMinuteRate: new Decimal(1.5),
  waitingPerMinute: new Decimal(1),
  minimumFare: new Decimal(40),
  cancellationFee: new Decimal(20),
  commissionPercent: new Decimal(20),
  isActive: true,
  effectiveFrom: new Date(),
  effectiveTo: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as PricingConfiguration;

describe('PricingService.calculate', () => {
  const service = new PricingService();

  it('calculates fare with distance and time charges', () => {
    const result = service.calculate({
      pricing: basePricing,
      distanceKm: 10,
      durationMinutes: 20,
      waitingMinutes: 0,
      extras: 0,
      silverEligible: false,
      surgeMultiplier: 1,
    });

    // 25 + 80 + 30 = 135
    expect(result.baseFare).toBe(25);
    expect(result.distanceCharge).toBe(80);
    expect(result.timeCharge).toBe(30);
    expect(result.total).toBe(135);
    expect(result.discountAmount).toBe(0);
  });

  it('applies silver 10% discount server-side', () => {
    const result = service.calculate({
      pricing: basePricing,
      distanceKm: 10,
      durationMinutes: 20,
      waitingMinutes: 0,
      extras: 0,
      silverEligible: true,
      surgeMultiplier: 1,
    });

    expect(result.subtotal).toBe(135);
    expect(result.discountAmount).toBe(13.5);
    expect(result.total).toBe(121.5);
    expect(result.discountReason).toContain('SILVER');
  });

  it('enforces minimum fare', () => {
    const result = service.calculate({
      pricing: basePricing,
      distanceKm: 0.5,
      durationMinutes: 2,
      waitingMinutes: 0,
      extras: 0,
      silverEligible: false,
      surgeMultiplier: 1,
    });

    expect(result.minimumFareApplied).toBe(true);
    expect(result.total).toBe(40);
  });

  it('applies surge multiplier before discount', () => {
    const result = service.calculate({
      pricing: basePricing,
      distanceKm: 10,
      durationMinutes: 20,
      waitingMinutes: 0,
      extras: 0,
      silverEligible: true,
      surgeMultiplier: 1.5,
    });

    expect(result.surgeMultiplier).toBe(1.5);
    expect(result.subtotal).toBe(202.5);
    expect(result.discountAmount).toBe(20.25);
    expect(result.total).toBe(182.25);
  });
});
