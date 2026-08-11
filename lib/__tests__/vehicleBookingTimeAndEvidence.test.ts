import { describe, expect, it } from 'vitest';
import * as bookingService from '../vehicleBookingService';

const service = bookingService as typeof bookingService & {
  vietnamLocalDateTimeToISOString: (input: string) => string;
  getTripEvidenceValidationError: (input: {
    mode: 'START' | 'FINISH';
    hasImage: boolean;
    latitude: number | null;
    longitude: number | null;
    locationCaptureFailed: boolean;
    locationFailureReason?: string;
  }) => string | null;
  isEvidenceImageWithinLimit: (blob: Blob, maxMb: number) => boolean;
};

describe('vehicle booking Vietnam time conversion', () => {
  it('interprets datetime-local input as UTC+7 independently of the browser timezone', () => {
    expect(service.vietnamLocalDateTimeToISOString).toBeTypeOf('function');
    expect(service.vietnamLocalDateTimeToISOString('2026-08-12T09:30')).toBe('2026-08-12T02:30:00.000Z');
    expect(service.vietnamLocalDateTimeToISOString('2026-01-02T00:05:09')).toBe('2026-01-01T17:05:09.000Z');
  });

  it('rejects malformed or impossible local datetimes', () => {
    expect(() => service.vietnamLocalDateTimeToISOString('2026-02-30T10:00')).toThrow('INVALID_VIETNAM_LOCAL_DATETIME');
    expect(() => service.vietnamLocalDateTimeToISOString('not-a-date')).toThrow('INVALID_VIETNAM_LOCAL_DATETIME');
  });
});

describe('vehicle trip evidence rules', () => {
  it('requires a photo and either GPS coordinates or an explained GPS failure', () => {
    expect(service.getTripEvidenceValidationError).toBeTypeOf('function');
    const base = {
      mode: 'START' as const,
      hasImage: true,
      latitude: 10.77,
      longitude: 106.69,
      locationCaptureFailed: false,
    };

    expect(service.getTripEvidenceValidationError({ ...base, hasImage: false })).toBe('PHOTO_REQUIRED');
    expect(service.getTripEvidenceValidationError({
      ...base,
      latitude: null,
      longitude: null,
    })).toBe('LOCATION_REQUIRED');
    expect(service.getTripEvidenceValidationError({
      ...base,
      latitude: null,
      longitude: null,
      locationCaptureFailed: true,
      locationFailureReason: '   ',
    })).toBe('LOCATION_FAILURE_REASON_REQUIRED');
    expect(service.getTripEvidenceValidationError({
      ...base,
      latitude: null,
      longitude: null,
      locationCaptureFailed: true,
      locationFailureReason: 'Thiết bị không cấp quyền vị trí',
    })).toBeNull();
  });

  it('accepts zero latitude/longitude and checks the compressed blob limit inclusively', () => {
    expect(service.getTripEvidenceValidationError({
      mode: 'FINISH',
      hasImage: true,
      latitude: 0,
      longitude: 0,
      locationCaptureFailed: false,
    })).toBeNull();
    expect(service.isEvidenceImageWithinLimit).toBeTypeOf('function');
    expect(service.isEvidenceImageWithinLimit(new Blob([new Uint8Array(1024)]), 0.001)).toBe(true);
    expect(service.isEvidenceImageWithinLimit(new Blob([new Uint8Array(2048)]), 0.001)).toBe(false);
  });
});
