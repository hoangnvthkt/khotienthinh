import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_purchase_package_planned_schedule_approval_v2.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = migrationPath && existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('purchase package planned schedule approval migration', () => {
  it('prepares an existing planned delivery batch with WMS and QR during package approval', () => {
    expect(migrationFile).toBeDefined();
    expect(normalized).toContain('create or replace function app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2');
    expect(normalized).toContain("coalesce(v_batch.wms_transaction_id, '') <> ''");
    expect(normalized).toContain('insert into public.transactions');
    expect(normalized).toContain("source_type, source_id");
    expect(normalized).toContain("status = 'receiving'");
    expect(normalized).toContain('qr_token = coalesce(v_batch.qr_token, v_qr_token)');
  });

  it('uses the first saved planned batch when approving a single or multiple package', () => {
    expect(migrationFile).toBeDefined();
    expect(normalized).toContain("coalesce(v_po.purchase_mode, 'single') in ('single', 'multiple')");
    expect(normalized).toContain('order by delivery_no, id limit 1');
    expect(normalized).toContain('app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2');
    expect(normalized).toContain("if coalesce(v_po.purchase_mode, 'single') = 'single' and v_delivery_result is null then");
  });
});
