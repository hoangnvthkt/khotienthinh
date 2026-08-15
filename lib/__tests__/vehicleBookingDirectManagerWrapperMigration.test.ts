import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260815033046_request_vehicle_direct_manager_wrapper_execution.sql',
), 'utf8').toLowerCase();

describe('vehicle booking public wrapper execution migration', () => {
  it.each([
    'preview_vehicle_booking_submission_route',
    'submit_vehicle_booking',
    'update_fleet_system_settings',
    'reassign_vehicle_booking_manager',
  ])('keeps %s public while executing its private helper as the owner', functionName => {
    const functionStart = sql.indexOf(`create or replace function public.${functionName}`);
    const functionEnd = sql.indexOf('$$;', functionStart);
    const definition = sql.slice(functionStart, functionEnd);

    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(definition).toContain('security definer');
    expect(definition).toContain('public.current_app_user_id()');
  });

  it('does not expose the private command helpers to authenticated users', () => {
    expect(sql).not.toMatch(/grant execute on function app_private\.[\s\S]+to authenticated/);
  });
});
