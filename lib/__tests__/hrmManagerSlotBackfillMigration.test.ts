import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const directory = join(process.cwd(), 'supabase/migrations');
const file = readdirSync(directory).find(name => name.endsWith('_hrm_manager_slot_backfill.sql'));
const sql = file ? readFileSync(join(directory, file), 'utf8') : '';

describe('HRM manager slot backfill migration', () => {
  it('maps legacy positions to the approved E-level framework', () => {
    expect(file).toBeDefined();
    expect(sql).toContain("when 'Trưởng phòng' then 'E7'");
    expect(sql).toContain("when 'Chuyên viên' then 'E4'");
    expect(sql).toContain("when 'Nhân viên' then 'E1'");
  });

  it('selects one manager slot per occupied unit and links staff slots to it', () => {
    expect(sql).toContain('manager_slot_id = ranked.slot_id');
    expect(sql).toContain('row_number() over');
    expect(sql).toContain('reports_to_slot_id = org.manager_slot_id');
    expect(sql).toContain('slot.id <> org.manager_slot_id');
  });
});
