import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(name => name.endsWith('_safety_workforce_scoped_read_api.sql'));
const sql = migrationFile
  ? readFileSync(resolve(migrationDirectory, migrationFile), 'utf8').toLowerCase()
  : '';

const functionBody = (name: string, nextName: string): string => {
  const start = sql.indexOf(`create or replace function ${name}`);
  const end = sql.indexOf(`create or replace function ${nextName}`, start + 1);
  return start < 0 ? '' : sql.slice(start, end < 0 ? sql.length : end);
};

const singleFunctionBody = (name: string): string => {
  const start = sql.indexOf(`create or replace function ${name}`);
  const end = sql.indexOf('create or replace function ', start + 1);
  return start < 0 ? '' : sql.slice(start, end < 0 ? sql.length : end);
};

describe('Safety Workforce scoped read API migration', () => {
  it('creates every public scoped read contract', () => {
    expect(migrationFile).toBeDefined();
    for (const signature of [
      'public.get_safety_passport_dashboard(',
      'public.list_safety_site_worker_roster(',
      'public.get_safety_site_worker_detail(',
      'public.lookup_safety_worker_exact(',
      'public.list_safety_site_workforce_options(',
      'public.get_safety_card_by_qr(',
    ]) expect(sql).toContain(signature);
  });

  it('keeps public wrappers invoker-only and privileged assembly private', () => {
    for (const name of [
      'get_safety_passport_dashboard',
      'list_safety_site_worker_roster',
      'get_safety_site_worker_detail',
      'lookup_safety_worker_exact',
      'list_safety_site_workforce_options',
      'get_safety_card_by_qr',
    ]) {
      const wrapper = singleFunctionBody(`public.${name}`);
      expect(wrapper).toContain('security invoker');
      expect(wrapper).toContain("set search_path = ''");
    }

    expect(sql).toContain('create or replace function app_private.list_safety_site_worker_roster');
    expect(sql).toContain('security definer');
    expect(sql).not.toMatch(/\bselect\s+[a-z_]+\.\*/);
    expect(sql).not.toMatch(/service_role/i);
  });

  it('uses scoped keyset pagination and never emits sensitive roster fields', () => {
    const roster = functionBody(
      'app_private.list_safety_site_worker_roster',
      'app_private.get_safety_site_worker_detail',
    );

    expect(roster).toMatch(/\(membership\.created_at, membership\.id\)\s*<\s*\(p_cursor_created_at, p_cursor_id\)/);
    expect(roster).toContain('greatest(1, least(coalesce(p_limit, 50), 100))');
    expect(roster).toContain("p_eligibility_status not in ('eligible', 'missing_profile', 'missing_certificate', 'expired_certificate', 'missing_site_requirement', 'suspended')");
    expect(roster).toContain('(p_cursor_created_at is null) <> (p_cursor_id is null)');
    expect(roster).toContain('membership.project_id = p_project_id');
    expect(roster).toContain('membership.construction_site_id = p_construction_site_id');
    expect(roster).toMatch(/assignment(?:_row)?\.assignment_status = 'active'/);
    expect(roster).toContain("'photostoragepath'");
    expect(roster).not.toContain('identity_attachments');
    expect(roster).not.toContain('identity_number');
    expect(roster).not.toMatch(/select\s+\*/);
  });

  it('requires stronger authorization before sensitive detail or global exact lookup', () => {
    const detail = functionBody(
      'app_private.get_safety_site_worker_detail',
      'app_private.lookup_safety_worker_exact',
    );
    const lookup = functionBody(
      'app_private.lookup_safety_worker_exact',
      'app_private.list_safety_site_workforce_options',
    );

    expect(detail).toContain('app_private.safety_workforce_can_view_sensitive');
    expect(detail).toContain('p_include_sensitive');
    expect(detail).toContain('membership.id = p_membership_id');
    expect(lookup).toContain('app_private.safety_workforce_can_manage');
    expect(lookup).toContain('app_private.safety_workforce_normalize_identity');
    expect(lookup).not.toContain("like '%'");
    expect(lookup).not.toContain("'identitynumber'");
  });

  it('returns only active site masters and protects authenticated QR lookup by card scope', () => {
    const options = functionBody(
      'app_private.list_safety_site_workforce_options',
      'app_private.get_safety_card_by_qr',
    );
    const card = functionBody(
      'app_private.get_safety_card_by_qr',
      'public.get_safety_passport_dashboard',
    );

    expect(options).toContain("subcontractor.status in ('approved', 'active')");
    expect(options).toContain("team.status = 'active'");
    expect(options).toContain('team.subcontractor_id');
    expect(card).toContain('public.current_app_user_id()');
    expect(card).toContain('app_private.safety_workforce_can_view');
    expect(card).toContain('membership.id = assignment.membership_id');
  });

  it('revokes default execution and grants named wrappers only to authenticated actors', () => {
    expect(sql).toContain('revoke all on function public.list_safety_site_worker_roster');
    expect(sql).toContain('from public, anon');
    expect(sql).toContain('grant execute on function public.list_safety_site_worker_roster');
    expect(sql).toContain('to authenticated');
  });
});
