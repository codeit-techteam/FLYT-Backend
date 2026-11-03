import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../common/errors/AppError';
import type { LatLng, MapsProvider, RouteResult } from './types';
import { DevelopmentMapsProvider } from './development.maps';

export class GoogleMapsProvider implements MapsProvider {
  readonly name = 'google';
  private fallback = new DevelopmentMapsProvider();

  async getRoute(origin: LatLng, destination: LatLng): Promise<RouteResult> {
    const key = env().GOOGLE_MAPS_API_KEY;
    if (!key) {
      return this.fallback.getRoute(origin, destination);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const url = new URL('https://routes.googleapis.com/directions/v2:computeRoutes');
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
          destination: {
            location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
          },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.warn({ status: response.status }, 'Google Routes API failed; using fallback');
        return this.fallback.getRoute(origin, destination);
      }

      const data = (await response.json()) as {
        routes?: Array<{
          distanceMeters?: number;
          duration?: string;
          polyline?: { encodedPolyline?: string };
        }>;
      };

      const route = data.routes?.[0];
      if (!route?.distanceMeters || !route.duration) {
        return this.fallback.getRoute(origin, destination);
      }

      const durationSeconds = Number(route.duration.replace('s', ''));
      return {
        distanceMeters: route.distanceMeters,
        durationSeconds,
        polyline: route.polyline?.encodedPolyline,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async getDistanceMatrix(
    origins: LatLng[],
    destinations: LatLng[],
  ): Promise<Array<{ distanceMeters: number; durationSeconds: number }>> {
    // Prefer Routes API per-pair for accuracy when key present; fall back otherwise
    const results: Array<{ distanceMeters: number; durationSeconds: number }> = [];
    for (const origin of origins) {
      for (const destination of destinations) {
        results.push(await this.getRoute(origin, destination));
      }
    }
    return results;
  }

  async geocode(address: string): Promise<LatLng | null> {
    const key = env().GOOGLE_MAPS_API_KEY;
    if (!key) return null;

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('key', key);

    const response = await fetch(url);
    if (!response.ok) {
      throw new AppError('Geocoding failed', 502, 'INTERNAL_ERROR');
    }

    const data = (await response.json()) as {
      results?: Array<{ geometry: { location: { lat: number; lng: number } } }>;
    };
    const loc = data.results?.[0]?.geometry.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  }
}
