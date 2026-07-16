import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { awardAuthenticatedDailyLogin } from '../../hooks/useDailyLoginXp';

describe('frontend daily XP integration', () => {
  it('requests a daily login award without supplying client authority fields', async () => {
    const awardDailyXP = vi.fn(async () => ({
      awarded: false,
      xpGained: 0,
      profile: null as never,
      newBadges: [],
    }));

    await awardAuthenticatedDailyLogin(awardDailyXP, true);

    expect(awardDailyXP).toHaveBeenCalledTimes(1);
    expect(awardDailyXP).toHaveBeenCalledWith('daily_login');
  });

  it('does not call Supabase XP in unconfigured mock mode', async () => {
    const awardDailyXP = vi.fn();

    await expect(awardAuthenticatedDailyLogin(awardDailyXP, false)).resolves.toBeNull();

    expect(awardDailyXP).not.toHaveBeenCalled();
  });

  it('mounts the daily-login host only inside the authenticated boundary after telemetry', () => {
    const source = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');
    const applicationStart = source.indexOf('export const AuthenticatedApplication');
    const applicationEnd = source.indexOf('const ApplicationRouter', applicationStart);
    const authenticatedApplication = source.slice(applicationStart, applicationEnd);
    const boundaryStart = authenticatedApplication.indexOf('<AuthenticatedBoundary>');
    const boundaryEnd = authenticatedApplication.indexOf('</AuthenticatedBoundary>');
    const telemetryHost = authenticatedApplication.indexOf('<UserSessionTelemetryHost />');
    const dailyLoginHost = authenticatedApplication.indexOf('<DailyLoginXpHost />');

    expect(source).toContain("import { DailyLoginXpHost } from './hooks/useDailyLoginXp';");
    expect(boundaryStart).toBeGreaterThanOrEqual(0);
    expect(boundaryEnd).toBeGreaterThan(boundaryStart);
    expect(telemetryHost).toBeGreaterThan(boundaryStart);
    expect(dailyLoginHost).toBeGreaterThan(telemetryHost);
    expect(dailyLoginHost).toBeLessThan(boundaryEnd);
    expect(authenticatedApplication.match(/<DailyLoginXpHost\s*\/>/g)).toHaveLength(1);
  });

  it('awards a persisted camera check-in by attendance UUID, never employee ID', () => {
    const source = readFileSync(join(process.cwd(), 'pages', 'hrm', 'CheckIn.tsx'), 'utf8');

    const persistedAt = source.indexOf('const saved = await checkInService.submit');
    const awardedAt = source.indexOf("xpService.awardDailyXP('daily_checkin', saved.id)");
    const refreshedAt = source.indexOf("await loadModuleData('hrm', true)", persistedAt);

    expect(source).toContain("xpService.awardDailyXP('daily_checkin', saved.id)");
    expect(source).not.toMatch(/award(?:Daily)?XP\(currentEmployee!?\.id\s*,?\s*['"]daily_checkin/);
    expect(persistedAt).toBeGreaterThanOrEqual(0);
    expect(awardedAt).toBeGreaterThan(persistedAt);
    expect(awardedAt).toBeLessThan(refreshedAt);
  });

  it('removes client-side XP awards from request and workflow mutations', () => {
    const requestSource = readFileSync(join(process.cwd(), 'context', 'RequestContext.tsx'), 'utf8');
    const workflowSource = readFileSync(join(process.cwd(), 'context', 'WorkflowContext.tsx'), 'utf8');

    expect(requestSource).not.toMatch(/awardXP|awardDailyXP|create_rq|approve_rq/);
    expect(workflowSource).not.toMatch(/awardXP|awardDailyXP|create_workflow|approve_workflow/);
  });
});
