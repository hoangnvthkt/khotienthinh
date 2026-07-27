import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_purchase_delivery_reject_sync_v2.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = migrationPath && existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('purchase delivery reject sync migration', () => {
  it('marks a purchase delivery batch as cancelled when its WMS transaction is rejected', () => {
    expect(migrationFile).toBeDefined();
    expect(normalized).toContain('create or replace function app_private.sync_po_delivery_batch_from_cancelled_wms_v2()');
    expect(normalized).toContain("new.source_type = 'po_delivery_batch'");
    expect(normalized).toContain("new.status = 'CANCELLED'::public.transaction_status");
    expect(normalized).toContain('update public.purchase_order_delivery_batches batch');
    expect(normalized).toContain("status = 'cancelled'");
    expect(normalized).toContain("quality_result = 'rejected'");
    expect(normalized).toContain('batch.id = new.source_id::uuid');
  });

  it('backfills already rejected WMS transactions so existing POs show the rejection history', () => {
    expect(migrationFile).toBeDefined();
    expect(normalized).toContain('from public.transactions tx');
    expect(normalized).toContain("tx.source_type = 'po_delivery_batch'");
    expect(normalized).toContain("tx.status = 'CANCELLED'::public.transaction_status");
    expect(normalized).toContain("batch.status <> 'cancelled'");
  });
});
