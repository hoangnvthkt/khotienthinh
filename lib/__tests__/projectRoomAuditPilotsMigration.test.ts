import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_project_room_permission_audit_pilots.sql'));
const sql = migrationFile
  ? readFileSync(join(migrationDirectory, migrationFile), 'utf8')
  : '';

describe('Project Room audit and pilot migration', () => {
  it('registers every Room/action and exposes the effective actor action RPC', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain('app_private.project_permission_room_action_bindings');
    expect(sql).toContain('app_private.project_actor_has_effective_room_action');
    expect(sql).toContain('public.get_my_project_room_actions');
    expect(sql).toContain('public.get_my_project_room_pbac_exceptions');
    expect(sql).toContain('app_private.current_actor_has_effective_room_action');
    expect(sql).toMatch(/revoke all on function app_private\.project_actor_has_effective_room_action[\s\S]*from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on function app_private\.daily_log_has_action[\s\S]*from public, anon, authenticated/);
    expect(sql).not.toMatch(/grant execute on function app_private\.daily_log_has_action[\s\S]*to authenticated/);
    expect(sql).toContain('public.get_project_permission_room_health_summary');
    expect(sql).toContain('project_room_pbac_fallback_enabled');
    expect(sql).toContain("'audit_only'");
    expect(sql).toContain("'pilot'");
    expect(sql).toContain("'enforced'");
  });

  it('makes Daily Log and material-planning the only pilots', () => {
    expect(sql).toContain("'daily_log'");
    expect(sql).toContain("'material_planning'");
    expect(sql).toContain('project.daily_log.create');
    expect(sql).toContain('project.material_boq.delete');
  });

  it('uses effective Room actions in Daily Log and separates BOQ edit from delete', () => {
    expect(sql).toContain("'daily_log',\n      'edit'");
    expect(sql).toContain("'daily_log',\n      'delete'");
    expect(sql).toContain("'material_planning',\n      'delete'");
    expect(sql).not.toMatch(/material_budget_items_delete[\s\S]*?project\.material_boq\.edit/);
    expect(sql).not.toMatch(/project_work_boq_items_delete[\s\S]*?project\.material_boq\.edit/);
  });

  it('backfills without deactivating PBAC and records the batch source', () => {
    expect(sql).toContain('project_room_pbac_backfill');
    expect(sql).toContain('permission_audit_events');
    expect(sql).not.toMatch(/update\s+public\.user_permission_grants[\s\S]*is_active\s*=\s*false/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.user_permission_grants/i);
  });

  it('keeps health findings scoped and excludes admin overrides from PBAC fallback', () => {
    expect(sql).toContain("user_row.role <> 'ADMIN'");
    expect(sql).toContain('user_row.id is null');
    expect(sql).toContain("member.construction_site_id = p_construction_site_id");
  });
});
