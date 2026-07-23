import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_enforce_project_room_workflow_actions.sql'));

const sql = migrationFile
  ? readFileSync(join(migrationDirectory, migrationFile), 'utf8')
  : '';

describe('project Room workflow enforcement migration', () => {
  it('requires a Room action before project workflow status can change', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain('assert_project_permission_room_action');
    expect(sql).toContain('project_user_has_room_action');
  });

  it('checks both the actor and the selected PO/material-request recipient', () => {
    expect(sql).toContain('transition_project_purchase_order_status');
    expect(sql).toContain('transition_project_material_request_status');
    expect(sql).toContain('p_target_user_id');
    expect(sql).toContain("'material_po'");
    expect(sql).toContain("'material_request'");
  });
});
