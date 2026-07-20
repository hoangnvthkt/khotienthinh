import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('asset action page gates', () => {
  it('AssetCatalog uses explicit action policy instead of broad canCRUD', () => {
    const source = read('pages/ts/AssetCatalog.tsx');

    expect(source).toContain('buildAssetCatalogActionPolicy');
    expect(source).toContain("'create'");
    expect(source).toContain("'edit'");
    expect(source).toContain("'delete'");
    expect(source).toContain("'dispose'");
    expect(source).toContain("'import'");
    expect(source).toContain("'transfer_stock'");
    expect(source).not.toContain("canCRUD = canManage('/ts/catalog')");
  });

  it('AssetAssignment gates assign, return, and transfer with explicit policy', () => {
    const source = read('pages/ts/AssetAssignment.tsx');

    expect(source).toContain('buildAssetAssignmentActionPolicy');
    expect(source).toContain("'assign'");
    expect(source).toContain("'return'");
    expect(source).toContain("'transfer'");
  });

  it('AssetMaintenance and AssetProfile gate maintenance create/import/complete with explicit policy', () => {
    const maintenance = read('pages/ts/AssetMaintenance.tsx');
    const profile = read('pages/ts/AssetProfile.tsx');

    expect(maintenance).toContain('buildAssetMaintenanceActionPolicy');
    expect(maintenance).toContain("'create'");
    expect(maintenance).toContain("'import'");
    expect(maintenance).toContain("'complete'");
    expect(profile).toContain('buildAssetMaintenanceActionPolicy');
  });

  it('AssetAudit and AssetReports gate audit/report export with explicit policy', () => {
    const audit = read('pages/ts/AssetAudit.tsx');
    const reports = read('pages/ts/AssetReports.tsx');

    expect(audit).toContain('buildAssetAuditActionPolicy');
    expect(audit).toContain("'perform'");
    expect(audit).toContain("'export'");
    expect(reports).toContain('buildAssetAuditActionPolicy');
  });
});
