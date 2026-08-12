import { describe, expect, it } from 'vitest';
import {
  getVehicleBookingDeepLinkId,
  resolveVehicleBookingDeepLink,
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

  it('loads an authorized notification target without requiring requester-list membership', async () => {
    const bookingId = '11111111-1111-4111-8111-111111111111';
    const details = { booking: { id: bookingId, requester_user_id: 'another-user' } };

    const result = await resolveVehicleBookingDeepLink(
      new URLSearchParams(`booking=${bookingId}`),
      async id => id === bookingId ? details : null,
    );

    expect(result).toEqual(details);
  });

  it('does not call the detail loader for a malformed notification target', async () => {
    let calls = 0;

    const result = await resolveVehicleBookingDeepLink(
      new URLSearchParams('booking=not-a-uuid'),
      async () => {
        calls += 1;
        return { booking: { id: 'unexpected' } };
      },
    );

    expect(result).toBeNull();
    expect(calls).toBe(0);
  });
});
