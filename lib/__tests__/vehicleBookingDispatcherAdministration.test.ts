import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as bookingService from '../vehicleBookingService';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('vehicle booking dispatcher administration contract', () => {
  it('exposes scoped reads and an atomic multi-dispatcher command', () => {
    expect(bookingService.fetchVehicleBookingDispatcherCandidates).toBeTypeOf('function');
    expect(bookingService.setVehicleBookingDispatchers).toBeTypeOf('function');
    expect(bookingService.fetchPendingApprovalCards).toBeTypeOf('function');
  });

  it('manages only global dispatch grants and preserves every unrelated grant', () => {
    const sql = read('supabase/migrations/20260812063634_vehicle_booking_dispatcher_admin_identity.sql');

    expect(sql).toContain('get_vehicle_booking_dispatcher_candidates');
    expect(sql).toContain('set_vehicle_booking_dispatchers');
    expect(sql).toContain('get_pending_vehicle_booking_approval_cards');
    expect(sql).toContain("permission_code = 'booking.vehicle.dispatch'");
    expect(sql).toContain("scope_type = 'global'");
    expect(sql).toContain("scope_id = '*'");
    expect(sql).not.toMatch(/delete[\s\S]{0,180}permission_code\s*(?:<>|!=)/i);
    expect(sql).toMatch(/security invoker/i);
    expect(sql).not.toMatch(/public\.[\s\S]{0,120}security definer/i);
  });

  it('renders business identities on approval cards instead of technical ids', () => {
    const source = read('pages/booking/ManagerApprovalPage.tsx');

    expect(source).not.toContain('ID Người đặt');
    expect(source).not.toContain('b.requester_user_id.substring');
    expect(source).not.toContain('{b.preferred_vehicle_asset_id}');
    expect(source).toContain('requester_employee_name');
    expect(source).toContain('requester_avatar_url');
    expect(source).toContain('preferred_vehicle_asset_code');
    expect(source).toContain('preferred_vehicle_asset_name');
  });

  it('lets ADMIN select several dispatchers from the Booking settings page', () => {
    const source = read('pages/booking/FleetSettingsManagement.tsx');

    expect(source).toContain('Nhân sự điều phối');
    expect(source).toContain('selectedDispatcherIds');
    expect(source).toContain('fetchVehicleBookingDispatcherCandidates');
    expect(source).toContain('setVehicleBookingDispatchers');
    expect(source).toContain('type="checkbox"');
  });
});
