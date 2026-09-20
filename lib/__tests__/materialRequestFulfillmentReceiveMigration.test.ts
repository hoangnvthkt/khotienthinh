import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260919232000_atomic_material_request_fulfillment_receive.sql', import.meta.url),
  'utf8',
).toLowerCase().replace(/\s+/g, ' ');
const smoke = readFileSync(
  new URL('../../supabase/tests/g1_w1_atomic_material_request_fulfillment_receive_smoke.sql', import.meta.url),
  'utf8',
).toLowerCase().replace(/\s+/g, ' ');

describe('atomic material request fulfillment receive migration', () => {
  it('defines one private idempotency ledger and one guarded public command', () => {
    expect(migration).toContain('create table app_private.material_request_receive_commands');
    expect(migration).toContain('primary key (actor_user_id, idempotency_key)');
    expect(migration).toContain('create or replace function app_private.receive_material_request_fulfillment_batch_v1');
    expect(migration).toContain('create or replace function public.receive_material_request_fulfillment_batch_v1');
    expect(migration).toContain('create or replace function app_private.sync_material_request_fulfillment_receipt_v1');
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('security definer');
    expect(migration).toContain('public.current_app_user_id()');
    expect(migration).toContain('p_expected_updated_at');
    expect(migration).toContain("input.value ->> 'expectedupdatedat'");
    expect(migration).toContain('fulfillment_receive_line_stale');
    expect(migration).toContain('for update');
    expect(migration).toContain('fulfillment_receive_idempotency_conflict');
    expect(migration).toContain('fulfillment_batch_stale');
    expect(migration).toContain("in ('nan', 'infinity', '-infinity', 'inf', '-inf')");

    const privateCommand = migration.indexOf('create or replace function app_private.receive_material_request_fulfillment_batch_v1');
    const publicWrapper = migration.indexOf('create or replace function public.receive_material_request_fulfillment_batch_v1');
    expect(migration.slice(privateCommand, publicWrapper)).toContain('security definer');
    expect(migration.slice(publicWrapper)).toContain('security invoker');
  });

  it('locks the WMS transaction before the fulfillment batch', () => {
    const transactionLock = migration.indexOf('from public.transactions where id = v_batch.transaction_id for update');
    const batchLock = migration.indexOf('from public.material_request_fulfillment_batches where id = p_batch_id for update');
    const commandInsert = migration.indexOf('insert into app_private.material_request_receive_commands(', batchLock);

    expect(transactionLock).toBeGreaterThan(-1);
    expect(batchLock).toBeGreaterThan(-1);
    expect(commandInsert).toBeGreaterThan(-1);
    expect(transactionLock).toBeLessThan(batchLock);
    expect(batchLock).toBeLessThan(commandInsert);
  });

  it('preserves decimal stock and delegates reconciliation without calling the V2 owner', () => {
    expect(migration).toContain('v_qty numeric');
    expect(migration).toContain('public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty::numeric)');
    expect(migration).toContain('app_private.sync_material_request_fulfillment_receipt_v1');
    expect(migration).toContain("transaction_line.value ->> 'accountingqty'");
    expect(migration).toContain("transaction_line.value ->> 'orderedqty'");
    expect(migration).toContain('fulfillment_transaction_line_set_invalid');
    expect(migration).toContain("jsonb_array_length(coalesce(v_tx.items, '[]'::jsonb)) <> v_line_count");
    expect(migration).toContain('fulfillment_purchase_order_not_found');
    expect(migration).toContain('fulfillment_po_line_set_invalid');
    expect(migration).not.toContain('v_sync_result := public.sync_fulfillment_receipt_for_transaction');
    expect(migration).toContain("v_tx.source_type = 'po_delivery_batch'");
    expect(migration).toContain('purchase_receipt_v2_owner_required');
    expect(migration).not.toContain('app_private.finalize_purchase_receipt_v2(');
    expect(migration).not.toContain('public.finalize_material_po_receipt(');
  });

  it('keeps the command private-by-default and exposes only the wrapper', () => {
    expect(migration).toContain('revoke all on table app_private.material_request_receive_commands from public, anon, authenticated');
    expect(migration).toContain('revoke all on function public.receive_material_request_fulfillment_batch_v1');
    expect(migration).toContain('from public, anon');
    expect(migration).toContain('to authenticated, service_role');
  });

  it('ships rollback, replay, actor, stale-write, decimal and UOM Cloud smoke coverage', () => {
    expect(smoke).toContain('begin;');
    expect(smoke).toContain('rollback;');
    expect(smoke).toContain('late failure did not roll back the aggregate');
    expect(smoke).toContain("is distinct from 35::numeric");
    expect(smoke).toContain("po_received_qty is distinct from 1::numeric");
    expect(smoke).toContain("replay_result ->> 'idempotentreplay'");
    expect(smoke).toContain('w1 receive accepted a spoofed actor');
    expect(smoke).toContain('w1 receive accepted a stale line');
    expect(smoke).toContain('a second actor applied the received batch again');
  });
});
