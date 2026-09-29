import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260929150000_daily_log_labor_contract_linking.sql'), 'utf8');

describe('Daily Log labor contract linking migration', () => {
  it('lets only acceptance editors link, with an audit row per action', () => {
    expect(sql).toContain("'quantity_acceptance', 'edit')) then");
    expect(sql).toContain("message = 'DAILY_LOG_CONTRACT_LINK_DENIED'");
    expect(sql.match(/insert into public\.daily_log_labor_contract_link_events/g)).toHaveLength(2);
    expect(sql).toContain("message = 'DAILY_LOG_CONTRACT_UNLINK_REASON_REQUIRED'");
    expect(sql).toContain('alter table public.daily_log_labor_contract_link_events enable row level security;');
  });

  it('only links lines of the project to a signed/active labor subcontract line of the project', () => {
    expect(sql).toContain("message = 'DAILY_LOG_LABOR_LINES_OUT_OF_SCOPE'");
    expect(sql).toContain("and sc.project_id = p_project_id and sc.status in ('signed', 'active');");
  });

  it('groups crew names without accents and leading words, and skips generic "Tổ đội" and summary copies', () => {
    expect(sql).toContain("lower(public.unaccent(btrim(coalesce(p_name, ''))))");
    expect(sql).toContain("'^((to doi|to|doi|nhan cong|cong nhat|mr|anh)\\s+)+'");
    expect(sql).toContain("name_key not in ('', 'doi', 'to', 'to doi', 'nhan cong', 'cong nhan')");
    expect(sql).toContain('(labor.contribution_id is not null and labor.resource_semantics_version = 2)');
  });
});
