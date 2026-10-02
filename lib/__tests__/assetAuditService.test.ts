import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Role, type User } from '../../types';

const calls: Record<string, unknown[]> = {};
const result = { data: null as unknown, error: null as unknown };
const chain: any = new Proxy({}, {
  get: (_target, prop: string) => {
    if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result);
    return (...args: unknown[]) => { calls[prop] = args; return chain; };
  },
});
vi.mock('../supabase', () => ({ supabase: { from: (table: string) => { calls.from = [table]; return chain; } } }));

const { assetAuditService, canRecordAssetAudit, canViewAssetAudits } = await import('../assetAuditService');

const user = (role: Role, codes: string[] = []): User => ({
  id: 'u1', name: 'A', email: 'a@example.com', role,
  permissionGrants: codes.map(permissionCode => ({ userId: 'u1', permissionCode, scopeType: 'global', scopeId: '*', isActive: true })),
} as User);

describe('asset audit service', () => {
  beforeEach(() => { for (const key of Object.keys(calls)) delete calls[key]; result.data = null; result.error = null; });

  it('reads recent audits with a row limit', async () => {
    result.data = [{ id: 's1', audited_at: '2026-10-02T03:00:00Z', auditor_name: 'B', items: [], total_items: 0, total_good: 0, total_damaged: 0, total_lost: 0, total_wrong_location: 0 }];
    const rows = await assetAuditService.list();
    expect(calls.from).toEqual(['asset_audit_sessions']);
    expect(calls.limit).toEqual([200]);
    expect(rows[0]).toMatchObject({ id: 's1', auditorName: 'B', date: '2026-10-02T03:00:00Z' });
  });

  it('saves totals that match the items and lets the server name the auditor', async () => {
    result.data = { id: 's2', audited_at: 'now', auditor_name: 'B', items: [], total_items: 3, total_good: 1, total_damaged: 1, total_lost: 1, total_wrong_location: 0 };
    const items = [
      { assetId: 'a', actualCondition: 'good' }, { assetId: 'b', actualCondition: 'damaged' }, { assetId: 'c', actualCondition: 'lost' },
    ] as any;
    await assetAuditService.create(items);
    const payload = calls.insert[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ total_items: 3, total_good: 1, total_damaged: 1, total_lost: 1, total_wrong_location: 0 });
    expect(payload).not.toHaveProperty('auditor_user_id');
    expect(payload).not.toHaveProperty('auditor_name');
  });

  it('surfaces save errors instead of pretending to save', async () => {
    result.error = { message: 'denied' };
    await expect(assetAuditService.create([{ assetId: 'a', actualCondition: 'good' }] as any)).rejects.toBeTruthy();
  });

  it('follows the audit permissions', () => {
    expect(canRecordAssetAudit(user(Role.ADMIN))).toBe(true);
    expect(canRecordAssetAudit(user(Role.EMPLOYEE, ['asset.audit.view']))).toBe(false);
    expect(canViewAssetAudits(user(Role.EMPLOYEE, ['asset.audit.view']))).toBe(true);
    expect(canViewAssetAudits(null)).toBe(false);
  });

  it('no longer fakes the save on the page', () => {
    const page = readFileSync(join(process.cwd(), 'pages/ts/AssetAudit.tsx'), 'utf8');
    expect(page).toContain('assetAuditService.create');
    expect(page).toContain('assetAuditService.list');
    expect(page).not.toMatch(/setTimeout\(\(\) => \{\s*setSessions/);
  });
});
