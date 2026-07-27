import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_purchase_package_business_partner_wms_v2.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = migrationPath && existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('purchase package business partner WMS migration', () => {
  it('routes partner-backed package delivery WMS transactions through business_partner_id instead of supplier_id', () => {
    expect(migrationFile).toBeDefined();
    expect(normalized).toContain('create or replace function app_private.normalize_po_delivery_transaction_counterparty_v2()');
    expect(normalized).toContain("new.source_type = 'po_delivery_batch'");
    expect(normalized).toContain('new.supplier_id is not null');
    expect(normalized).toContain('not exists ( select 1 from public.suppliers supplier where supplier.id = new.supplier_id )');
    expect(normalized).toContain('exists ( select 1 from public.business_partners partner where partner.id = new.supplier_id )');
    expect(normalized).toContain('new.business_partner_id := new.supplier_id');
    expect(normalized).toContain('new.supplier_id := null');
  });

  it('normalizes both created and updated purchase delivery WMS transactions before FK checks', () => {
    expect(migrationFile).toBeDefined();
    expect(normalized).toContain('before insert or update of supplier_id, business_partner_id, source_type on public.transactions');
    expect(normalized).toContain('execute function app_private.normalize_po_delivery_transaction_counterparty_v2()');
  });
});
