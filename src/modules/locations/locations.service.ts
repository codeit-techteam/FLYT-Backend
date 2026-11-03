import { AvailabilityStatus, PilotStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { getRedis } from '../../config/redis';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';
import { logger } from '../../config/logger';

export interface NearbyPilotRow {
  pilot_id: string;
  distance_m: number;
  latitude: number;
  longitude: number;
  recorded_at: Date;
  she_eligible: boolean;
  rating_avg: number;
  category_id: string | null;
}

export class LocationsService {
  async updatePilotLocation(input: {
    pilotId: string;
    latitude: number;
    longitude: number;
    heading?: number;
    speedMps?: number;
    accuracyM?: number;
  }): Promise<void> {
    this.validateCoordinates(input.latitude, input.longitude);

    const availability = await prisma.pilotAvailability.findUnique({
      where: { pilotId: input.pilotId },
    });
    if (!availability || availability.status === AvailabilityStatus.OFFLINE) {
      throw AppError.badRequest('Pilot must be online to update location');
    }

    const recordedAt = new Date();

    // Upsert Prisma mirror + PostGIS geography via parameterized raw SQL
    await prisma.$executeRaw`
      INSERT INTO pilot_locations (
        pilot_id, latitude, longitude, heading, speed_mps, accuracy_m, recorded_at, updated_at, geom
      ) VALUES (
        ${input.pilotId}::uuid,
        ${input.latitude},
        ${input.longitude},
        ${input.heading ?? null},
        ${input.speedMps ?? null},
        ${input.accuracyM ?? null},
        ${recordedAt},
        ${recordedAt},
        ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography
      )
      ON CONFLICT (pilot_id) DO UPDATE SET
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        heading = EXCLUDED.heading,
        speed_mps = EXCLUDED.speed_mps,
        accuracy_m = EXCLUDED.accuracy_m,
        recorded_at = EXCLUDED.recorded_at,
        updated_at = EXCLUDED.updated_at,
        geom = EXCLUDED.geom
    `;

    // Fast path for realtime consumers
    const redis = getRedis();
    await redis.setex(
      `pilot:location:${input.pilotId}`,
      env().LOCATION_STALE_SECONDS * 2,
      JSON.stringify({
        lat: input.latitude,
        lng: input.longitude,
        heading: input.heading,
        recordedAt: recordedAt.toISOString(),
      }),
    );

    // Sample history (~every 30s) — retention policy enforced by cleanup job
    const lastHistory = await prisma.pilotLocationHistory.findFirst({
      where: { pilotId: input.pilotId },
      orderBy: { recordedAt: 'desc' },
    });

    if (!lastHistory || recordedAt.getTime() - lastHistory.recordedAt.getTime() >= 30_000) {
      await prisma.pilotLocationHistory.create({
        data: {
          pilotId: input.pilotId,
          latitude: input.latitude,
          longitude: input.longitude,
          heading: input.heading,
          speedMps: input.speedMps,
          recordedAt,
        },
      });
    }
  }

  /**
   * PostGIS nearby search — GiST spatial index on geography(Point,4326).
   * Hard-filters: online, active, no active ride, optional she eligibility & category.
   */
  async findNearbyPilots(input: {
    latitude: number;
    longitude: number;
    radiusMeters?: number;
    requireSheEligible?: boolean;
    vehicleCategoryId?: string;
    limit?: number;
  }): Promise<NearbyPilotRow[]> {
    this.validateCoordinates(input.latitude, input.longitude);

    const radius = input.radiusMeters ?? env().MATCHING_RADIUS_METERS;
    const staleBefore = new Date(Date.now() - env().LOCATION_STALE_SECONDS * 1000);
    const limit = input.limit ?? 20;

    // Parameterized — never concatenate untrusted input
    const rows = await prisma.$queryRaw<NearbyPilotRow[]>`
      SELECT
        pl.pilot_id,
        ST_Distance(
          pl.geom,
          ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography
        ) AS distance_m,
        pl.latitude::float8 AS latitude,
        pl.longitude::float8 AS longitude,
        pl.recorded_at,
        p.she_eligible,
        p.rating_avg::float8 AS rating_avg,
        v.category_id
      FROM pilot_locations pl
      INNER JOIN pilots p ON p.id = pl.pilot_id
      INNER JOIN pilot_availability pa ON pa.pilot_id = p.id
      LEFT JOIN LATERAL (
        SELECT v.category_id
        FROM vehicles v
        WHERE v.pilot_id = p.id AND v.status = 'ACTIVE' AND v.is_primary = true
        LIMIT 1
      ) v ON true
      WHERE
        p.status = ${PilotStatus.ACTIVE}::"PilotStatus"
        AND pa.status = ${AvailabilityStatus.ONLINE}::"AvailabilityStatus"
        AND pl.recorded_at >= ${staleBefore}
        AND ST_DWithin(
          pl.geom,
          ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography,
          ${radius}
        )
        AND NOT EXISTS (
          SELECT 1 FROM rides r
          WHERE r.pilot_id = p.id
            AND r.status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS')
        )
        AND (
          ${input.requireSheEligible ?? false} = false
          OR p.she_eligible = true
        )
        AND (
          ${input.vehicleCategoryId ?? null}::uuid IS NULL
          OR v.category_id = ${input.vehicleCategoryId ?? null}::uuid
        )
      ORDER BY distance_m ASC
      LIMIT ${limit}
    `;

    logger.debug({ count: rows.length, radius }, 'Nearby pilots found via PostGIS');
    return rows;
  }

  async getCachedPilotLocation(
    pilotId: string,
  ): Promise<{ lat: number; lng: number; recordedAt: string } | null> {
    const raw = await getRedis().get(`pilot:location:${pilotId}`);
    if (!raw) return null;
    return JSON.parse(raw) as { lat: number; lng: number; recordedAt: string };
  }

  validateCoordinates(lat: number, lng: number): void {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw AppError.badRequest('Invalid coordinates');
    }
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      throw AppError.badRequest('Coordinates must be numbers');
    }
  }
}

export const locationsService = new LocationsService();
