import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_repair_purchase_delivery_batch_wms_qr_v2.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = migrationPath && existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('purchase package V2 WMS/QR repair migration', () => {
  it('backfills delivery batch WMS links and QR tokens without creating business rows', () => {
    expect(migrationFile).toBeDefined();
    expect(normalized).toContain('update public.purchase_order_delivery_batches batch');
    expect(normalized).toContain('set wms_transaction_id = repair.transaction_id');
    expect(normalized).toContain("qr_token = coalesce(batch.qr_token, 'pod_' || replace(gen_random_uuid()::text, '-', ''))");
    expect(normalized).toContain('from repair_candidates repair');
    expect(normalized).toContain('array[fulfillment.id::text]');
    expect(normalized).not.toMatch(/\binsert\s+into\s+public\.transactions\b/i);
    expect(normalized).not.toMatch(/\binsert\s+into\s+public\.purchase_order_delivery_batches\b/i);
  });

  it('marks existing WMS transactions as po_delivery_batch sources for V2 receipt commands', () => {
    expect(migrationFile).toBeDefined();
    expect(normalized).toContain('update public.transactions tx');
    expect(normalized).toContain("source_type = 'po_delivery_batch'");
    expect(normalized).toContain('source_id = repair.delivery_batch_id::text');
    expect(normalized).toContain('where tx.id = repair.transaction_id');
  });
});
