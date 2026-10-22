import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261027210000_procurement_save_po_snapshot_sources.sql'), 'utf8');
const allocationLoop = sql.slice(sql.indexOf("for al in select value from jsonb_array_elements(it->'allocations') loop"), sql.indexOf('end loop;'));

describe('save PO snapshots demand once (22/10: 67 vật tư × 3 phiếu hết giờ 8 s)', () => {
  it('reads the procurement inbox once, before the allocation loop', () => {
    expect(sql.match(/app_private\.procurement_inbox_lines\(\)/g)).toHaveLength(1);
    expect(sql.match(/app_private\.procurement_inbox_documents\(\)/g)).toHaveLength(1);
    expect(sql.indexOf('insert into pg_temp.hub_src')).toBeLessThan(sql.indexOf('for it in select value'));
  });

  it('looks allocations up in the snapshot and keeps the same errors', () => {
    expect(allocationLoop).toContain('from pg_temp.hub_src s');
    expect(allocationLoop).not.toContain('procurement_inbox_lines');
    expect(allocationLoop).toContain("'PROCUREMENT_SOURCE_NOT_FOUND'");
    expect(allocationLoop).toContain("'PROCUREMENT_NEED_CLOSED'");
    expect(sql).toContain("errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'");
    expect(sql).not.toContain("'40001'");
  });
});
