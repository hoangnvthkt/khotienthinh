import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildTransitionManifest } from '../../scripts/authorization-v2/build-task12-4-2-manifest.mjs';

const wmsMappings = JSON.parse(readFileSync(
  new URL('../../scripts/authorization-v2/task12-4-2-wms-mappings.json', import.meta.url),
  'utf8',
));
const nonWmsMappings = JSON.parse(readFileSync(
  new URL('../../scripts/authorization-v2/task12-4-2-non-wms-mappings.json', import.meta.url),
  'utf8',
));
const ownerDecisionRegister = JSON.parse(readFileSync(
  new URL('../../scripts/authorization-v2/task12-4-2-owner-decisions.json', import.meta.url),
  'utf8',
));

const nonWmsSystemCatalog = [
  'system.ai.manage', 'system.ai.view',
  'system.analytics.manage', 'system.analytics.view',
  'system.audit_trail.manage', 'system.audit_trail.view',
  'system.authorization.audit', 'system.authorization.manage_grants',
  'system.authorization.manage_roles', 'system.authorization.manage_scopes',
  'system.authorization.override', 'system.authorization.view',
  'system.chat.manage', 'system.chat.view',
  'system.custom_dashboard.manage', 'system.custom_dashboard.view',
  'system.da.manage', 'system.da.view',
  'system.ep.manage', 'system.ep.view',
  'system.ex.manage', 'system.ex.view',
  'system.hd.manage', 'system.hd.view',
  'system.kb.manage', 'system.kb.view',
  'system.procurement.manage', 'system.procurement.view',
  'system.rq.manage', 'system.rq.view',
  'system.settings.manage', 'system.settings.view',
  'system.storage.manage', 'system.storage.view',
  'system.tender_ai.manage', 'system.tender_ai.view',
  'system.ts.manage', 'system.ts.view',
  'system.wf.manage', 'system.wf.view',
];

const source = (overrides: Record<string, unknown> = {}) => ({
  sourceId: 'source-1', sourceType: 'DIRECT', permissionCode: 'system.rq.view',
  scopeType: 'own', scopeId: '*', expiresAt: null, ...overrides,
});
const input = (sources: ReturnType<typeof source>[], mappings: Record<string, unknown> = {}): {
  batchId: string;
  mappingVersion: string;
  now: string;
  users: Array<{
    userId: string;
    targetVersion: string;
    sources: ReturnType<typeof source>[];
    candidateSourceIds?: string[];
    expectedSourceHash?: string;
  }>;
  mappings: Record<string, unknown>;
} => ({
  batchId: 'task12.4.2-pilot-1', mappingVersion: '2026-09-14.1', now: '2026-09-14T00:00:00Z',
  users: [{ userId: 'user-1', targetVersion: '2026-09-14T00:00:00Z', sources }], mappings,
});

