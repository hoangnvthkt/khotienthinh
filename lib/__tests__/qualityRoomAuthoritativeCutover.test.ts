import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationBySuffix = (suffix: string) => {
  const directories = [
    join(process.cwd(), 'supabase', 'migrations'),
    join(process.cwd(), 'supabase', 'pending_migrations'),
  ];
  for (const directory of directories) {
    const file = readdirSync(directory).find(name => name.endsWith(suffix));
    if (file) return readFileSync(join(directory, file), 'utf8').toLowerCase().replace(/\s+/g, ' ');
  }
  throw new Error(`Missing migration *${suffix}`);
};

describe('Quality Room authoritative cutover', () => {
  it('pilots quality view with a safe exact-scope backfill', () => {
    const sql = migrationBySuffix('_quality_room_view_pilot.sql');

    expect(sql).toContain("'quality', 'view'");
    expect(sql).toContain("'project.quality.view'");
    expect(sql).toContain("'pilot'");
    expect(sql).toContain('pbac_fallback_enabled = true');
    expect(sql).toContain('matching_staff_count = 1');
    expect(sql).toContain("grant_source = 'manual_room'");
    expect(sql).toContain("'quality_room_view_pilot'");
  });

  it('pilots all runtime actions without broadening own-only grants', () => {
    const sql = migrationBySuffix('_quality_room_authoritative_pilot.sql');

    for (const action of ['view', 'edit', 'delete', 'submit', 'verify', 'approve']) {
      expect(sql).toContain(`'quality', '${action}'`);
    }
    for (const permission of [
      'project.quality.edit_all',
      'project.quality.checklist_edit_all',
      'project.quality.delete_all',
      'project.quality.submit',
      'project.quality.verify',
      'project.quality.approve',
      'project.quality.return',
      'project.quality.manage',
    ]) {
      expect(sql).toContain(permission);
    }
    for (const permission of [
      'project.quality.create',
      'project.quality.checklist_create',
      'project.quality.edit_own',
      'project.quality.checklist_edit_own',
      'project.quality.delete_own',
    ]) {
      expect(sql).toMatch(new RegExp(`unresolved[\\s\\S]{0,1200}${permission.replaceAll('.', '\\.')}`));
    }
    expect(sql).toContain("array['view', 'edit']::text[]");
    expect(sql).toContain('revoke insert, update, delete on public.quality_checklists from authenticated');
    expect(sql).toContain('revoke insert, update, delete on public.quality_inspection_attempts from authenticated');
  });

  it('provides idempotent commands, scoped RLS and protected quality uploads', () => {
    const sql = migrationBySuffix('_quality_room_authoritative_pilot.sql');

    for (const rpc of [
      'create_quality_checklist',
      'update_quality_checklist',
      'transition_quality_checklist',
      'delete_quality_checklist',
      'create_quality_inspection_attempt',
    ]) {
      expect(sql).toContain(`public.${rpc}`);
    }
    expect(sql).toContain('app_private.quality_command_requests');
    expect(sql).toContain('quality_request_id_reused');
    expect(sql).toContain('quality_stale_version');
    expect(sql).toContain('quality_recipient_invalid');
    expect(sql).toContain("project_actor_has_effective_room_action");
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).toContain("split_part(name, '/', 1) = 'quality'");
    expect(sql).toContain("split_part(name, '/', 2)");
    expect(sql).toContain("split_part(name, '/', 3)");
  });

  it('keeps the deployed legacy upload path scoped during the frontend rollout', () => {
    const sql = migrationBySuffix('_quality_storage_legacy_path_rollout_compat.sql');

    expect(sql).toContain("split_part(name, '/', 5)");
    expect(sql).toContain('from public.projects project_row');
    expect(sql).toContain('project_row.construction_site_id::text = path.site_id');
    expect(sql).toContain('app_private.project_actor_has_effective_room_action');
    expect(sql).toContain("'quality', 'edit'");
    expect(sql).toContain("'quality_storage_legacy_path_rollout_compat'");
  });

  it('keeps enforcement behind a zero-fallback promotion gate', () => {
    const sql = migrationBySuffix('quality_room_enforcement_after_uat.sql');

    expect(sql).toContain('fallback_only_user_count');
    expect(sql).toContain('quality_promotion_blocked');
    expect(sql).toContain("enforcement_status = 'enforced'");
    expect(sql).toContain('pbac_fallback_enabled = false');
  });
});
