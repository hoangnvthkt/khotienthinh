import { describe, expect, it } from 'vitest';
import {
  getVehicleBookingDeepLinkId,
  removeVehicleBookingDeepLink,
} from '../../../lib/vehicleBookingDeepLink';

describe('vehicle booking detail deep link', () => {
  it('accepts a UUID booking query parameter', () => {
    const params = new URLSearchParams('booking=11111111-1111-4111-8111-111111111111');

    expect(getVehicleBookingDeepLinkId(params)).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('rejects malformed booking identifiers', () => {
    expect(getVehicleBookingDeepLinkId(new URLSearchParams('booking=not-a-uuid'))).toBeNull();
  });

  it('removes only the booking parameter when closing the detail view', () => {
    const result = removeVehicleBookingDeepLink(new URLSearchParams('booking=11111111-1111-4111-8111-111111111111&tab=mine'));

    expect(result.toString()).toBe('tab=mine');
  });
});
