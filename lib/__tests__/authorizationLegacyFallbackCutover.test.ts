import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { mapAuthorizationSnapshot } from '../../context/authState';

const migrationName = readdirSync(join(process.cwd(), 'supabase', 'migrations'))
  .find(name => name.endsWith('_authorization_v2_phase5_disable_legacy_fallback.sql'));
const sql = migrationName
  ? readFileSync(join(process.cwd(), 'supabase', 'migrations', migrationName), 'utf8').toLowerCase()
  : '';

describe('Authorization V2 legacy fallback cutover', () => {
  it('sets all Phase 5 fallback flags to their fail-closed values', () => {
    expect(migrationName).toBeDefined();
    expect(sql).toContain("'legacy_governance_fallback_disabled', 'true'::jsonb");
    expect(sql).toContain("'legacy_fallback_disabled', 'true'::jsonb");
    expect(sql).toContain("'legacy_projection_enabled', 'false'::jsonb");
  });

  it('keeps migration evidence and proves no effective LEGACY source remains', () => {
    expect(sql).toContain('authorization_legacy_user_snapshots');
    expect(sql).toContain('authorization_legacy_migration_dispositions');
    expect(sql).toContain('resolve_effective_permission_sources');
    expect(sql).toContain("source_type = 'legacy'");
    expect(sql).toContain('raise exception');
  });

  it('removes stale LEGACY sources from a fallback-disabled snapshot at the client boundary', () => {
    const mapped = mapAuthorizationSnapshot({
      generatedAt: '2026-09-10T00:00:00.000Z',
      flags: { legacy_fallback_disabled: true },
      sources: [
        { permissionCode: 'wms.inventory.view', sourceType: 'LEGACY' },
        { permissionCode: 'wms.inventory.view', sourceType: 'DIRECT' },
      ],
      roomActions: [],
    });

    expect(mapped.sources.map(source => source.sourceType)).toEqual(['DIRECT']);
  });
});
