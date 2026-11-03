/**
 * Enables PostGIS geography column + GiST index on pilot_locations.
 * Safe to run multiple times.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS postgis`);
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE pilot_locations
    ADD COLUMN IF NOT EXISTS geom geography(Point, 4326)
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE pilot_locations
    SET geom = ST_SetSRID(ST_MakePoint(longitude::float8, latitude::float8), 4326)::geography
    WHERE geom IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS pilot_locations_geom_gix
    ON pilot_locations USING GIST (geom)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION flyt_sync_pilot_location_geom()
    RETURNS trigger AS $$
    BEGIN
      NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude::float8, NEW.latitude::float8), 4326)::geography;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_pilot_location_geom ON pilot_locations`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER trg_pilot_location_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude
    ON pilot_locations
    FOR EACH ROW
    EXECUTE FUNCTION flyt_sync_pilot_location_geom()
  `);

  console.log('PostGIS enabled: pilot_locations.geom + GiST index ready');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
