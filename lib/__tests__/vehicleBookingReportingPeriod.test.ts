import { describe, expect, it } from 'vitest';
import {
  buildVehicleBookingCustomReportingPeriod,
  buildVehicleBookingReportingPeriod,
} from '../vehicleBookingAnalyticsService';

const now = new Date('2026-08-12T03:00:00.000Z');

describe('vehicle booking reporting periods in Vietnam time', () => {
  it('builds a Monday-to-Monday week', () => {
    expect(buildVehicleBookingReportingPeriod('THIS_WEEK', now)).toEqual({
      fromAt: '2026-08-09T17:00:00.000Z',
      toAt: '2026-08-16T17:00:00.000Z',
    });
  });

  it('builds the current month', () => {
    expect(buildVehicleBookingReportingPeriod('THIS_MONTH', now)).toEqual({
      fromAt: '2026-07-31T17:00:00.000Z',
      toAt: '2026-08-31T17:00:00.000Z',
    });
  });

  it('builds the current quarter', () => {
    expect(buildVehicleBookingReportingPeriod('THIS_QUARTER', now)).toEqual({
      fromAt: '2026-06-30T17:00:00.000Z',
      toAt: '2026-09-30T17:00:00.000Z',
    });
  });

  it('turns an inclusive custom end date into an exclusive next midnight', () => {
    expect(buildVehicleBookingCustomReportingPeriod('2026-08-01', '2026-08-12')).toEqual({
      fromAt: '2026-07-31T17:00:00.000Z',
      toAt: '2026-08-12T17:00:00.000Z',
    });
  });

  it('rejects malformed or reversed custom dates', () => {
    expect(() => buildVehicleBookingCustomReportingPeriod('12/08/2026', '2026-08-13')).toThrow();
    expect(() => buildVehicleBookingCustomReportingPeriod('2026-08-13', '2026-08-12')).toThrow();
  });
});
