import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const runtimeFiles = [
  'pages/project/GanttTab.tsx',
  'pages/project/WeeklyProgressTab.tsx',
  'pages/project/ReportTab.tsx',
  'lib/projectScheduleRules.ts',
  'lib/projectService.ts',
  'lib/projectScheduleProjection.ts',
  'lib/projectExecutiveScheduleService.ts',
  'lib/projectDashboardMetricsService.ts',
  'lib/portfolioService.ts',
  'lib/projectDocumentDependencyService.ts',
  'lib/projectDocumentPolicy.ts',
  'supabase/functions/_shared/aiDatabaseContext.ts',
];

describe('retired Gantt completion workflow runtime', () => {
  it.each(runtimeFiles)('%s has no completion or gate behavior', file => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    expect(source).not.toMatch(/project_task_completion_requests/i);
    expect(source).not.toMatch(/taskCompletionRequestService/);
    expect(source).not.toMatch(/ProjectTaskCompletionRequest/);
    expect(source).not.toMatch(/completionRequests/);
    expect(source).not.toMatch(/completion_request/);
    expect(source).not.toMatch(/gateStatus|gate_status|gateApproved|requiresGateApproval|pending_gate/);
  });

  it('removes completion and gate UI/service modules', () => {
    expect(existsSync(join(process.cwd(), 'lib/projectTaskCompletionService.ts'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'components/project/GateStateMachineModal.tsx'))).toBe(false);
  });
});
