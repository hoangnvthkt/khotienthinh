import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory).find(file =>
  file.endsWith('_allow_pending_material_review_po_demand.sql'),
);
const migration = migrationFile
  ? readFileSync(join(migrationDirectory, migrationFile), 'utf8')
  : '';

describe('material-request procurement demand exception', () => {
  it('allows only material-department-review PENDING requests into the PO source', () => {
    expect(migrationFile).toBeDefined();
    expect(migration).toContain("request_row.status::text in ('APPROVED', 'IN_TRANSIT')");
    expect(migration).toContain("request_row.status::text = 'PENDING'");
    expect(migration).toContain("request_row.workflow_step = 'material_department_review'");
  });

  it('preserves the existing Room PO view authorization and least-privilege grant', () => {
    expect(migration).toContain("'material_po', 'view'");
    expect(migration).toContain('revoke all on function public.list_project_material_request_procurement_demand(text, text) from public, anon');
    expect(migration).toContain('grant execute on function public.list_project_material_request_procurement_demand(text, text) to authenticated');
  });
});
