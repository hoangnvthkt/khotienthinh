import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../supabase/migrations/20260924081548_project_v2_material_boq_position.sql', import.meta.url), 'utf8');

describe('Project V2 BOQ reader migration', () => {
  it('keeps privileged ledger access in a private function behind an invoker RPC', () => {
    expect(sql).toMatch(/create function app_private\.project_v2_material_boq_positions_v1\([\s\S]*?security definer set search_path = ''/i);
    expect(sql).toMatch(/create function public\.list_project_v2_material_boq_positions_v1\([\s\S]*?security invoker set search_path = ''/i);
    expect(sql).toMatch(/grant execute on function app_private\.project_v2_material_boq_positions_v1\(uuid, text\[\]\)\s+to authenticated/i);
  });
});
