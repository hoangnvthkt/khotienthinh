import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hookSource = readFileSync(join(process.cwd(), 'hooks/project/material/useProjectMaterialAccess.ts'), 'utf8');
const supplySource = readFileSync(join(process.cwd(), 'pages/project/SupplyChainTab.tsx'), 'utf8');
const templateSource = readFileSync(join(process.cwd(), 'lib/permissions/projectPermissionTemplates.ts'), 'utf8');

describe('Material PO frontend authoritative Room cutover', () => {
  it('keeps the Supply shell gate separate from Room canViewPo', () => {
    expect(hookSource).toContain('canViewPo: materialCapabilities.canViewPo');
    expect(hookSource).toContain("tab.key === 'po'");
    expect(hookSource).toContain('Boolean(scoped?.canView)');
  });

  it('does not fetch or render PO data without Room view', () => {
    expect(supplySource).toContain('canViewPo ? poService.list');
    expect(supplySource).toContain("subTab === 'po' && canViewPo");
    expect(supplySource).toContain("subTab === 'po' && !canViewPo");
    expect(supplySource).toContain('Chưa có quyền xem Đơn hàng PO');
    expect(supplySource).toContain('<strong>Xem</strong> trong Room Đơn hàng PO');
  });

  it('removes Room-managed PO codes from new PBAC templates', () => {
    expect(templateSource).toContain('ROOM_MANAGED_MATERIAL_PO_PERMISSION_CODES');
    expect(templateSource).toContain('!ROOM_MANAGED_MATERIAL_PO_PERMISSION_CODES.has(action.permissionCode)');
  });
});
