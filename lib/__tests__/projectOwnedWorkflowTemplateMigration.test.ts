import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_project_owned_material_request_workflow.sql'));
const migration = migrationFile
  ? readFileSync(join(migrationsDir, migrationFile), 'utf8')
  : '';

const functionBody = (name: string): string => {
  const start = migration.indexOf(`create or replace function ${name}(`);
  if (start < 0) return '';
  const bodyStart = migration.indexOf('as $$', start);
  const bodyEnd = migration.indexOf('$$;', bodyStart + 5);
  return migration.slice(start, bodyEnd + 3);
};

describe('project-owned material request workflow migration', () => {
  it('adds nullable ownership columns so shared templates keep behaving as today', () => {
    expect(migrationFile).toBeDefined();
    expect(migration).toContain('add column if not exists owner_subject_type text');
    expect(migration).toContain('add column if not exists owner_project_id text');
    expect(migration).toContain('add column if not exists cloned_from_template_id uuid');
    expect(migration).toContain("check (owner_subject_type is null or owner_subject_type = 'material_request')");
    expect(migration).toContain('check ((owner_subject_type is null) = (owner_project_id is null))');
    expect(migration).toContain('on delete set null');
    expect(migration).toContain('workflow_templates_one_active_project_owner_idx');
  });

  it('keeps every redefined function security definer with an empty search_path', () => {
    const names = [
      'app_private.project_owned_workflow_actor_has_room_action',
      'app_private.workflow_template_actor_can_view',
      'app_private.workflow_template_actor_can_edit',
      'app_private.project_workflow_binding_can_manage',
      'public.set_project_workflow_binding',
      'public.clone_project_workflow_template',
      'public.get_project_workflow_configuration',
    ];
    for (const name of names) {
      const body = functionBody(name);
      expect(body, name).not.toBe('');
      expect(body, name).toContain('security definer');
      expect(body, name).toContain("set search_path = ''");
    }
  });

  it('keeps the original template predicates and only adds a room branch for owned copies', () => {
    const canView = functionBody('app_private.workflow_template_actor_can_view');
    const canEdit = functionBody('app_private.workflow_template_actor_can_edit');
    expect(canView).toContain("'workflow.template.view', template_row.created_by, null, p_actor_id");
    expect(canView).toContain('app_private.project_workflow_actor_can_select(subject_row.id)');
    expect(canView).toContain("project_owned_workflow_actor_has_room_action(template_row.id, p_actor_id, 'view')");
    expect(canEdit).toContain("'workflow.template.edit', template_row.created_by, null, p_actor_id");
    expect(canEdit).toContain("project_owned_workflow_actor_has_room_action(template_row.id, p_actor_id, 'edit')");
    expect(canEdit).toContain("project_owned_workflow_actor_has_room_action(template_row.id, p_actor_id, 'view')");
    // RLS predicates must stay callable by signed-in users (see 20260917024602 acl fix).
    expect(migration).toContain('grant execute on function app_private.workflow_template_actor_can_view(uuid, uuid) to authenticated;');
    expect(migration).toContain('grant execute on function app_private.workflow_template_actor_can_edit(uuid, uuid) to authenticated;');
  });

  it('only relaxes binding management for a copy owned by the same project at project scope', () => {
    const canManage = functionBody('app_private.project_workflow_binding_can_manage');
    expect(canManage).toContain('owned.owner_project_id = p_project_id');
    expect(canManage).toContain('p_construction_site_id is null');
    expect(canManage).toContain("'material_request', 'edit'");
    expect(canManage).toContain("'material_request', 'view'");
    // Shared templates keep the original, stricter branch.
    expect(canManage).toContain("public.is_module_admin('DA')");
    expect(canManage).toContain('app_private.project_workflow_template_manager(p_template_id, public.current_app_user_id())');
  });

  it('refuses to bind a project-owned copy anywhere but its own project', () => {
    const setBinding = functionBody('public.set_project_workflow_binding');
    expect(setBinding).toContain('p_project_id is distinct from v_owner_project_id');
    expect(setBinding).toContain('p_construction_site_id is not null');
    expect(setBinding).toContain("'WORKFLOW_TEMPLATE_OWNED_BY_OTHER_SCOPE' using errcode = '42501'");
  });

  it('gates cloning on room material_request edit + view and copies only live steps', () => {
    const clone = functionBody('public.clone_project_workflow_template');
    expect(clone).toContain("project_actor_has_effective_room_action(v_actor, p_project_id, null, 'material_request', 'edit')");
    expect(clone).toContain("project_actor_has_effective_room_action(v_actor, p_project_id, null, 'material_request', 'view')");
    expect(clone).toContain("'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501'");
    expect(clone).toContain('pg_advisory_xact_lock');
    expect(clone).toContain("'cloned', false");
    expect(clone).toContain("coalesce((wn.config ->> '__templateRemoved')::boolean, false) = false");
    expect(clone).toContain("- '__templateRemoved'");
    expect(clone).toContain('wn.position_x, wn.position_y');
    expect(clone).toContain('public.set_project_workflow_binding(p_subject_type, v_template.id, p_project_id, null)');
    // Must not borrow Quy trình catalog authority.
    expect(clone).not.toContain('workflow.template.create');
  });

  it('never opens anon grants', () => {
    expect(migration).not.toMatch(/grant[^;]*\bto\s+[^;]*\banon\b/i);
    expect(migration).toContain('revoke all on function public.clone_project_workflow_template(text, text, uuid) from public, anon;');
    expect(migration).toContain('grant execute on function public.clone_project_workflow_template(text, text, uuid) to authenticated;');
  });

  it('exposes what the project editor needs in the configuration read', () => {
    const config = functionBody('public.get_project_workflow_configuration');
    expect(config).toContain("'canCustomize', v_can_customize");
    expect(config).toContain("'templateName'");
    expect(config).toContain("'templateOwnedByProject'");
    expect(config).toContain("'clonedFromTemplateId'");
    expect(config).toContain("'Chưa cấu hình workflow cho đề xuất vật tư.'");
  });
});