describe('Task 12.4.2 transition manifest', () => {
  it('retains authorization control permissions without an explicit mapping', () => {
    const manifest = buildTransitionManifest(input([source({ permissionCode: 'system.authorization.manage_grants' })]));
    expect(manifest.items[0].disposition).toBe('retain');
    expect(manifest.items[0].after).toEqual(manifest.items[0].before);
  });

  it('routes an unknown legacy mapping to manual review', () => {
    expect(buildTransitionManifest(input([source()])).items[0]).toMatchObject({
      disposition: 'manual_review', after: null,
    });
  });

  it('blocks a replacement that expands own scope to global', () => {
    const manifest = buildTransitionManifest(input([source()], {
      'DIRECT:system.rq.view': { disposition: 'replace', permissionCode: 'request.instance.view_all', scopeType: 'global', scopeId: '*' },
    }));
    expect(manifest.items[0]).toMatchObject({ disposition: 'manual_review', after: null });
    expect(manifest.items[0].reason).toContain('scope expansion');
  });

  it('never creates a replacement from an expired source', () => {
    const manifest = buildTransitionManifest(input([source({ expiresAt: '2026-09-13T00:00:00Z' })], {
      'DIRECT:system.rq.view': { disposition: 'replace', permissionCode: 'request.instance.view_own' },
    }));
    expect(manifest.items[0]).toMatchObject({
      disposition: 'retain',
      after: { permissionCode: 'system.rq.view', expiresAt: '2026-09-13T00:00:00Z' },
    });
  });

  it('deduplicates source IDs and produces a stable source hash', () => {
    const twice = input([source(), source()]);
    const first = buildTransitionManifest(twice);
    const second = buildTransitionManifest(twice);
    expect(first.items).toHaveLength(1);
    expect(first.items[0].expectedSourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toEqual(first);
  });

  it('hashes non-candidate sources without adding them to the transition batch', () => {
    const base = input([source(), source({ sourceId: 'business-role', permissionCode: 'hrm.attendance.view' })]);
    base.users[0].candidateSourceIds = ['source-1'];
    const first = buildTransitionManifest(base);
    const changed = input([source(), source({ sourceId: 'business-role', permissionCode: 'hrm.leave.view' })]);
    changed.users[0].candidateSourceIds = ['source-1'];
    const second = buildTransitionManifest(changed);
    expect(first.items).toHaveLength(1);
    expect(first.items[0].expectedSourceHash).not.toBe(second.items[0].expectedSourceHash);
  });

  it('uses the database snapshot hash and preserves source state used by apply', () => {
    const data = input([source({
      isActive: false,
      status: 'REVOKED',
      updatedAt: '2026-09-14T01:02:03Z',
      state: { grantReason: 'original reason' },
    })]);
    data.users[0].expectedSourceHash = 'a'.repeat(64);
    const manifest = buildTransitionManifest(data);
    expect(manifest.items[0]).toMatchObject({
      expectedSourceHash: 'a'.repeat(64),
      before: {
        isActive: false,
        status: 'REVOKED',
        updatedAt: '2026-09-14T01:02:03Z',
        state: { grantReason: 'original reason' },
      },
    });
  });

  it('rejects a malformed database snapshot hash', () => {
    const data = input([source()]);
    data.users[0].expectedSourceHash = 'not-a-sha256';
    expect(() => buildTransitionManifest(data)).toThrow('Invalid expectedSourceHash');
  });

  it('expands one reviewed shell source into multiple direct capabilities without widening scope', () => {
    const manifest = buildTransitionManifest(input([source({
      permissionCode: 'system.wms.manage',
      scopeType: 'global',
    })], {
      'DIRECT:system.wms.manage': {
        disposition: 'replace',
        permissionCodes: [
          'wms.inventory.edit',
          'wms.request.approve',
          'wms.transaction.complete',
        ],
      },
    }));
    expect(manifest.items[0].after).toEqual([
      expect.objectContaining({ permissionCode: 'wms.inventory.edit', scopeType: 'global' }),
      expect.objectContaining({ permissionCode: 'wms.request.approve', scopeType: 'global' }),
      expect.objectContaining({ permissionCode: 'wms.transaction.complete', scopeType: 'global' }),
    ]);
  });

  it('rejects a multi-capability replacement when any target widens scope', () => {
    const manifest = buildTransitionManifest(input([source()], {
      'DIRECT:system.rq.view': {
        disposition: 'replace',
        replacements: [
          { permissionCode: 'request.template.view' },
          { permissionCode: 'request.instance.view_all', scopeType: 'global', scopeId: '*' },
        ],
      },
    }));
    expect(manifest.items[0]).toMatchObject({ disposition: 'manual_review', after: null });
    expect(manifest.items[0].reason).toContain('scope expansion');
  });

  it('keeps WMS manager sources under review instead of silently granting reversal', () => {
    const manifest = buildTransitionManifest(input([
      source({ sourceId: 'wms-view', permissionCode: 'system.wms.view', scopeType: 'global' }),
      source({ sourceId: 'wms-manage', permissionCode: 'system.wms.manage', scopeType: 'global' }),
    ], wmsMappings));
    const mapped = Object.fromEntries(manifest.items.map(item => [item.before.permissionCode, item.after]));
    expect(mapped['system.wms.view']).toHaveLength(3);
    expect(mapped['system.wms.manage']).toBeNull();
    expect(manifest.items.find(item => item.before.permissionCode === 'system.wms.manage'))
      .toMatchObject({ disposition: 'manual_review' });
    expect(manifest.items.find(item => item.before.permissionCode === 'system.wms.view'))
      .toMatchObject({ disposition: 'replace' });
  });

  it('covers every active non-WMS system catalog action with an explicit disposition', () => {
    expect(Object.keys(nonWmsMappings).sort()).toEqual(
      nonWmsSystemCatalog.map(permissionCode => `DIRECT:${permissionCode}`).sort(),
    );
  });

  it('retains only canonical authorization-control sources in the non-WMS preview', () => {
    const sources = [
      source({ sourceId: 'authorization-view', permissionCode: 'system.authorization.view', scopeType: 'global' }),
      source({ sourceId: 'authorization-audit', permissionCode: 'system.authorization.audit', scopeType: 'global' }),
      source({ sourceId: 'project-shell', permissionCode: 'system.da.view', scopeType: 'global' }),
      source({ sourceId: 'workflow-shell', permissionCode: 'system.wf.manage', scopeType: 'global' }),
    ];
    const manifest = buildTransitionManifest(input(sources, nonWmsMappings));
    const byCode = Object.fromEntries(manifest.items.map(item => [item.before.permissionCode, item]));

    expect(byCode['system.authorization.view']).toMatchObject({ disposition: 'retain' });
    expect(byCode['system.authorization.audit']).toMatchObject({ disposition: 'retain' });
    expect(byCode['system.da.view']).toMatchObject({ disposition: 'manual_review', after: null });
    expect(byCode['system.wf.manage']).toMatchObject({ disposition: 'manual_review', after: null });
  });

  it('does not emit replacement grants for owner-pending non-WMS shells', () => {
    const manifest = buildTransitionManifest(input([
      source({ sourceId: 'request-shell', permissionCode: 'system.rq.manage', scopeType: 'global' }),
      source({ sourceId: 'asset-shell', permissionCode: 'system.ts.view', scopeType: 'global' }),
      source({ sourceId: 'settings-shell', permissionCode: 'system.settings.manage', scopeType: 'global' }),
    ], nonWmsMappings));

    expect(manifest.items).toHaveLength(3);
    expect(manifest.items.every(item => item.disposition === 'manual_review')).toBe(true);
    expect(manifest.items.every(item => item.after === null)).toBe(true);
  });

  it('has an owner-pending decision entry for every manual-review shell', () => {
    const registered = new Set(ownerDecisionRegister.decisions
      .filter((decision: { status: string }) => decision.status === 'owner_pending')
      .flatMap((decision: { permissionCodes: string[] }) => decision.permissionCodes));
    const manualReviewCodes = Object.entries(nonWmsMappings)
      .filter(([, mapping]) => (mapping as { disposition: string }).disposition === 'manual_review')
      .map(([key]) => key.replace(/^DIRECT:/, ''));

    expect(manualReviewCodes.every(code => registered.has(code))).toBe(true);
    expect(registered.has('system.wms.manage')).toBe(true);
  });
});
