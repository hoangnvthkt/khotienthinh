import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261028140000_procurement_p0b_statement_reverse_wms_insert_lock.sql'), 'utf8');

const section = (marker: string, end: string) => {
  const start = sql.indexOf(marker);
  expect(start, `${marker} is defined`).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf(end, start));
};

describe('procurement P0 back-door lock, part 1b (audit 22/10)', () => {
  const reverse = section('create or replace function public.reverse_supplier_delivery_statement(', '$function$;');

  it('replaces the reverse command so the actor comes from the session and a reason is required', () => {
    expect(sql).toContain('drop function if exists public.reverse_supplier_delivery_statement(uuid, uuid);');
    expect(reverse).toContain('(p_statement_id uuid, p_reason text)');
    expect(reverse).not.toContain('p_actor_id');
    expect(reverse).toContain('security definer');
    expect(reverse).toContain('v_actor uuid := public.current_app_user_id();');
    expect(reverse).toContain("'reversedBy', v_actor");
    expect(reverse.indexOf("message = 'FINANCE_REASON_REQUIRED'")).toBeLessThan(reverse.indexOf('update public.supplier_payable_documents'));
    expect(sql).toContain('revoke all on function public.reverse_supplier_delivery_statement(uuid, text) from public, anon;');
    expect(sql).toContain('grant execute on function public.reverse_supplier_delivery_statement(uuid, text) to authenticated;');
  });

  it('only lets Finance confirmers or Admin reverse, not anyone who can edit the project', () => {
    expect(reverse).toContain("not app_private.finance_can('confirm')");
    expect(reverse).not.toContain('ap_scope_can_mutate');
    expect(reverse.indexOf('SUPPLIER_STATEMENT_REVERSE_DENIED')).toBeLessThan(reverse.indexOf('for update'));
  });

  it('refuses when the payable is paid, in a payment run, offset, price-settled, invoiced or pending cancel', () => {
    const firstWrite = reverse.indexOf('update public.supplier_payable_documents');
    for (const guard of [
      "b.status not in ('cancelled', 'reversed')",
      "r.status in ('pending', 'returned', 'approved', 'paid')",
      'coalesce(v_document.credit_amount, 0) > 0',
      'public.supplier_advance_offsets',
      'public.finance_supplier_credit_uses',
      "s.status in ('pending_approval', 'posted')",
      "i.status in ('awaiting_goods', 'pending_approval', 'posted')",
      "message = 'FINANCE_ADJUSTMENT_PENDING'",
      "message = 'FINANCE_PERIOD_LOCKED'",
    ]) {
      expect(reverse.indexOf(guard), guard).toBeGreaterThan(0);
      expect(reverse.indexOf(guard), guard).toBeLessThan(firstWrite);
    }
  });

  it('reverses the project cost booked with the payable and keeps a cancelled payable cancelled', () => {
    expect(reverse).toContain("and status not in ('cancelled', 'reversed');");
    expect(reverse).toContain("app_private.finance_reverse_project_cost(\n    'supplier_payable_document:' || v_statement.payable_document_id::text || ':recognition'");
    expect(reverse).toContain("'statement_reverse'");
  });

  it('guards direct REST inserts into transactions with an invoker trigger', () => {
    const guard = section('create or replace function app_private.guard_wms_transaction_direct_insert()', '$$;');
    expect(guard).not.toContain('security definer');
    expect(guard).toContain("current_user not in ('postgres', 'supabase_admin', 'service_role')");
    expect(guard).toContain("coalesce(current_setting('request.path', true), '') not like '/rpc/%'");
    expect(sql).toContain('before insert on public.transactions\n  for each row execute function app_private.guard_wms_transaction_direct_insert();');
    expect(sql).toContain('grant execute on function app_private.wms_assert_transaction_direct_insert(jsonb) to authenticated;');
  });

  it('lets direct inserts create only pending documents, and PO receipts only for legacy planned deliveries', () => {
    const assertFn = section('create or replace function app_private.wms_assert_transaction_direct_insert(', '$$;');
    expect(assertFn).toContain("coalesce(p_new ->> 'status', '') <> 'PENDING' and coalesce(p_new ->> 'type', '') <> 'ADJUSTMENT'");
    expect(assertFn).toContain("message = 'WMS_DIRECT_INSERT_PENDING_ONLY: ");
    expect(assertFn).toContain("v_batch.status <> 'planned'");
    expect(assertFn).toContain('v_batch.wms_transaction_id is not null');
    expect(assertFn).toContain('app_private.procurement_po_is_hub(po.metadata)');
    expect(assertFn).toContain("message = 'WMS_PO_RECEIPT_COMMAND_ONLY: ");
  });

  it('uses no retry-looping error codes', () => {
    expect(sql).not.toContain("'40001'");
  });
});
