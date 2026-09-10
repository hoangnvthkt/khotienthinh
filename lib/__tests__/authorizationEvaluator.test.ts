import { describe, expect, it } from 'vitest';

import type { AuthorizationSnapshot } from '../../types';
import {
  evaluateCapability,
  hasRoomAction,
} from '../permissions/authorizationEvaluator';

const snapshot = (overrides: Partial<AuthorizationSnapshot> = {}): AuthorizationSnapshot => ({
  generatedAt: '2026-09-05T00:00:00.000Z',
  flags: {
    legacy_fallback_disabled: false,
    project_room_pbac_fallback_enabled: true,
  },
  sources: [],
  roomActions: [],
  ...overrides,
});

describe('canonical authorization evaluator', () => {
  it('allows an active direct source only inside its exact project scope', () => {
    const directProjectA = snapshot({
      sources: [{
        permissionCode: 'project.daily_log.view',
        sourceType: 'DIRECT',
        sourceId: 'grant-a',
        scopeType: 'project',
        scopeId: 'project-a',
        isBusinessApproval: false,
        metadata: {},
      }],
    });

    expect(evaluateCapability(directProjectA, 'project.daily_log.view', {
      scopeType: 'project', scopeId: 'project-a', projectId: 'project-a',
    })).toMatchObject({ allowed: true, reason: 'granted', sourceType: 'DIRECT' });
    expect(evaluateCapability(directProjectA, 'project.daily_log.view', {
      scopeType: 'project', scopeId: 'project-b', projectId: 'project-b',
    })).toMatchObject({ allowed: false, reason: 'scope_mismatch' });
  });

  it('allows verified project scope to cover one of its construction sites', () => {
    const directProjectA = snapshot({
      sources: [{
        permissionCode: 'project.daily_log.view',
        sourceType: 'DIRECT',
        scopeType: 'project',
        scopeId: 'project-a',
        isBusinessApproval: false,
        metadata: {},
      }],
    });

    expect(evaluateCapability(directProjectA, 'project.daily_log.view', {
      scopeType: 'construction_site',
      scopeId: 'site-a',
      projectId: 'project-a',
      constructionSiteId: 'site-a',
    }).allowed).toBe(true);
    expect(evaluateCapability(directProjectA, 'project.daily_log.view', {
      scopeType: 'construction_site',
      scopeId: 'site-b',
      projectId: 'project-b',
      constructionSiteId: 'site-b',
    }).allowed).toBe(false);
  });

  it('reports a disabled legacy-only source without treating it as a grant', () => {
    const legacyOnlyFallbackOff = snapshot({
      flags: { legacy_fallback_disabled: true },
      sources: [{
        permissionCode: 'wms.inventory.view',
        sourceType: 'LEGACY',
        scopeType: 'global',
        scopeId: '*',
        isBusinessApproval: false,
        metadata: {},
      }],
    });

    expect(evaluateCapability(
      legacyOnlyFallbackOff,
      'wms.inventory.view',
      { scopeType: 'global', scopeId: '*' },
    )).toMatchObject({ allowed: false, reason: 'legacy_disabled' });
  });

  it('still honors canonical sources when a stale legacy source is present after cutover', () => {
    const mixedSources = snapshot({
      flags: { legacy_fallback_disabled: true },
      sources: [
        {
          permissionCode: 'wms.inventory.view',
          sourceType: 'LEGACY',
          scopeType: 'global',
          scopeId: '*',
          isBusinessApproval: false,
          metadata: {},
        },
        {
          permissionCode: 'wms.inventory.view',
          sourceType: 'DIRECT',
          sourceId: 'canonical-grant',
          scopeType: 'global',
          scopeId: '*',
          isBusinessApproval: false,
          metadata: {},
        },
      ],
    });

    expect(evaluateCapability(mixedSources, 'wms.inventory.view')).toMatchObject({
      allowed: true,
      reason: 'granted',
      sourceType: 'DIRECT',
      sourceId: 'canonical-grant',
    });
  });

  it('denies inactive snapshots, expired sources, and unknown permissions', () => {
    expect(evaluateCapability(null, 'wms.inventory.view')).toMatchObject({
      allowed: false,
      reason: 'inactive',
    });
    expect(evaluateCapability(snapshot({
      sources: [{
        permissionCode: 'wms.inventory.view',
        sourceType: 'DIRECT',
        scopeType: 'global',
        scopeId: '*',
        expiresAt: '2020-01-01T00:00:00.000Z',
        isBusinessApproval: false,
        metadata: {},
      }],
    }), 'wms.inventory.view')).toMatchObject({ allowed: false, reason: 'not_granted' });
    expect(evaluateCapability(snapshot(), 'unknown.permission')).toMatchObject({
      allowed: false,
      reason: 'unknown_permission',
    });
  });

  it('uses only snapshot Room actions and keeps project scope isolated', () => {
    const roomSnapshot = snapshot({
      roomActions: [{
        projectId: 'project-a',
        constructionSiteId: null,
        roomCode: 'weekly_progress',
        actionCode: 'confirm',
        source: 'room',
        enforcement: 'pilot',
        fallback: true,
      }],
    });

    expect(hasRoomAction(roomSnapshot, 'project-a', null, 'weekly_progress', 'confirm')).toBe(true);
    expect(hasRoomAction(roomSnapshot, 'project-a', 'site-a', 'weekly_progress', 'confirm')).toBe(true);
    expect(hasRoomAction(roomSnapshot, 'project-b', null, 'weekly_progress', 'confirm')).toBe(false);
    expect(hasRoomAction(snapshot(), 'project-a', null, 'weekly_progress', 'confirm')).toBe(false);
  });
});
