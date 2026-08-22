import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hookPath = resolve(process.cwd(), 'hooks/useSafetyWorkforce.ts');
const source = existsSync(hookPath) ? readFileSync(hookPath, 'utf8') : '';

describe('Safety Workforce UI resource contract', () => {
  it('uses the module-ready scoped API and guards against stale requests', () => {
    expect(source).toContain("from '../lib/safetyWorkforceApi'");
    expect(source).toContain('requestVersionRef');
    expect(source).toContain('setData(null)');
    expect(source).toContain('version === requestVersionRef.current');
    expect(source).toContain('enabled');
    expect(source).not.toContain('listWorkers()');
    expect(source).not.toContain('safetyPassportService');
  });

  it('exposes dashboard, roster, active, detail and lazy options resources', () => {
    expect(source).toContain('export function useSafetyDashboard');
    expect(source).toContain('export function useSafetyRoster');
    expect(source).toContain('export function useSafetyActiveWorkforce');
    expect(source).toContain('export function useSafetyWorkerDetail');
    expect(source).toContain('export function useSafetyWorkforceOptions');
    expect(source).toContain("assignmentStatus: 'active'");
  });
});
