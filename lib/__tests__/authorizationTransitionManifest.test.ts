import { describe, expect, it } from 'vitest';
import { buildTransitionManifest } from '../../scripts/authorization-v2/build-task12-4-2-manifest.mjs';

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
});
