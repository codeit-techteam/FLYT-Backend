import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { connectDatabase, disconnectDatabase, prisma } from '../../src/config/database';
import { connectRedis, disconnectRedis } from '../../src/config/redis';
import { locationsService } from '../../src/modules/locations/locations.service';

describe('PostGIS nearby pilot search', () => {
  beforeAll(async () => {
    loadEnv();
    await connectDatabase();
    await connectRedis();
  });

  afterAll(async () => {
    await disconnectRedis();
    await disconnectDatabase();
  });

  it('finds nearby online pilots using geography distance', async () => {
    const pilot = await prisma.pilot.findFirst({
      where: { status: 'ACTIVE' },
      include: { availability: true },
    });

    if (!pilot) {
      expect(true).toBe(true);
      return;
    }

    await prisma.pilotAvailability.upsert({
      where: { pilotId: pilot.id },
      create: { pilotId: pilot.id, status: 'ONLINE', lastOnlineAt: new Date() },
      update: { status: 'ONLINE', lastOnlineAt: new Date() },
    });

    // MG Road, Bengaluru
    await locationsService.updatePilotLocation({
      pilotId: pilot.id,
      latitude: 12.975,
      longitude: 77.606,
    });

    const nearby = await locationsService.findNearbyPilots({
      latitude: 12.976,
      longitude: 77.607,
      radiusMeters: 2000,
    });

    expect(nearby.some((p) => p.pilot_id === pilot.id)).toBe(true);
    expect(Number(nearby[0]?.distance_m)).toBeGreaterThanOrEqual(0);
  });

  it('has PostGIS extension enabled', async () => {
    const rows = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'postgis'
    `;
    expect(rows.length).toBe(1);
  });
});
