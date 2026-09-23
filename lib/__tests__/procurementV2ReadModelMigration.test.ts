import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../supabase/migrations/20260923103023_procurement_v2_dossier_read_model.sql', import.meta.url), 'utf8');

describe('Procurement V2 document dossier read model', () => {
  it('lists canonical demands at source document grain with scoped access and stable cursor', () => {
    expect(sql).toContain('list_procurement_dossiers_v2');
    expect(sql).toContain('procurement_source_documents');
    expect(sql).toContain("source_adapter in ('project_material_request', 'material_plan')");
    expect(sql).toContain('project_actor_has_effective_room_action');
    expect(sql).toContain('PROCUREMENT_SNAPSHOT_STALE');
    expect(sql).toContain("'grain', 'document'");
  });

  it('returns exact line balances and nullable unknowns without a mixed-unit total or price leak', () => {
    expect(sql).toContain('get_procurement_dossier_v2');
    for (const key of ['approvedQty', 'reservedQty', 'committedQty', 'fulfilledQty',
      'closedQty', 'availableToPlanQty', 'neededDate', 'destinationId', 'sourceLineId'])
      expect(sql).toContain(`'${key}'`);
    expect(sql).toContain('balance_known');
    expect(sql).not.toContain("'totalQuantity'");
    expect(sql).not.toContain("'unitPrice'");
  });
});
