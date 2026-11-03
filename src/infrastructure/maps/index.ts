import { env } from '../../config/env';
import { DevelopmentMapsProvider } from './development.maps';
import { GoogleMapsProvider } from './google.maps';
import type { MapsProvider } from './types';

let provider: MapsProvider | null = null;

export function getMapsProvider(): MapsProvider {
  if (!provider) {
    provider =
      env().MAPS_PROVIDER === 'google' ? new GoogleMapsProvider() : new DevelopmentMapsProvider();
  }
  return provider;
}

export type { MapsProvider, LatLng, RouteResult } from './types';
