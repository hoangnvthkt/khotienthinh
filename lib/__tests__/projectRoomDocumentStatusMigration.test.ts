import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_enforce_project_room_document_statuses.sql'));

const sql = migrationFile
  ? readFileSync(join(migrationDirectory, migrationFile), 'utf8')
  : '';

describe('project Room document-status enforcement migration', () => {
  it('maps each status transition to a concrete Room action', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain('assert_project_permission_room_action');
    expect(sql).toContain("'submit'");
    expect(sql).toContain("'verify'");
    expect(sql).toContain("'approve'");
    expect(sql).toContain("'confirm'");
  });

  it('guards all Room-routed project document tables', () => {
    for (const table of [
      'daily_logs',
      'quality_checklists',
      'quantity_acceptances',
      'payment_certificates',
      'contract_variations',
      'boq_reconciliation_groups',
    ]) expect(sql).toContain(table);
  });
});
