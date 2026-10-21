import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261012113900_procurement_site_scope.sql'), 'utf8');
const materialTab = readFileSync(join(process.cwd(), 'pages/project/MaterialTab.tsx'), 'utf8');

describe('Mua hàng cho người công trường; PO + Mua nóng rời Dự án', () => {
  it('chỉ mở quyền xem đơn của dự án mình, không thêm quyền thao tác', () => {
    expect(migration).toContain("current_actor_has_effective_room_action(pr.id::text, pr.construction_site_id::text, 'material_po', 'view')");
    expect(migration).toContain('and (v_scope is null or project_id = any(v_scope) or (is_group and link_projects::text[] && v_scope))');
    // Quyền thao tác trong chi tiết đơn vẫn theo phòng Mua hàng.
    expect(migration).toContain("v_manage := app_private.procurement_can('manage');");
    expect(migration).not.toMatch(/'canApprove',\s*true/);
  });

  it('mua nóng ở Mua hàng theo đúng luật lập mua nóng của dự án', () => {
    expect(migration).toContain("(app_private.procurement_can('manage') or app_private.hot_purchase_can_create(pr.id::text, pr.construction_site_id::text))");
  });

  it('tab Vật tư không còn render màn PO / Mua nóng, link cũ chuyển sang Mua hàng', () => {
    expect(materialTab).not.toContain('<SupplyChainTab');
    expect(materialTab).not.toContain('<HotPurchaseView');
    expect(materialTab).toContain("navigate(`/procurement/project-po?${target.toString()}`, { replace: true });");
    expect(materialTab).toContain("new Set<ProjectMaterialTabKey>(['po', 'hot_purchase'])");
  });
});
