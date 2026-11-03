import { ExperienceMode } from '@prisma/client';
import { env } from '../../config/env';
import { getMapsProvider } from '../../infrastructure/maps';
import { locationsService, type NearbyPilotRow } from '../locations/locations.service';
import type { SheFallbackPolicy } from '@prisma/client';
import { AppError } from '../../common/errors/AppError';
import { logger } from '../../config/logger';

export interface MatchCandidate {
  pilotId: string;
  distanceM: number;
  etaSeconds: number;
  score: number;
  scoreBreakdown: {
    eta: number;
    distance: number;
    eligibility: number;
    availability: number;
    quality: number;
  };
  sheEligible: boolean;
  ratingAvg: number;
  latitude: number;
  longitude: number;
}

export class MatchingService {
  /**
   * Score = 0.40E + 0.20D + 0.15R + 0.15A + 0.10Q (weights configurable).
   * Mandatory eligibility is a hard filter before ranking.
   */
  async findCandidates(input: {
    pickup: { lat: number; lng: number };
    mode: ExperienceMode;
    sheRulesApply: boolean;
    sheFallbackPolicy: SheFallbackPolicy;
    vehicleCategoryId?: string;
  }): Promise<MatchCandidate[]> {
    let requireShe = input.sheRulesApply;

    let nearby = await locationsService.findNearbyPilots({
      latitude: input.pickup.lat,
      longitude: input.pickup.lng,
      requireSheEligible: requireShe,
      vehicleCategoryId: input.vehicleCategoryId,
    });

    if (requireShe && nearby.length === 0) {
      nearby = await this.applySheFallback(input, nearby);
    }

    if (nearby.length === 0) {
      return [];
    }

    const scored = await this.scoreCandidates(nearby, input.pickup, requireShe);
    return scored.sort((a, b) => b.score - a.score);
  }

  private async applySheFallback(
    input: {
      pickup: { lat: number; lng: number };
      sheFallbackPolicy: SheFallbackPolicy;
      vehicleCategoryId?: string;
    },
    current: NearbyPilotRow[],
  ): Promise<NearbyPilotRow[]> {
    switch (input.sheFallbackPolicy) {
      case 'EXPAND_TO_STANDARD':
        logger.info('She Mode fallback: expanding to standard pilots');
        return locationsService.findNearbyPilots({
          latitude: input.pickup.lat,
          longitude: input.pickup.lng,
          requireSheEligible: false,
          vehicleCategoryId: input.vehicleCategoryId,
        });
      case 'WAIT_LONGER':
        // Caller/dispatch will retry with same filters — return empty for now
        return current;
      case 'FAIL_WITH_MESSAGE':
      default:
        throw new AppError(
          'No eligible She Mode pilots available nearby',
          404,
          'NO_PILOT_FOUND',
        );
    }
  }

  private async scoreCandidates(
    nearby: NearbyPilotRow[],
    pickup: { lat: number; lng: number },
    requireShe: boolean,
  ): Promise<MatchCandidate[]> {
    const w = {
      e: env().MATCHING_WEIGHT_ETA,
      d: env().MATCHING_WEIGHT_DISTANCE,
      r: env().MATCHING_WEIGHT_ELIGIBILITY,
      a: env().MATCHING_WEIGHT_AVAILABILITY,
      q: env().MATCHING_WEIGHT_QUALITY,
    };

    const maxDistance = Math.max(...nearby.map((n) => Number(n.distance_m)), 1);
    const maps = getMapsProvider();

    const candidates: MatchCandidate[] = [];

    for (const row of nearby) {
      const route = await maps.getRoute(pickup, {
        lat: Number(row.latitude),
        lng: Number(row.longitude),
      });

      const etaSeconds = route.durationSeconds;
      const maxEta = 1800; // 30 min cap for normalization

      const E = 1 - Math.min(etaSeconds, maxEta) / maxEta;
      const D = 1 - Number(row.distance_m) / maxDistance;
      const R = requireShe ? (row.she_eligible ? 1 : 0) : 1;
      const A = 1; // already filtered to online + free
      const Q = Math.min(Number(row.rating_avg) / 5, 1);

      const score = w.e * E + w.d * D + w.r * R + w.a * A + w.q * Q;

      candidates.push({
        pilotId: row.pilot_id,
        distanceM: Number(row.distance_m),
        etaSeconds,
        score: Number(score.toFixed(4)),
        scoreBreakdown: {
          eta: Number(E.toFixed(4)),
          distance: Number(D.toFixed(4)),
          eligibility: R,
          availability: A,
          quality: Number(Q.toFixed(4)),
        },
        sheEligible: row.she_eligible,
        ratingAvg: Number(row.rating_avg),
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
      });
    }

    return candidates;
  }
}

export const matchingService = new MatchingService();
