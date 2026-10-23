import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261028135000_procurement_p0_backdoor_lock.sql'), 'utf8');

const functionBody = (name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  expect(start, `${name} is redefined`).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf('$function$;', start));
};

const sourceTables = [
  'purchase_orders',
  'purchase_order_delivery_batches',
  'purchase_order_delivery_lines',
  'purchase_order_request_lines',
];

describe('procurement P0 back-door lock (audit 22/10)', () => {
  it('guards direct REST writes to every source table with an invoker trigger', () => {
    const guard = sql.slice(sql.indexOf('create or replace function app_private.guard_procurement_source_direct_write()'));
    expect(guard.slice(0, guard.indexOf('$$;'))).not.toContain('security definer');
    expect(guard).toContain("current_user not in ('postgres', 'supabase_admin', 'service_role')");
    expect(guard).toContain("coalesce(current_setting('request.path', true), '') not like '/rpc/%'");
    for (const table of sourceTables) {
      expect(sql).toContain(`before insert or update or delete on public.${table}\n  for each row execute function app_private.guard_procurement_source_direct_write();`);
    }
    expect(sql).toContain('before update of items on public.requests');
    expect(sql).toContain("grant execute on function app_private.procurement_assert_direct_write(text, text, jsonb, jsonb) to authenticated;");
  });

  it('only lets legacy drafts and planned deliveries be written directly', () => {
    const assertFn = sql.slice(sql.indexOf('create or replace function app_private.procurement_assert_direct_write('));
    expect(sql).toContain("or coalesce(p_po ->> 'status', '') not in ('draft', 'returned', 'cancelled')");
    expect(sql).toContain("select app_private.procurement_po_is_hub(p_po -> 'metadata')");
    expect(assertFn).toContain("coalesce(p_new ->> 'status', '') not in ('planned', 'supplemental_pending', 'wms_pending')");
    expect(assertFn).toContain("array['status', 'wms_transaction_id', 'fulfillment_batch_ids', 'note', 'planned_delivery_date', 'updated_at']");
    expect(assertFn).toContain("'LOCKED_MR_LINE_ORDERED: ");
    expect(sql).toContain("batch.status in ('quality_approved', 'received', 'received_short', 'received_over')");
  });

  it('logs before/after rows of delivery batches and lines', () => {
    expect(sql).toContain('after insert or update or delete on public.purchase_order_delivery_batches\n  for each row execute function app_private.audit_purchase_delivery_change();');
    expect(sql).toContain('after insert or update or delete on public.purchase_order_delivery_lines\n  for each row execute function app_private.audit_purchase_delivery_change();');
    expect(sql).toContain("'Lưu vết đợt giao PO'");
  });

  it('makes legacy commands refuse Mua hàng orders and received deliveries', () => {
    const transitionPo = functionBody('public.transition_project_purchase_order_status');
    expect(transitionPo.indexOf('LOCKED_HUB_PO')).toBeLessThan(transitionPo.indexOf('public.is_admin()'));
    expect(transitionPo).toContain("v_target_status in ('cancelled', 'draft', 'returned')");
    expect(transitionPo).toContain('app_private.procurement_po_has_receipt(v_po.id)');

    const removePo = functionBody('public.remove_purchase_order_v1');
    expect(removePo.indexOf('LOCKED_HUB_PO')).toBeLessThan(removePo.indexOf('delete from public.purchase_order_delivery_batches'));
    expect(removePo.indexOf('LOCKED_RECEIVED')).toBeLessThan(removePo.indexOf('delete from public.purchase_order_delivery_batches'));

    const removeBatch = functionBody('public.remove_purchase_order_delivery_batch_v1');
    expect(removeBatch).toContain('app_private.procurement_delivery_has_receipt(v_delivery.id)');
    expect(removeBatch.indexOf('LOCKED_RECEIVED')).toBeLessThan(removeBatch.indexOf('delete from public.purchase_order_delivery_batches'));

    const transitionMr = functionBody('public.transition_project_material_request_status');
    expect(transitionMr.indexOf('LOCKED_MR_WORKFLOW')).toBeLessThan(transitionMr.indexOf('update public.requests'));
    expect(transitionMr).toContain('app_private.material_request_has_open_po(v_request.id)');
  });

  it('keeps PO delivery receipts out of the generic WMS commands', () => {
    const status = functionBody('public.process_transaction_status');
    expect(status.indexOf("v_tx.source_type = 'po_delivery_batch'")).toBeLessThan(status.indexOf('apply_stock_change'));
    expect(status).toContain("'WMS_PO_RECEIPT_COMMAND: ");
    const items = functionBody('public.update_transaction_items_for_receipt');
    expect(items.indexOf("v_tx.source_type = 'po_delivery_batch'")).toBeLessThan(items.indexOf('update public.transactions'));
  });

  it('closes the old supplier payment shortcuts', () => {
    for (const name of ['post_supplier_payment_batch', 'reverse_supplier_payment_batch']) {
      expect(sql).toContain(`revoke execute on function public.${name}(uuid, uuid) from public, anon, authenticated;`);
      expect(sql).toContain(`revoke execute on function app_private.${name}(uuid, uuid) from public, anon, authenticated;`);
      const core = functionBody(`app_private.${name}`);
      expect(core).toContain('app_private.supplier_payment_batch_finance_managed(v_batch.metadata)');
      expect(core).toContain("current_setting('app.finance_context', true)");
      expect(core.indexOf('LOCKED_FINANCE_PAYMENT')).toBeLessThan(core.indexOf('_engine_g7('));
    }
    expect(functionBody('public.save_supplier_payment_batch_draft_v1')).toContain('LOCKED_FINANCE_PAYMENT');
    expect(sql).toContain("select coalesce(p_metadata ->> 'kind', '') = 'payment_request'");
  });

  it('uses 42501 and no retry-looping error codes', () => {
    expect(sql).not.toContain("'40001'");
    expect(sql.match(/message = 'LOCKED_[A-Z_]+: /g)?.length).toBeGreaterThanOrEqual(10);
  });
});
