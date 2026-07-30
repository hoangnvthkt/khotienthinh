import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = join(process.cwd(), 'supabase/migrations');
const migrationSources = readdirSync(migrationDir)
  .filter(file => file.endsWith('.sql'))
  .map(file => readFileSync(join(migrationDir, file), 'utf8').replace(/\s+/g, ' '));

describe('WMS catalog RLS performance migration', () => {
  it('optimizes catalog select policies with initplan permission checks', () => {
    const matchingMigration = migrationSources.find(source =>
      source.includes('drop policy if exists items_phase4_select on public.items')
      && source.includes("create policy items_phase4_select")
      && source.includes("drop policy if exists warehouses_phase4_select on public.warehouses")
      && source.includes("create policy warehouses_phase4_select")
      && source.includes("(select public.is_module_admin('WMS'))")
      && source.includes("(select app_private.wms_has_action('wms.inventory.view'))")
    );

    expect(matchingMigration).toBeTruthy();
  });
});
