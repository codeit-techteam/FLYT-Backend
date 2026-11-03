import { ExperienceMode, Gender, SheFallbackPolicy } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../common/errors/AppError';

const SILVER_AGE_YEARS = 60;

export interface ModeResolution {
  effectiveMode: ExperienceMode;
  sheRulesApply: boolean;
  silverDiscountEligible: boolean;
  sheFallbackPolicy: SheFallbackPolicy;
  reasons: string[];
}

export class ModesService {
  async resolveRideMode(
    customerId: string,
    requestedMode?: ExperienceMode,
  ): Promise<ModeResolution> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        modeSetting: true,
        modeEligibilities: true,
      },
    });

    if (!customer) {
      throw AppError.notFound('Customer not found');
    }

    const reasons: string[] = [];
    const sheEligible = this.isSheEligible(customer);
    const silverEligible = this.isSilverEligible(customer);

    // Never trust client mode claims — verify eligibility server-side
    let effectiveMode: ExperienceMode = ExperienceMode.STANDARD;
    const preferred: ExperienceMode =
      requestedMode ?? customer.modeSetting?.preferredMode ?? customer.experience;

    if (preferred === ExperienceMode.SHE) {
      if (!sheEligible) {
        throw new AppError(
          'She Mode is only available for verified female customers',
          403,
          'ELIGIBILITY_DENIED',
        );
      }
      effectiveMode = ExperienceMode.SHE;
      reasons.push('SHE_ELIGIBLE');
    } else if (preferred === ExperienceMode.SILVER) {
      if (!silverEligible) {
        throw new AppError(
          'Silver Mode requires verified date of birth with age 60+',
          403,
          'ELIGIBILITY_DENIED',
        );
      }
      effectiveMode = ExperienceMode.SILVER;
      reasons.push('SILVER_ELIGIBLE');
    } else {
      effectiveMode = ExperienceMode.STANDARD;
      reasons.push('STANDARD_DEFAULT');
    }

    // Combined: female 60+ can have She safety rules + Silver discount together
    const sheRulesApply = sheEligible && (effectiveMode === ExperienceMode.SHE || preferred === ExperienceMode.SHE);
    // If they requested She but are also silver-eligible, keep She as primary experience
    // while still applying silver discount
    if (effectiveMode === ExperienceMode.SHE && silverEligible) {
      reasons.push('COMBINED_SHE_SILVER');
    }
    if (effectiveMode === ExperienceMode.SILVER && sheEligible) {
      reasons.push('COMBINED_SILVER_SHE_SAFETY_AVAILABLE');
    }

    // Persist eligibility snapshots
    await this.upsertEligibility(customerId, ExperienceMode.SHE, sheEligible, sheEligible ? 'GENDER_FEMALE' : 'NOT_FEMALE');
    await this.upsertEligibility(
      customerId,
      ExperienceMode.SILVER,
      silverEligible,
      silverEligible ? 'AGE_60_PLUS_VERIFIED' : 'AGE_OR_DOB_NOT_VERIFIED',
    );

    return {
      effectiveMode,
      sheRulesApply: sheRulesApply || (effectiveMode === ExperienceMode.SHE),
      silverDiscountEligible: silverEligible,
      sheFallbackPolicy: customer.modeSetting?.sheFallbackPolicy ?? SheFallbackPolicy.FAIL_WITH_MESSAGE,
      reasons,
    };
  }

  isSheEligible(customer: { gender: Gender }): boolean {
    return customer.gender === Gender.FEMALE;
  }

  isSilverEligible(customer: {
    dateOfBirth: Date | null;
    dobVerified: boolean;
  }): boolean {
    if (!customer.dateOfBirth || !customer.dobVerified) {
      return false;
    }
    return this.ageInYears(customer.dateOfBirth) >= SILVER_AGE_YEARS;
  }

  ageInYears(dob: Date, now = new Date()): number {
    let age = now.getUTCFullYear() - dob.getUTCFullYear();
    const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) {
      age -= 1;
    }
    return age;
  }

  private async upsertEligibility(
    customerId: string,
    mode: ExperienceMode,
    eligible: boolean,
    reason: string,
  ): Promise<void> {
    await prisma.modeEligibility.upsert({
      where: { customerId_mode: { customerId, mode } },
      create: {
        customerId,
        mode,
        eligible,
        reason,
        verifiedAt: eligible ? new Date() : null,
      },
      update: {
        eligible,
        reason,
        verifiedAt: eligible ? new Date() : null,
      },
    });
  }
}

export const modesService = new ModesService();
