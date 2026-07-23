import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_project_permission_rooms.sql'));

const sql = migrationFile
  ? readFileSync(join(migrationDirectory, migrationFile), 'utf8')
  : '';

describe('project permission Room migration', () => {
  it('creates the Room persistence tables and RPCs', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain('create table if not exists public.project_permission_rooms');
    expect(sql).toContain('create table if not exists public.project_permission_room_members');
    expect(sql).toContain('create table if not exists public.project_permission_room_member_actions');
    for (const name of [
      'project_user_has_room_action',
      'list_project_permission_rooms',
      'get_project_permission_room',
      'list_project_room_staff_candidates',
      'replace_project_permission_room_members',
      'list_project_room_action_recipients',
    ]) expect(sql).toContain(name);
  });

  it('blocks direct writes and audits admin batch changes', () => {
    expect(sql).toContain('revoke insert, update, delete');
    expect(sql).toContain("u.role = 'ADMIN'");
    expect(sql).toContain("'replace_project_permission_room_members'");
    expect(sql).toContain('permission_audit_events');
  });
});
