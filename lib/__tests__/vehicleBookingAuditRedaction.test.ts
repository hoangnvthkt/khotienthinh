import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260812000014_vehicle_booking_phase3_operations.sql',
  'utf8',
).toLowerCase().replace(/\s+/g, ' ');

describe('vehicle booking audit timeline redaction', () => {
  it('builds a scoped timeline from three operational sources', () => {
    expect(sql).toContain('create or replace function public.get_vehicle_booking_audit_timeline');
    expect(sql).toContain("'booking_event'");
    expect(sql).toContain("'assignment_version'");
    expect(sql).toContain("'handover'");
  });

  it('does not query sensitive issues or return raw audit JSON', () => {
    const timeline = sql.match(/create or replace function public\.get_vehicle_booking_audit_timeline[\s\S]+?\$\$;/)?.[0] || '';
    expect(timeline).not.toContain('vehicle_booking_issues');
    expect(timeline).not.toContain("'olddata'");
    expect(timeline).not.toContain("'newdata'");
    expect(timeline).not.toContain("'comment'");
    expect(timeline).not.toContain("'resolutionnote'");
  });

  it('requires scoped audit permission and keyset pagination', () => {
    expect(sql).toContain('booking.vehicle.view_audit');
    expect(sql).toContain('(timeline.occurred_at, timeline.synthetic_id) <');
    expect(sql).toContain('revoke all on function public.get_vehicle_booking_audit_timeline');
  });
});
