import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Tài chính đợt 1: Tổng quan cho Ban giám đốc, Sức khỏe dự án, Việc cần làm (chủ SP duyệt 03/10/2026).

const sql = readFileSync('supabase/migrations/20261008133900_finance_overview.sql', 'utf8');
const ui = readFileSync('components/finance/FinanceOverviewView.tsx', 'utf8');

describe('Tổng quan Tài chính', () => {
  it('chỉ Tài chính — Quản trị / Admin xem số toàn công ty; chi phí không gồm dòng chi tiền NCC', () => {
    expect(sql).toContain("if not app_private.finance_can('manage') then");
    expect(sql).toContain("return jsonb_build_object('canOverview', false");
    expect(sql).toContain("not like 'supplier_payment_batch:%'");
    expect(sql).toContain('app_private.finance_project_gantt_progress(s.id)');
  });

  it('tiến độ theo Gantt như màn dự án; số chưa có nguồn là null, không phải 0', () => {
    expect(sql).toContain('estimated_cost_per_day * dur');
    expect(sql).toContain("'contractValue', (select nullif(sum(c.value), 0)");
    expect(sql).toContain("'materialBudget', (select nullif(sum(m.budget_total), 0)");
    expect(ui).toContain("const NO_DATA = 'Chưa có dữ liệu'");
    expect(ui).toContain('tiến độ Gantt × HĐ');
  });
});
