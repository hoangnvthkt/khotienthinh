import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hookPath = resolve(process.cwd(), 'hooks/useSafetyWorkforce.ts');
const source = existsSync(hookPath) ? readFileSync(hookPath, 'utf8') : '';
const panelPath = resolve(process.cwd(), 'components/project/safety/SafetyPassportPanel.tsx');
const panelSource = existsSync(panelPath) ? readFileSync(panelPath, 'utf8') : '';
const rosterPath = resolve(process.cwd(), 'components/project/safety/passport/SafetyWorkerRosterView.tsx');
const rosterSource = existsSync(rosterPath) ? readFileSync(rosterPath, 'utf8') : '';
const formPath = resolve(process.cwd(), 'components/project/safety/passport/SafetyWorkerProfileForm.tsx');
const formSource = existsSync(formPath) ? readFileSync(formPath, 'utf8') : '';
const detailPath = resolve(process.cwd(), 'components/project/safety/SafetyPassportWorkerDetailModal.tsx');
const detailSource = existsSync(detailPath) ? readFileSync(detailPath, 'utf8') : '';
const assignmentPath = resolve(process.cwd(), 'components/project/safety/passport/SafetyWorkerAssignmentDialog.tsx');
const assignmentSource = existsSync(assignmentPath) ? readFileSync(assignmentPath, 'utf8') : '';
const activePath = resolve(process.cwd(), 'components/project/safety/passport/SafetyActiveWorkforceView.tsx');
const activeSource = existsSync(activePath) ? readFileSync(activePath, 'utf8') : '';

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

  it('mounts exactly the selected scoped passport view', () => {
    expect(panelSource).toContain("mode === 'passport'");
    expect(panelSource).toContain('<SafetyPassportDashboardView');
    expect(panelSource).toContain('<SafetyWorkerRosterView');
    expect(panelSource).toContain('<SafetyActiveWorkforceView');
    expect(panelSource).not.toContain('useSafetyCards(');
    expect(panelSource).not.toContain('reloadAll');
  });

  it('uses debounced server-side roster filters and lazy form options', () => {
    expect(rosterSource).toContain('setTimeout');
    expect(rosterSource).toContain('250');
    expect(rosterSource).toContain('useSafetyRoster(scope, filters)');
    expect(rosterSource).toContain('useSafetyWorkforceOptions(scope, createOpen)');
    expect(rosterSource).not.toMatch(/page\.items\.filter\(/);
    expect(rosterSource).not.toContain('listWorkers()');
  });

  it('creates the profile before uploading worker attachments', () => {
    expect(formSource).toContain('safetyWorkforceApi.createProfile');
    expect(formSource).toContain('safetyWorkforceApi.uploadWorkerAttachment');
    expect(formSource).toContain('created = await safetyWorkforceApi.createProfile');
    expect(formSource).toContain('const completed = await uploadDocuments(created)');
    expect(formSource).toContain('safetyWorkforceApi.lookupExact');
    expect(formSource).toContain('Hồ sơ đã tạo, còn file chưa tải xong');
    expect(formSource).not.toContain('safetyPassportService');
  });

  it('reads worker detail through the scoped domain hook', () => {
    expect(detailSource).toContain('useSafetyWorkerDetail(scope, membershipId, false)');
    expect(detailSource).not.toContain('safetyPassportService');
    expect(detailSource).not.toContain('listWorkers()');
  });

  it('keeps assignment, ending and transfer decisions in scoped commands', () => {
    expect(assignmentSource).toContain("membershipStatus: 'candidate'");
    expect(assignmentSource).toContain("membershipStatus: 'inactive'");
    expect(assignmentSource).toContain('safetyWorkforceApi.lookupExact');
    expect(assignmentSource).toContain('safetyWorkforceApi.assign');
    expect(assignmentSource).toContain('safetyWorkforceApi.endAssignment');
    expect(assignmentSource).toContain('safetyWorkforceApi.transfer');
    expect(assignmentSource).toContain('SAFETY_WORKER_ACTIVE_ELSEWHERE');
    expect(activeSource).toContain("assignmentStatus: 'active'");
  });
});
