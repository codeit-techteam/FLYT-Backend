import type { LatLng, MapsProvider, RouteResult } from './types';

/** Haversine-based development maps provider — no external API calls. */
export class DevelopmentMapsProvider implements MapsProvider {
  readonly name = 'development';

  async getRoute(origin: LatLng, destination: LatLng): Promise<RouteResult> {
    const distanceMeters = haversineMeters(origin, destination);
    // Assume average urban speed ~25 km/h
    const durationSeconds = Math.max(60, Math.round((distanceMeters / 1000 / 25) * 3600));
    return { distanceMeters, durationSeconds };
  }

  async getDistanceMatrix(
    origins: LatLng[],
    destinations: LatLng[],
  ): Promise<Array<{ distanceMeters: number; durationSeconds: number }>> {
    const results: Array<{ distanceMeters: number; durationSeconds: number }> = [];
    for (const origin of origins) {
      for (const destination of destinations) {
        results.push(await this.getRoute(origin, destination));
      }
    }
    return results;
  }

  async geocode(_address: string): Promise<LatLng | null> {
    return null;
  }
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
