import { describe, expect, it } from 'vitest';
import {
  formatVehicleBookingDistance,
  formatVehicleBookingRate,
  formatVehicleBookingVnd,
} from '../../../lib/vehicleBookingAnalyticsViewModel';

describe('vehicle booking analytics view formatting', () => {
  it('uses a dash for rates without a denominator', () => {
    expect(formatVehicleBookingRate(null)).toBe('—');
  });

  it('formats rates and distances with one decimal place at most', () => {
    expect(formatVehicleBookingRate(83.333)).toBe('83,3%');
    expect(formatVehicleBookingDistance(120.05)).toBe('120,1 km');
  });

  it('formats actual cost as Vietnamese đồng', () => {
    expect(formatVehicleBookingVnd(125000)).toContain('125.000');
    expect(formatVehicleBookingVnd(125000)).toContain('₫');
  });
});
