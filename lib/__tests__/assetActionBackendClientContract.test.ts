import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const appContext = fs.readFileSync(path.join(root, 'context/AppContext.tsx'), 'utf8');
const assetCatalog = fs.readFileSync(path.join(root, 'pages/ts/AssetCatalog.tsx'), 'utf8');
const assetAssignment = fs.readFileSync(path.join(root, 'pages/ts/AssetAssignment.tsx'), 'utf8');
const assetMaintenance = fs.readFileSync(path.join(root, 'pages/ts/AssetMaintenance.tsx'), 'utf8');
const assetProfile = fs.readFileSync(path.join(root, 'pages/ts/AssetProfile.tsx'), 'utf8');

describe('Asset backend client operation contract', () => {
  it('routes destructive and status-changing operations through operation-specific RPCs', () => {
    expect(appContext).toContain("supabase.rpc('dispose_asset'");
    expect(appContext).toContain("supabase.rpc('record_asset_assignment'");
    expect(appContext).toContain("supabase.rpc('record_asset_maintenance'");
    expect(appContext).toContain("supabase.rpc('complete_asset_maintenance'");
    expect(appContext).toContain("supabase.rpc('transfer_asset_stock'");
  });

  it('does not use fire-and-forget Asset table sync for primary action handlers', () => {
    expect(appContext).toMatch(/const updateAsset = async/);
    expect(appContext).toMatch(/const removeAsset = async/);
    expect(appContext).toMatch(/const addAssetAssignment = async/);
    expect(appContext).toMatch(/const addAssetMaintenance = async/);
    expect(appContext).toMatch(/const updateAssetMaintenance = async/);
    expect(appContext).not.toMatch(/syncToSupabase\('asset_assignments'/);
    expect(appContext).not.toMatch(/syncToSupabase\('asset_maintenances'/);
  });

  it('awaits backend confirmation before showing success in Asset pages', () => {
    expect(assetCatalog).toContain('await removeAsset(id)');
    expect(assetCatalog).toContain('await disposeAsset(');
    expect(assetAssignment).toMatch(/const handleAssign = async/);
    expect(assetAssignment).toContain('await addAssetAssignment');
    expect(assetAssignment).toMatch(/const handleReturn = async/);
    expect(assetAssignment).toMatch(/const handleTransfer = async/);
    expect(assetMaintenance).toMatch(/const handleSave = async/);
    expect(assetMaintenance).toContain("await addAssetMaintenance(m, 'import')");
    expect(assetMaintenance).toContain('await updateAssetMaintenance');
    expect(assetProfile).toMatch(/const handleAddMaintenance = async/);
    expect(assetProfile).toContain('await addAssetMaintenance(m)');
  });
});
