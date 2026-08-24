import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(name => name.endsWith('_safety_workforce_scoped_commands.sql'));
const sql = migrationFile
  ? readFileSync(resolve(migrationDirectory, migrationFile), 'utf8').toLowerCase()
  : '';

const singleFunctionBody = (name: string): string => {
  const start = sql.indexOf(`create or replace function ${name}`);
  const end = sql.indexOf('create or replace function ', start + 1);
  return start < 0 ? '' : sql.slice(start, end < 0 ? sql.length : end);
};

const commandNames = [
  'create_safety_worker_profile_for_site',
  'update_safety_worker_profile_for_site',
  'upsert_safety_worker_documents_for_site',
  'assign_safety_worker_to_site',
  'update_safety_worker_assignment',
  'end_safety_worker_assignment',
  'transfer_safety_worker_site',
  'issue_safety_assignment_card',
  'renew_safety_assignment_card',
  'revoke_safety_assignment_card',
  'log_safety_card_print',
] as const;

describe('Safety Workforce scoped command migration', () => {
  it('creates every named public command contract', () => {
    expect(migrationFile).toBeDefined();
    for (const name of commandNames) {
      expect(sql).toContain(`create or replace function public.${name}`);
      expect(sql).toContain(`create or replace function app_private.${name}`);
    }
  });

  it('keeps actor derivation and writes inside hardened private definers', () => {
    for (const name of commandNames) {
      const privateBody = singleFunctionBody(`app_private.${name}`);
      const publicBody = singleFunctionBody(`public.${name}`);
      expect(privateBody).toContain('security definer');
      expect(privateBody).toContain("set search_path = ''");
      expect(publicBody).toContain('security invoker');
      expect(publicBody).toContain("set search_path = ''");
    }
    expect(sql).toContain('public.current_app_user_id()');
    expect(sql).not.toMatch(/p_actor(_user)?_id/i);
    expect(sql).not.toMatch(/service_role/i);
  });

  it('serializes active assignment changes by locking the global worker row', () => {
    const assignmentCommands = [
      'assign_safety_worker_to_site',
      'update_safety_worker_assignment',
      'end_safety_worker_assignment',
      'transfer_safety_worker_site',
      'issue_safety_assignment_card',
    ];
    for (const name of assignmentCommands) {
      const body = singleFunctionBody(`app_private.${name}`);
      const workerLock = body.search(/from public\.safety_worker_profiles worker[\s\S]+?for update/);
      const laterMembershipLock = body.indexOf('membership.id', workerLock);
      expect(workerLock, `${name} must lock the worker`).toBeGreaterThan(-1);
      expect(laterMembershipLock, `${name} must lock membership after worker`).toBeGreaterThan(workerLock);
    }

    const assign = singleFunctionBody('app_private.assign_safety_worker_to_site');
    const transfer = singleFunctionBody('app_private.transfer_safety_worker_site');
    expect(assign).toContain('SAFETY_WORKER_ACTIVE_ELSEWHERE'.toLowerCase());
    expect(transfer).toContain('order by membership.id for update');
    expect(transfer).toContain('safety_transfer_permission_required');
  });

  it('validates site masters and keeps end/transfer/card lifecycle atomic', () => {
    expect(sql).toContain('app_private.safety_workforce_assert_subcontractor_team');
    expect(sql).toContain("status = 'revoked'");
    expect(sql).toContain('safety_assignment_not_eligible');
    expect(sql).toContain('safety_active_card_exists');
    expect(sql).toContain("nullif(trim(p_reason), '') is null");
    expect(sql).toContain('p_ended_at <');
  });

  it('generates unique active card codes and records print/audit side effects', () => {
    expect(sql).toContain('create sequence if not exists public.safety_card_code_seq');
    expect(sql).toContain('safety_cards_one_active_per_assignment_idx');
    expect(sql).toContain("where status = 'active'");
    expect(sql).toContain("'safe-card-' || lpad(nextval('public.safety_card_code_seq')::text, 5, '0')");
    expect(sql).toContain('insert into public.safety_card_print_logs');
    expect(sql).toContain('printed_count = card.printed_count + 1');
    expect(sql).toContain('insert into public.safety_audit_logs');
  });

  it('returns the scoped detail model and exposes only authenticated wrappers', () => {
    expect(sql).toContain('app_private.get_safety_site_worker_detail');
    expect(sql).toContain('revoke all on function public.assign_safety_worker_to_site');
    expect(sql).toContain('from public, anon');
    expect(sql).toContain('grant execute on function public.assign_safety_worker_to_site');
    expect(sql).toContain('to authenticated');
  });
});
