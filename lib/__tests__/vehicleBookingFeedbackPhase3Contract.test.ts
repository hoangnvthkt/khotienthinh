import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260812000014_vehicle_booking_phase3_operations.sql';
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8').toLowerCase().replace(/\s+/g, ' ')
  : '';

describe('vehicle booking phase 3 feedback command contract', () => {
  it('requires and persists a rating for regular and issue feedback', () => {
    expect(sql).toContain("message = 'rating_required'");
    expect(sql.match(/rating = p_rating/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('validates stable positive tags and issue categories', () => {
    expect(sql).toContain('clean_vehicle');
    expect(sql).toContain('courteous_driver');
    expect(sql).toContain('driver_conduct');
    expect(sql).toContain('service_delay');
  });

  it('redacts issue content from shared audit data', () => {
    const feedbackFunction = sql.match(/create or replace function app_private\.command_submit_vehicle_feedback[\s\S]+?\$\$;/)?.[0] || '';
    expect(feedbackFunction).toContain('nội dung đã ẩn');
    expect(feedbackFunction).not.toContain("'comment', p_comment");
    expect(feedbackFunction).not.toContain("'resolution_note'");
  });
});
