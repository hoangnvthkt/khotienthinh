import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260812000014_vehicle_booking_phase3_operations.sql',
  'utf8',
).toLowerCase().replace(/\s+/g, ' ');

describe('vehicle booking issue RPC migration contract', () => {
  it('requires explicit view and resolve permissions separately', () => {
    expect(sql).toContain('booking.vehicle.view_sensitive_feedback');
    expect(sql).toContain('booking.vehicle.resolve_sensitive_feedback');
  });

  it('implements strict state transitions with row locking', () => {
    expect(sql).toContain("v_issue.resolution_status = 'pending' and p_target_status = 'in_review'");
    expect(sql).toContain("v_issue.resolution_status = 'in_review' and p_target_status in ('resolved', 'dismissed')");
    expect(sql).toContain('for update');
    expect(sql).toContain('invalid_issue_transition');
  });

  it('exposes issue content only through the scoped list RPC', () => {
    expect(sql).toContain('create or replace function public.get_vehicle_booking_issues');
    expect(sql).toContain("'comment', issue_rows.comment");
    expect(sql).toContain('revoke all on function public.get_vehicle_booking_issues');
  });
});
