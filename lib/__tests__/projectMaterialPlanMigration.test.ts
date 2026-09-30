import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260930190000_project_material_plans.sql'), 'utf8').toLowerCase();

describe('Kế hoạch vật tư migration', () => {
  it('derives needs from the approved work plan through BOQ materials of each work item', () => {
    expect(sql).toContain('round(l.planned_qty / l.total_qty_snapshot * b.budget_qty, 3)');
    expect(sql).toContain('join public.material_budget_items b on b.work_boq_item_id = l.work_boq_item_id');
    expect(sql).toContain("message = 'material_plan_work_plan_not_approved'");
  });

  it('reports work it cannot convert instead of guessing', () => {
    for (const reason of ['no_planned_qty', 'no_work_qty', 'no_boq_material', 'no_item_code']) expect(sql).toContain(`'${reason}'`);
  });

  it('suggests only what site stock does not cover and treats a missing balance row as zero', () => {
    expect(sql).toContain('round(greatest(x.need_qty - greatest(coalesce(x.stock_qty, 0), 0), 0), 3)');
    expect(sql).toContain('then coalesce((select sum(s.on_hand_qty)');
  });

  it('allows over-BOQ requests only with a reason, beyond a rounding tolerance', () => {
    expect(sql).toContain('> pos.boq_qty * 1.0001 + 0.001');
    expect(sql).toContain("message = 'material_plan_over_boq_reason_required'");
  });

  it('is approved by the CHT (work_plan verify) and never edited once approved', () => {
    expect(sql).toContain("app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'verify')");
    expect(sql).toContain("if v_plan.status not in ('draft', 'returned') then raise exception using errcode = 'pt409', message = 'material_plan_not_editable'");
    expect(sql).toContain("set status = 'superseded'");
  });

  it('writes only through RPCs', () => {
    expect(sql).toContain('revoke insert, update, delete on public.project_material_plans');
    for (const table of ['project_material_plans', 'project_material_plan_lines', 'project_material_plan_sources', 'project_material_plan_events']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
  });
});
