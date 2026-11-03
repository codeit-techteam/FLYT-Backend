import { prisma } from '../../config/database';
import { AppError } from '../../common/errors/AppError';
import { percentOf, roundMoney, toDecimal } from '../../common/utils/money';
import { env } from '../../config/env';
import { pricingService } from '../pricing/pricing.service';

export class CommissionsService {
  async calculateForRide(rideId: string) {
    const existing = await prisma.commission.findUnique({ where: { rideId } });
    if (existing) return existing;

    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw AppError.notFound('Ride not found');

    const fareAmount = toDecimal(ride.finalFare ?? ride.estimatedFare);
    let commissionPercent = toDecimal(env().DEFAULT_COMMISSION_PERCENT);

    try {
      const pricing = await pricingService.getActivePricing(ride.serviceCategoryId);
      commissionPercent = toDecimal(pricing.commissionPercent);
    } catch {
      // use default
    }

    const commissionAmount = percentOf(fareAmount, commissionPercent);
    const pilotPayable = roundMoney(fareAmount.sub(commissionAmount));

    return prisma.commission.create({
      data: {
        rideId,
        fareAmount,
        commissionPercent,
        commissionAmount,
        pilotPayable,
      },
    });
  }
}

export const commissionsService = new CommissionsService();
