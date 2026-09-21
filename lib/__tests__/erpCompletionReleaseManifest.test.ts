import { describe, expect, it } from 'vitest';
import {
  ERP_COMPLETION_COMMANDS,
  validateErpCompletionReleaseManifest,
} from '../../scripts/g9/release-manifest.mjs';

const readyManifest = () => ({
  schemaVersion: 1,
  releaseId: 'erp-completion-pilot-2026-09-21-a',
  commitSha: '172c6c6abc123',
  migrationHead: '20260921183000',
  environment: 'production',
  status: 'ready',
  scope: {
    projectId: 'project-a', constructionSiteId: 'site-a',
    warehouseIds: ['warehouse-a'], supplierIds: ['supplier-a'],
  },
  actors: [
    ['buyer', '81111111-1111-4111-8111-111111111111'],
    ['qs', '82222222-2222-4222-8222-222222222222'],
    ['warehouse', '83333333-3333-4333-8333-333333333333'],
    ['qc', '84444444-4444-4444-8444-444444444444'],
    ['accountant', '85555555-5555-4555-8555-555555555555'],
    ['manager', '86666666-6666-4666-8666-666666666666'],
  ].map(([persona, userId]) => ({ persona, userId })),
  commands: {
    enabled: [...ERP_COMPLETION_COMMANDS],
    completion: ['wms.transfer.receive', 'wms.transfer.dispose', 'finance.invoice.reverse', 'finance.payment.reverse'],
  },
  journeys: Array.from({ length: 8 }, (_, index) => ({
    id: `J0${index + 1}`, status: 'not_run', expected: 'Theo approved journey contract',
    actual: null, evidence: null, cleanup: 'No synthetic residue', signedOffBy: null,
  })),
  owners: { release: 'release-owner', dataException: 'data-owner', support: 'support-owner', rollback: 'rollback-owner' },
  sla: { criticalMinutes: 30, highMinutes: 120, standardMinutes: 480 },
  window: { startsAt: '2026-09-22T01:00:00.000Z', expiresAt: '2026-10-22T01:00:00.000Z' },
  rollback: { previousArtifact: 'sha:previous', pauseOn: ['integrity_mismatch', 'permission_leak'], recoveryRunbook: 'docs/runbooks/erp-completion-pilot-rollout.md' },
  limitations: [{ id: 'D13', owner: 'finance-owner', disposition: 'Cost forecast unavailable' }],
});

describe('G9 release manifest validator', () => {
  it('accepts one concrete, reviewable release candidate without claiming UAT completion', () => {
    expect(validateErpCompletionReleaseManifest(readyManifest(), { requireActivatable: true })).toEqual([]);
  });

  it('rejects missing personas, journeys, invalid commands, placeholders, and invalid windows', () => {
    const manifest = readyManifest();
    manifest.actors = manifest.actors.filter(actor => actor.persona !== 'qc');
    manifest.journeys = manifest.journeys.slice(0, 7);
    manifest.commands.enabled.push('unsafe.anything');
    manifest.owners.release = '<release-owner>';
    manifest.window.expiresAt = manifest.window.startsAt;
    const errors = validateErpCompletionReleaseManifest(manifest, { requireActivatable: true });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('persona:qc'), expect.stringContaining('journey:J08'),
      expect.stringContaining('command:unsafe.anything'), expect.stringContaining('owners.release'),
      expect.stringContaining('window'),
    ]));
  });

  it('requires evidence, actual result, cleanup, and signoff before a journey can pass', () => {
    const manifest = readyManifest();
    manifest.journeys[0].status = 'passed';
    const errors = validateErpCompletionReleaseManifest(manifest, { requireActivatable: false });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('J01.actual'), expect.stringContaining('J01.evidence'),
      expect.stringContaining('J01.signedOffBy'),
    ]));
  });

  it('does not accept synthetic evidence as business pilot signoff', () => {
    const manifest = readyManifest();
    manifest.journeys[0] = {
      ...manifest.journeys[0], status: 'passed', actual: 'Passed with fixture',
      evidence: 'tests/fixtures/j01.json', signedOffBy: 'automation',
    };
    expect(validateErpCompletionReleaseManifest(manifest, { requireActivatable: false }))
      .toContain('journey:J01.business_signoff_required');
  });

  it('requires a different named user for each pilot persona', () => {
    const manifest = readyManifest();
    manifest.actors[1].userId = manifest.actors[0].userId;
    expect(validateErpCompletionReleaseManifest(manifest, { requireActivatable: true }))
      .toContain('actors.distinct_users_required');
  });
});
