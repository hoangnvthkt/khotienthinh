import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260930103243_request_template_lifecycle_keeps_published.sql'),
  'utf8',
);
const fn = (name: string) => sql.match(new RegExp(`create or replace function ${name}\\([\\s\\S]*?\\$function\\$;`, 'i'))?.[0] ?? '';

describe('request template lifecycle migration', () => {
  it('keeps a published template usable while its next version is drafted', () => {
    const save = fn('app_private\\.save_request_template_draft');
    expect(save).toMatch(/lifecycle_status = case\s+when v_template\.current_version_id is null then 'DRAFT'\s+else v_template\.lifecycle_status/);
    const fromPublished = fn('app_private\\.create_request_template_draft_from_published');
    expect(fromPublished).not.toMatch(/lifecycle_status\s*=\s*'DRAFT'/);
  });

  it('continues an existing draft instead of stacking versions', () => {
    const fromPublished = fn('app_private\\.create_request_template_draft_from_published');
    expect(fromPublished.indexOf("and status = 'DRAFT'")).toBeLessThan(fromPublished.indexOf('insert into public.request_template_versions'));
  });

  it('exposes draft state and reactivation to template managers only', () => {
    expect(fn('app_private\\.request_template_summary')).toContain("'hasDraft', exists");
    expect(fn('app_private\\.reactivate_request_template')).toContain('request_user_can_manage(v_actor)');
    expect(sql).toContain('revoke all on function public.reactivate_request_template(uuid, timestamptz) from public, anon;');
    expect(sql).toContain('grant execute on function public.reactivate_request_template(uuid, timestamptz) to authenticated;');
  });

  it('restores templates hidden by the old edit flow', () => {
    expect(sql).toMatch(/update public\.request_templates template\s+set lifecycle_status = 'PUBLISHED'\s+where template\.lifecycle_status = 'DRAFT'/);
  });
});
