import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261009090000_project_material_request_catalog.sql').toLowerCase();

describe('project material request catalog', () => {
  it('gates the catalog on the material_request edit room action of the project', () => {
    expect(sql).toContain('list_project_material_request_catalog_v1');
    expect(sql).toMatch(/current_actor_has_effective_room_action\(\s*nullif\(p_project_id, ''\), nullif\(p_construction_site_id, ''\),\s*'material_request', 'edit'/);
    expect(sql).toContain('security definer');
    expect(sql).toContain("set search_path to ''");
    expect(sql).toMatch(/revoke all on function public\.list_project_material_request_catalog_v1\(text, text\) from public, anon/);
  });

  it('exposes identification columns only, never price, stock or supplier', () => {
    const select = sql.slice(sql.indexOf('select item.id'), sql.indexOf('from public.items'));
    expect(select).not.toMatch(/price|stock_by_warehouse|supplier|min_stock/);
  });

  it('is registered in the post-baseline migration allowlist', () => {
    expect(read('supabase/baseline/current.json')).toContain('20261009090000_project_material_request_catalog.sql');
  });

  it('request form falls back to the project catalog and explains an empty catalog', () => {
    const modal = read('components/RequestModal.tsx');
    expect(modal).toContain('materialRequestService.getProjectCatalog');
    expect(modal).toContain("appItems.length > 0 ? appItems : projectCatalog");
    expect(modal).toContain('Chưa có danh mục vật tư');
    expect(modal).toMatch(/showStockQuantities=\{canSeeAvailability && !isUsingProjectCatalog\}/);
  });
});
