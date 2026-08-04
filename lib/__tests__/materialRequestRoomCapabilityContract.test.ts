import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_align_material_request_room_actions.sql'));
const migration = migrationFile ? readFileSync(join(migrationDirectory, migrationFile), 'utf8') : '';

describe('material-request Room capability alignment', () => {
  it('does not consume raw audit-only Room actions as frontend capabilities', () => {
    const source = read('hooks/project/material/useProjectMaterialAccess.ts');
    expect(source).toContain('projectPermissionRoomService.listMyActions');
    expect(source).not.toContain('projectPermissionRoomService.hasAction');
    expect(source).not.toContain('MATERIAL_ROOM_ACTION_CHECKS');
  });

  it('uses Room recipients as the authoritative candidate pool for a handoff', () => {
    const source = read('components/project/ProjectWorkflowAssigneeSelect.tsx');
    expect(source).toContain('allowedUserIdSet && !hasExplicitPeoplePool');
  });

  it('enforces Room submit and delete actions in material-request RLS', () => {
    expect(migrationFile).toBeDefined();
    expect(migration).toContain('material_request_can_write_v2');
    expect(migration).toContain('material_request_can_delete_v3');
    expect(migration).toContain("'material_request'");
    expect(migration).toContain("'submit'");
    expect(migration).toContain("'delete'");
    expect(migration).toContain('create policy requests_insert');
    expect(migration).toContain('create policy requests_delete');
  });
});
