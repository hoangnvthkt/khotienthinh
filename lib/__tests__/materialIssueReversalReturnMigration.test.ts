import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_material_issue_approval_reversal_return.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = migrationPath && existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim().toLowerCase();

describe('material issue approval reversal and safe return migration', () => {
  it('adds auditable reversal, idempotency, return kind and terminal status schema', () => {
    expect(migrationPath).not.toBe('');
    expect(normalized).toContain('add column if not exists reversal_of_transaction_id text');
    expect(normalized).toContain('references public.transactions(id) on delete restrict');
    expect(normalized).toContain('add column if not exists idempotency_key text');
    expect(normalized).toContain('add column if not exists return_kind text');
    expect(normalized).toContain("return_kind in ('unused_return', 'approval_reversal')");
    expect(normalized).toContain("jsonb_typeof(metadata) = 'object'");
    expect(normalized).toMatch(/create unique index[^;]+reversal_of_transaction_id/);
    expect(normalized).toMatch(/create unique index[^;]+material_issue_returns[^;]+idempotency_key/);
    expect(normalized).toMatch(/material_issue_orders_status_check[^;]+reversed/);
  });

  it('registers the strict sensitive warehouse reversal capability', () => {
    expect(normalized).toContain("'wms.transaction.reverse'");
    expect(normalized).toContain("array['global', 'warehouse']");
    expect(normalized).toContain("risk_level = 'sensitive'");
    expect(normalized).toContain('direct_grant_requires_expiry = true');
    expect(normalized).toContain('resolve_authorization_snapshot');
    expect(normalized).not.toContain('wms_has_action');
  });

  it('keeps public RPCs as wrappers over private implementations', () => {
    expect(normalized).toContain('app_private.create_material_issue_return_v2_impl');
    expect(normalized).toContain('public.create_material_issue_return_v2');
    expect(normalized).toContain('app_private.reverse_material_issue_approval_v1_impl');
    expect(normalized).toContain('public.reverse_material_issue_approval_v1');
    expect(normalized).toContain('material_issue_idempotency_conflict');
    expect(normalized).toContain('for update');
    expect(normalized).toContain("targetwarehouseid");
  });

  it('reserves pending quantities in return creation, completion and settlement', () => {
    expect(normalized).toContain('material_issue_pending_return_qty');
    expect(normalized).toContain('material_issue_returnable_qty');
    expect(normalized).toMatch(/v_available\s*:=\s*[^;]+-\s*app_private\.material_issue_pending_return_qty/);
    expect(normalized).toContain('sync_material_issue_from_transaction');
    expect(normalized).toContain('số lượng hoàn trả không còn khả dụng');
  });

  it('posts reversal ledger entries linked to the original WMS and inventory transactions', () => {
    expect(normalized).toContain('reversal_of_inventory_transaction_id');
    expect(normalized).toContain("'reversal', 'in'");
    expect(normalized).toContain('reversal_of_transaction_id');
    expect(normalized).toContain("set status = 'reversed'");
    expect(normalized).toContain("'returnkind', 'approval_reversal'");
  });

  it('treats reversed documents as terminal and restricts Data API privileges', () => {
    expect(normalized).toMatch(/status in \([^)]*'reversed'/);
    expect(normalized).toContain('sync_material_issue_document_links');
    expect(normalized).toContain('revoke all on function public.reverse_material_issue_approval_v1');
    expect(normalized).toContain('revoke all on function app_private.reverse_material_issue_approval_v1_impl');
    expect(normalized).toContain('grant execute on function public.reverse_material_issue_approval_v1');
  });
});
