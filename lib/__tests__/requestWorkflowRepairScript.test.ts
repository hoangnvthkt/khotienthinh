import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repairPath = join(process.cwd(), 'scripts/repair-rq-2026-000010.sql');
const sql = existsSync(repairPath) ? readFileSync(repairPath, 'utf8') : '';
const normalized = sql.replace(/\s+/g, ' ').trim();

describe('RQ-2026-000010 guarded repair script', () => {
  it('targets exactly one request code and locks all mutable state', () => {
    expect(existsSync(repairPath)).toBe(true);
    expect(sql.match(/RQ-2026-000010/g)).toHaveLength(1);
    expect(normalized).toMatch(/from public\.request_instances[\s\S]*for update/i);
    expect(normalized).toMatch(/from public\.workflow_subjects[\s\S]*for update/i);
    expect(normalized).toMatch(/from public\.workflow_instances[\s\S]*for update/i);
    expect(normalized).toMatch(/from public\.workflow_step_assignments[\s\S]*for update/i);
  });

  it('asserts the exact inconsistent state and approval evidence', () => {
    expect(normalized).toContain("v_request.status <> 'PENDING'");
    expect(normalized).toContain("v_subject.status <> 'RUNNING'");
    expect(normalized).toContain("v_workflow.status <> 'COMPLETED'");
    expect(normalized).toContain('v_pending_count <> 1');
    expect(normalized).toContain('v_log.acted_by is distinct from v_assignment.assignee_user_id');
  });

  it('reconciles Request state without creating a duplicate activity log', () => {
    expect(normalized).toMatch(/update public\.workflow_step_assignments[\s\S]*status = 'APPROVED'/i);
    expect(normalized).toMatch(/update public\.request_instances[\s\S]*status = 'APPROVED'/i);
    expect(normalized).toMatch(/update public\.workflow_subjects[\s\S]*status = 'COMPLETED'/i);
    expect(normalized).not.toMatch(/insert into public\.workflow_instance_logs/i);
  });
});
