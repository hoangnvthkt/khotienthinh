import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260812000013_vehicle_booking_phase3_analytics.sql';
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8').toLowerCase().replace(/\s+/g, ' ')
  : '';

describe('vehicle booking phase 3 analytics migration', () => {
  it('uses a half-open requested-pickup reporting window', () => {
    expect(sql).toContain('b.requested_pickup_at >= p_from_at');
    expect(sql).toContain('b.requested_pickup_at < p_to_at');
  });

  it('enforces scoped report permission in both RPCs', () => {
    expect(sql.match(/booking\.vehicle\.view_reports/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("'department', p_department_id::text");
    expect(sql).toContain('global report permission required');
  });

  it('uses actual external cost and server-side KPI inputs', () => {
    expect(sql).toContain('external_actual_cost');
    expect(sql).not.toContain('sum(a.external_estimated_cost)');
    expect(sql).toContain('on_time_tolerance_minutes');
    expect(sql).toContain('vehicle_unavailability_periods');
    expect(sql).not.toContain('asset.asset_code');
  });

  it('locks function execution to authenticated clients', () => {
    expect(sql).toContain('revoke all on function public.get_vehicle_booking_analytics');
    expect(sql).toContain('grant execute on function public.get_vehicle_booking_analytics');
    expect(sql).toContain('revoke all on function public.export_vehicle_booking_analytics');
    expect(sql).toContain('grant execute on function public.export_vehicle_booking_analytics');
  });
});
