import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260903063822_authorization_room_catalog_bootstrap.sql', 'utf8');
const archive = 'supabase/migrations_archive/pre_baseline_20260903/';
const sources = [
  ['20260722021252_project_permission_rooms.sql', 'insert into public.project_permission_rooms (', 'create or replace function'],
  ['20260803081928_project_room_permission_audit_pilots.sql', 'insert into app_private.project_permission_room_action_bindings (', 'insert into app_private.permission_hardening_settings'],
  ['20260804080612_material_po_room_permission_pilot.sql', 'update app_private.project_permission_room_action_bindings', '-- Rollback contract'],
  ['20260804095711_material_po_room_authoritative_cutover.sql', 'update app_private.project_permission_room_action_bindings', 'alter table public.project_permission_room_member_actions'],
  ['20260805090929_material_po_allow_empty_room_configuration.sql', 'update public.project_permission_rooms', 'do $$'],
  ['20260805105313_material_request_room_authoritative_cutover.sql', 'update app_private.project_permission_room_action_bindings', '-- Safe union backfill'],
  ['20260808080743_weekly_progress_period_state.sql', 'delete from app_private.project_permission_room_action_bindings', 'create table public.project_progress_period_states'],
  ['20260813070319_gantt_room_authoritative_cutover.sql', 'delete from app_private.project_permission_room_action_bindings', '-- Keep this migration self-contained'],
  ['20260816075953_quality_room_authoritative_pilot.sql', 'update public.project_permission_rooms', 'create temporary table quality_runtime_before_snapshot'],
];

describe('schema-only Room catalog bootstrap', () => {
  it.each(sources)('replays exact archived metadata from %s, not inferred mappings', (file, start, end) => {
    const source = readFileSync(archive + file, 'utf8');
    const begin = source.indexOf(start);
    const finish = source.indexOf(end, begin);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(finish).toBeGreaterThan(begin);
    expect(migration).toContain(source.slice(begin, finish).trim());
  });

  it('does not replay runtime functions, grant backfills, or domain writes', () => {
    expect(migration).not.toMatch(/create (?:or replace )?function/i);
    expect(migration).not.toMatch(/(?:insert into|update|delete from) (?:public\.(?:users|projects|project_staff|project_permission_room_members|project_permission_room_member_actions|user_permission_grants)|auth\.users)\b/i);
    expect(migration).not.toContain('quality_runtime_pbac_candidates');
    expect(migration).not.toContain('material_request_room_backfill_candidates');
  });

  it('serializes catalog initialization and preserves populated environments', () => {
    expect(migration).toContain('in share row exclusive mode');
    expect(migration).toMatch(/if exists \(select 1 from public\.project_permission_rooms\) then\s+return;/);
    expect(migration).toContain('AUTHORIZATION_BOOTSTRAP_NONEMPTY');
  });
});
