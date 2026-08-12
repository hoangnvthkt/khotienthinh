import { describe, expect, it } from 'vitest';
import { resolveNotificationPath } from '../notificationRoutes';

describe('vehicle booking notification routes', () => {
  it('replaces a legacy vehicle-booking link with the canonical deep link', () => {
    expect(resolveNotificationPath({
      sourceType: 'vehicle_booking',
      sourceId: '11111111-1111-4111-8111-111111111111',
      link: '/booking/vehicles/11111111-1111-4111-8111-111111111111',
      metadata: {},
    } as any)).toBe('/booking/vehicle/my?booking=11111111-1111-4111-8111-111111111111');
  });

  it('uses a booking id from metadata when the source id is absent', () => {
    expect(resolveNotificationPath({
      category: 'vehicle_booking',
      metadata: { booking_id: '22222222-2222-4222-8222-222222222222' },
    } as any)).toBe('/booking/vehicle/my?booking=22222222-2222-4222-8222-222222222222');
  });
});
