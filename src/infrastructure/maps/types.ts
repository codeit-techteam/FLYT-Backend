export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  polyline?: string;
}

export interface MapsProvider {
  readonly name: string;
  getRoute(origin: LatLng, destination: LatLng): Promise<RouteResult>;
  getDistanceMatrix(
    origins: LatLng[],
    destinations: LatLng[],
  ): Promise<Array<{ distanceMeters: number; durationSeconds: number }>>;
  geocode(address: string): Promise<LatLng | null>;
}
