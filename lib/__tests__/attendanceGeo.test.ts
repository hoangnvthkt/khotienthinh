import { describe, expect, it } from 'vitest';
import { CheckInPlace, formatDistance, haversineMeters, matchPlace, parseCoordinateText, toCoordinate } from '../attendanceGeo';

const office: CheckInPlace = { id: 'hy', name: 'Văn phòng Hưng Yên', type: 'office', lat: 20.44788, lng: 106.31637, radius: 150 };
const factory: CheckInPlace = { id: 'kct', name: 'Nhà máy KCT', type: 'construction_site', lat: 20.44791, lng: 106.31635, radius: 150 };
const unconfigured: CheckInPlace = { id: 'xhv', name: 'Công trường Xin Hai Vina', type: 'construction_site', lat: null, lng: null, radius: 300 };

describe('attendance location rules', () => {
  it('keeps an empty coordinate empty instead of turning it into 0', () => {
    expect(toCoordinate(null)).toBeNull();
    expect(toCoordinate(undefined)).toBeNull();
    expect(toCoordinate('')).toBeNull();
    expect(toCoordinate(0)).toBe(0);
    expect(toCoordinate('20.5')).toBe(20.5);
  });

  it('never measures against a place without coordinates', () => {
    const match = matchPlace([unconfigured], { lat: 20.5105, lng: 106.2086 });
    expect(match.status).toBe('no_places');
  });

  it('picks the area the person stands in, not merely the nearest place', () => {
    const match = matchPlace([office, unconfigured], { lat: 20.4485, lng: 106.3164 });
    expect(match).toMatchObject({ status: 'inside', place: { id: 'hy' } });
  });

  it('reports outside with the nearest configured place when no area contains the person', () => {
    const match = matchPlace([office, factory], { lat: 20.5105, lng: 106.2086 });
    expect(match.status).toBe('outside');
    if (match.status === 'outside') {
      expect(match.nearest?.distanceM).toBeGreaterThan(13000);
    }
  });

  it('prefers the person own place when two areas overlap', () => {
    const position = { lat: 20.4479, lng: 106.31636 };
    expect(matchPlace([office, factory], position, new Set(['kct']))).toMatchObject({ status: 'inside', place: { id: 'kct' } });
    expect(matchPlace([office, factory], position, new Set(['hy']))).toMatchObject({ status: 'inside', place: { id: 'hy' } });
  });

  it('measures and formats distances', () => {
    expect(haversineMeters({ lat: 20.44791, lng: 106.31635 }, { lat: 20.5105, lng: 106.2086 })).toBeGreaterThan(13000);
    expect(formatDistance(241)).toBe('241 m');
    expect(formatDistance(13222)).toBe('13,2 km');
  });
});

describe('Google Maps coordinates', () => {
  it('reads pasted coordinates and map links', () => {
    expect(parseCoordinateText('20.447910, 106.316350')).toEqual({ lat: 20.44791, lng: 106.31635 });
    expect(parseCoordinateText('https://www.google.com/maps/place/X/@20.5105,106.2086,17z/data=!3d20.51051!4d106.20862')).toEqual({ lat: 20.51051, lng: 106.20862 });
    expect(parseCoordinateText('https://maps.google.com/?q=20.88,106.06')).toEqual({ lat: 20.88, lng: 106.06 });
    expect(parseCoordinateText('Công trường A')).toBeNull();
  });
});
