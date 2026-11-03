import { ExperienceMode, type PricingConfiguration } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';
import { percentOf, roundMoney, toDecimal } from '../../common/utils/money';
import { getMapsProvider } from '../../infrastructure/maps';
import { modesService } from '../modes/modes.service';

export interface FareCalculationInput {
  customerId: string;
  serviceCategoryId: string;
  pickup: { lat: number; lng: number; address?: string };
  drop: { lat: number; lng: number; address?: string };
  mode?: ExperienceMode;
  waitingMinutes?: number;
  extras?: number;
  idempotencyKey?: string;
}

export interface FareBreakdownResult {
  baseFare: number;
  distanceCharge: number;
  timeCharge: number;
  waitingCharge: number;
  extras: number;
  surgeMultiplier: number;
  surgeAdjustment: number;
  discountAmount: number;
  discountReason: string | null;
  subtotal: number;
  total: number;
  minimumFareApplied: boolean;
  distanceKm: number;
  durationMinutes: number;
  currency: string;
  commissionPercent: number;
}

export class PricingService {
  async quote(input: FareCalculationInput): Promise<{
    quoteId: string;
    expiresAt: Date;
    breakdown: FareBreakdownResult;
    mode: ExperienceMode;
  }> {
    if (input.idempotencyKey) {
      const existing = await prisma.fareQuote.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { breakdown: true },
      });
      if (existing?.breakdown) {
        return {
          quoteId: existing.id,
          expiresAt: existing.expiresAt,
          mode: existing.mode,
          breakdown: this.mapBreakdown(existing.breakdown, existing),
        };
      }
    }

    const eligibility = await modesService.resolveRideMode(input.customerId, input.mode);
    const pricing = await this.getActivePricing(input.serviceCategoryId);
    const route = await getMapsProvider().getRoute(input.pickup, input.drop);

    const distanceKm = route.distanceMeters / 1000;
    const durationMinutes = route.durationSeconds / 60;

    const breakdown = this.calculate({
      pricing,
      distanceKm,
      durationMinutes,
      waitingMinutes: input.waitingMinutes ?? 0,
      extras: input.extras ?? 0,
      silverEligible: eligibility.silverDiscountEligible,
      surgeMultiplier: await this.getActiveSurgeMultiplier(pricing.zoneId),
    });

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const quote = await prisma.fareQuote.create({
      data: {
        customerId: input.customerId,
        serviceCategoryId: input.serviceCategoryId,
        mode: eligibility.effectiveMode,
        pickupLat: input.pickup.lat,
        pickupLng: input.pickup.lng,
        dropLat: input.drop.lat,
        dropLng: input.drop.lng,
        distanceKm,
        durationMinutes,
        estimatedFare: breakdown.total,
        expiresAt,
        idempotencyKey: input.idempotencyKey,
        breakdown: {
          create: {
            baseFare: breakdown.baseFare,
            distanceCharge: breakdown.distanceCharge,
            timeCharge: breakdown.timeCharge,
            waitingCharge: breakdown.waitingCharge,
            extras: breakdown.extras,
            surgeMultiplier: breakdown.surgeMultiplier,
            surgeAdjustment: breakdown.surgeAdjustment,
            discountAmount: breakdown.discountAmount,
            discountReason: breakdown.discountReason,
            subtotal: breakdown.subtotal,
            total: breakdown.total,
            minimumFareApplied: breakdown.minimumFareApplied,
          },
        },
      },
    });

    return {
      quoteId: quote.id,
      expiresAt,
      mode: eligibility.effectiveMode,
      breakdown: { ...breakdown, commissionPercent: Number(pricing.commissionPercent) },
    };
  }

  calculate(input: {
    pricing: PricingConfiguration;
    distanceKm: number;
    durationMinutes: number;
    waitingMinutes: number;
    extras: number;
    silverEligible: boolean;
    surgeMultiplier: number;
  }): FareBreakdownResult {
    const baseFare = toDecimal(input.pricing.baseFare);
    const distanceCharge = roundMoney(toDecimal(input.pricing.perKmRate).mul(input.distanceKm));
    const timeCharge = roundMoney(toDecimal(input.pricing.perMinuteRate).mul(input.durationMinutes));
    const waitingCharge = roundMoney(
      toDecimal(input.pricing.waitingPerMinute).mul(input.waitingMinutes),
    );
    const extras = roundMoney(input.extras);

    let subtotal = roundMoney(
      baseFare.add(distanceCharge).add(timeCharge).add(waitingCharge).add(extras),
    );

    const surgeMultiplier = input.surgeMultiplier;
    const preSurge = subtotal;
    if (surgeMultiplier > 1) {
      subtotal = roundMoney(subtotal.mul(surgeMultiplier));
    }
    const surgeAdjustment = roundMoney(subtotal.sub(preSurge));

    let discountAmount = new Decimal(0);
    let discountReason: string | null = null;

    if (input.silverEligible) {
      discountAmount = percentOf(subtotal, env().SILVER_DISCOUNT_PERCENT);
      discountReason = `SILVER_${env().SILVER_DISCOUNT_PERCENT}_PERCENT`;
    }

    let total = roundMoney(subtotal.sub(discountAmount));
    let minimumFareApplied = false;
    const minimumFare = toDecimal(input.pricing.minimumFare);

    if (total.lessThan(minimumFare)) {
      total = minimumFare;
      minimumFareApplied = true;
    }

    return {
      baseFare: Number(baseFare),
      distanceCharge: Number(distanceCharge),
      timeCharge: Number(timeCharge),
      waitingCharge: Number(waitingCharge),
      extras: Number(extras),
      surgeMultiplier,
      surgeAdjustment: Number(surgeAdjustment),
      discountAmount: Number(discountAmount),
      discountReason,
      subtotal: Number(subtotal),
      total: Number(total),
      minimumFareApplied,
      distanceKm: Number(input.distanceKm.toFixed(3)),
      durationMinutes: Number(input.durationMinutes.toFixed(2)),
      currency: input.pricing.currency,
      commissionPercent: Number(input.pricing.commissionPercent),
    };
  }

  async getActivePricing(serviceCategoryId: string): Promise<PricingConfiguration> {
    const now = new Date();
    const pricing = await prisma.pricingConfiguration.findFirst({
      where: {
        serviceCategoryId,
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!pricing) {
      throw AppError.notFound('No active pricing configuration for this service category');
    }

    return pricing;
  }

  private async getActiveSurgeMultiplier(zoneId: string | null): Promise<number> {
    if (!zoneId) return 1;
    const now = new Date();
    const surge = await prisma.surgeConfiguration.findFirst({
      where: {
        zoneId,
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      orderBy: { multiplier: 'desc' },
    });
    return surge ? Number(surge.multiplier) : 1;
  }

  private mapBreakdown(
    breakdown: {
      baseFare: Decimal;
      distanceCharge: Decimal;
      timeCharge: Decimal;
      waitingCharge: Decimal;
      extras: Decimal;
      surgeMultiplier: Decimal;
      surgeAdjustment: Decimal;
      discountAmount: Decimal;
      discountReason: string | null;
      subtotal: Decimal;
      total: Decimal;
      minimumFareApplied: boolean;
    },
    quote: { distanceKm: Decimal; durationMinutes: Decimal; currency: string },
  ): FareBreakdownResult {
    return {
      baseFare: Number(breakdown.baseFare),
      distanceCharge: Number(breakdown.distanceCharge),
      timeCharge: Number(breakdown.timeCharge),
      waitingCharge: Number(breakdown.waitingCharge),
      extras: Number(breakdown.extras),
      surgeMultiplier: Number(breakdown.surgeMultiplier),
      surgeAdjustment: Number(breakdown.surgeAdjustment),
      discountAmount: Number(breakdown.discountAmount),
      discountReason: breakdown.discountReason,
      subtotal: Number(breakdown.subtotal),
      total: Number(breakdown.total),
      minimumFareApplied: breakdown.minimumFareApplied,
      distanceKm: Number(breakdown.distanceCharge ? quote.distanceKm : 0),
      durationMinutes: Number(quote.durationMinutes),
      currency: quote.currency,
      commissionPercent: env().DEFAULT_COMMISSION_PERCENT,
    };
  }
}

export const pricingService = new PricingService();
