import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyLogResourceEditor } from '../../components/project/daily-log/DailyLogResourceEditor';
import type { DailyLogCrewContract, DailyLogLaborInput } from '../../types';

const crews: DailyLogCrewContract[] = [{ partnerId: 'crew-1', partnerCode: 'TD01', partnerName: 'Tổ Bùi Đắc Tôn',
  contracts: [{ id: 'sc-1', code: 'HĐGK-01', name: 'Nhân công cốt thép', lines: [{ id: 'line-1', code: 'CN01', name: 'Công nhật cốt thép', unit: 'công' }] }] }];
const line = (input: Partial<DailyLogLaborInput>): DailyLogLaborInput => ({ workItemClientKey: 'w1', laborType: '', peopleCount: 5, hoursPerPerson: 8, provider: { entryMode: 'catalog' }, ...input });
const render = (labor: DailyLogLaborInput[], crewContracts = crews) => renderToStaticMarkup(<DailyLogResourceEditor workItemClientKey="w1"
  resourceProviders={[{ id: 'sup-1', code: 'NCC1', name: 'Nhà cung cấp A', isActive: true } as any, { id: 'crew-1', code: 'TD01', name: 'Tổ Bùi Đắc Tôn', isActive: true } as any]}
  crewContracts={crewContracts} labor={labor} machines={[]} onLaborChange={() => undefined} onMachinesChange={() => undefined} />);

describe('Daily Log crews and contract lines', () => {
  it('lists contracted crews first, once, and names the typed-crew option', () => {
    const html = render([line({})]);
    expect(html).toContain('<optgroup label="Tổ đội có hợp đồng tại dự án">');
    expect(html.match(/Tổ Bùi Đắc Tôn/g)).toHaveLength(1);
    expect(html).toContain('Tổ chưa có hợp đồng (gõ tay)');
  });

  it('offers the crew’s contract lines, with no prices, once the crew is chosen', () => {
    const html = render([line({ provider: { entryMode: 'catalog', partnerId: 'crew-1' }, contractItemId: 'line-1' })]);
    expect(html).toContain('Dòng công việc theo hợp đồng');
    expect(html).toContain('HĐGK-01 · CN01 · Công nhật cốt thép (công)');
    expect(html).toContain('Không tính công nhật');
  });

  it('marks a typed crew as waiting for a contract', () => {
    const html = render([line({ provider: { entryMode: 'manual', manualProviderType: 'free_crew', manualProviderName: 'tổ Phan Hữu Trịnh' } })]);
    expect(html).toContain('Chờ gắn hợp đồng');
    expect(html).not.toContain('Dòng công việc theo hợp đồng');
  });

  it('validates links in the database and never returns prices to engineers', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260929120000_daily_log_crew_contracts.sql'), 'utf8');
    expect(sql).toContain("message = 'DAILY_LOG_LABOR_CONTRACT_INVALID'");
    expect(sql).toContain("and sc.project_id = new.project_id and sc.status in ('signed', 'active')");
    expect(sql).toContain("check (classifications <@ array['owner', 'contractor', 'supplier', 'crew']::text[])");
    expect(sql).toContain("nullif(v_line->>'contractItemId','')::uuid");
    const rpc = sql.slice(sql.indexOf('create or replace function public.get_daily_log_crew_contracts_v1'), sql.indexOf('revoke all on function public.get_daily_log_crew_contracts_v1'));
    expect(rpc).not.toMatch(/unit_price|total_price|value/);
    expect(sql.match(/array\['supplier', 'contractor', 'crew'\]::text\[\]/g)).toHaveLength(3);
  });
});
