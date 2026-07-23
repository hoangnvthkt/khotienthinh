import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationDir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const migrationName = readdirSync(migrationDir).find(name => name.endsWith('_po_actual_receipt_wms.sql'));
if (!migrationName) throw new Error('PO actual receipt migration file not found');
const migration = readFileSync(`${migrationDir}/${migrationName}`, 'utf8');

describe('PO actual receipt migration contract', () => {
  it('stores direct WMS link and attachment metadata', () => {
    expect(migration).toContain('wms_transaction_id text');
    expect(migration).toContain("attachments jsonb not null default '[]'::jsonb");
  });

  it('keeps one WMS source per delivery batch', () => {
    expect(migration).toContain('po_delivery_batch');
    expect(migration).toContain('unique');
  });

  it('does not retain the old hard upper quantity guard', () => {
    expect(migration).not.toContain('v_new_qty > v_old_qty');
    expect(migration).toContain('varianceReason');
  });
});
