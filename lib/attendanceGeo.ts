// Location rules for the one-button check-in (owner decisions 02/10/2026):
// a punch is only possible inside a configured area; the server re-checks everything.

export const MAX_GPS_ACCURACY_M = 100;
export const DEFAULT_SITE_RADIUS_M = 300;
export const DEFAULT_OFFICE_RADIUS_M = 150;

export type CheckInLocationType = 'construction_site' | 'office';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface CheckInPlace {
  id: string;
  name: string;
  type: CheckInLocationType;
  lat: number | null;
  lng: number | null;
  radius: number;
}

export interface PlaceDistance extends CheckInPlace {
  distanceM: number | null;
}

export type PlaceMatch =
  | { status: 'inside'; place: PlaceDistance; alternatives: PlaceDistance[] }
  | { status: 'outside'; nearest: PlaceDistance | null }
  | { status: 'no_places' };

/** A stored coordinate; empty values stay empty (never 0, which is a real place in the ocean). */
export const toCoordinate = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

export const haversineMeters = (from: GeoPoint, to: GeoPoint): number => {
  const radius = 6371000;
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

export const isConfigured = (place: CheckInPlace): boolean => place.lat !== null && place.lng !== null;

/**
 * The place the person is standing in. When several areas overlap, the person's own
 * places (assigned sites, home office) come first, then the closest one.
 */
export const matchPlace = (
  places: CheckInPlace[],
  position: GeoPoint,
  preferredIds: ReadonlySet<string> = new Set(),
): PlaceMatch => {
  const measured: PlaceDistance[] = places
    .filter(isConfigured)
    .map(place => ({ ...place, distanceM: haversineMeters(position, { lat: place.lat as number, lng: place.lng as number }) }));
  if (measured.length === 0) return { status: 'no_places' };

  const inside = measured
    .filter(place => (place.distanceM as number) <= place.radius)
    .sort((a, b) => {
      const preferred = Number(preferredIds.has(b.id)) - Number(preferredIds.has(a.id));
      return preferred || (a.distanceM as number) - (b.distanceM as number);
    });
  if (inside.length > 0) return { status: 'inside', place: inside[0], alternatives: inside.slice(1) };

  const nearest = [...measured].sort((a, b) => (a.distanceM as number) - (b.distanceM as number))[0] ?? null;
  return { status: 'outside', nearest };
};

export const formatDistance = (meters: number): string => (
  meters >= 1000 ? `${(meters / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km` : `${meters} m`
);
