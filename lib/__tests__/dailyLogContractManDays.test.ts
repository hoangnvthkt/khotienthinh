import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const sql = read('supabase/migrations/20260929180000_daily_log_contract_man_days.sql');

describe('Daily Log man-day acceptance', () => {
  it('counts only CHT-approved logs and the approved summary copy of each linked slip line', () => {
    expect(sql).toContain("log.status = 'verified' and log.superseded_by_daily_log_id is null");
    expect(sql).toContain('join public.daily_log_labor copy on copy.source_labor_line_id = source.id');
  });

  it('never counts an individual older log on a day that has a verified summary', () => {
    expect(sql).toContain("log.summary_source_type = 'member_contributions' or not exists (");
  });

  it('converts per contract line and requires acceptance view rights', () => {
    expect(sql).toContain("when i.basis = 'person_day' then c.people else c.hours / 8 end");
    expect(sql).toContain("coalesce(item.labor_day_basis, 'hours_8')");
    expect(sql).toContain("'quantity_acceptance', 'view')) then");
  });

  it('builds man-day acceptance items that replace quantity items and keep their labor sources', () => {
    const service = read('lib/quantityAcceptanceService.ts');
    expect(service).toContain("params.contractType === 'subcontractor'");
    expect(service).toContain('sourceDailyLogLaborIds: row.lineIds');
    expect(service).toContain('!manDayItemIds.has(contractItemId)');
    expect(service).toContain("error.code === '42501'");
  });
});
