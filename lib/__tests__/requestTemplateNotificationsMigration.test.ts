import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260930160000_request_template_notifications_and_manager_coverage.sql'), 'utf8');

describe('request template notifications migration', () => {
  it('suppresses an event only when the template explicitly disables it', () => {
    expect(sql).toContain("jsonb_typeof(v_config->v_config_key)='boolean' and (v_config->>v_config_key)::boolean=false");
    for (const key of ['SUBMITTED', 'ASSIGNED', 'REASSIGNED', 'REMINDER', 'RETURNED', 'APPROVED', 'REJECTED']) {
      expect(sql).toContain(`then '${key}'`);
    }
    expect(sql).not.toMatch(/COMMENT[A-Z_]*' then '/);
  });

  it('limits direct-manager coverage to template managers', () => {
    expect(sql).toContain("not app_private.request_user_can_manage(v_actor)");
    expect(sql).toContain('revoke all on function public.request_direct_manager_coverage() from public, anon;');
  });
});
