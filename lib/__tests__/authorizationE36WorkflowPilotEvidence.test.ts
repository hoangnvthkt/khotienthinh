import { describe, expect, it } from 'vitest';
import {
  buildE36EvidenceSql,
  redactE36Evidence,
  validateE36Inputs,
} from '../../scripts/authorization-v2/check-task12-4-2-e36-workflow-pilot.mjs';

const workflowUserId = '11111111-1111-4111-8111-111111111111';
const workflowAdminId = '22222222-2222-4222-8222-222222222222';
const windowStart = '2026-09-17T08:00:00.000Z';

describe('E36 Workflow pilot evidence checker', () => {
  it('rejects unsafe identifiers and timestamps before building SQL', () => {
    expect(() => validateE36Inputs({ workflowUserId: 'not-a-uuid', workflowAdminId, windowStart }))
      .toThrow('E36_WORKFLOW_USER_ID');
    expect(() => validateE36Inputs({ workflowUserId, workflowAdminId: workflowUserId, windowStart }))
      .toThrow('different users');
    expect(() => validateE36Inputs({ workflowUserId, workflowAdminId, windowStart: 'not-a-date' }))
      .toThrow('E36_WINDOW_START');
  });

  it('builds a read-only query covering grants, assignments, sources, audits, activity and transition ledger', () => {
    const sql = buildE36EvidenceSql({ workflowUserId, workflowAdminId, windowStart }).toLowerCase();

    expect(sql).toContain('user_permission_grants');
    expect(sql).toContain('principal_role_assignments');
    expect(sql).toContain('resolve_effective_permission_sources');
    expect(sql).toContain('permission_audit_events');
    expect(sql).toContain('auth.sessions');
    expect(sql).toContain('workflow_notification_command_keys');
    expect(sql).toContain('workflow_instance_logs');
    expect(sql).toContain('authorization_transition_batches');
    expect(sql).toContain('non_workflow_fingerprint');
    expect(sql).not.toMatch(/\b(insert|update|delete|alter|drop|truncate|grant|revoke)\b\s+(into|table|from|on)?/);
  });

  it('redacts UUIDs, emails, names and nested command payloads from output', () => {
    const report = redactE36Evidence({
      checkedAt: windowStart,
      targetUserId: workflowUserId,
      email: 'pilot@example.com',
      name: 'Pilot Person',
      personas: [{
        label: 'workflowUser',
        scopeId: workflowAdminId,
        metadata: { secret: 'do-not-print' },
        commands: [{ commandName: 'create_workflow_draft', count: 1 }],
      }],
    });
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain(workflowUserId);
    expect(serialized).not.toContain(workflowAdminId);
    expect(serialized).not.toContain('pilot@example.com');
    expect(serialized).not.toContain('Pilot Person');
    expect(serialized).not.toContain('do-not-print');
    expect(report.personas[0]).toMatchObject({
      label: 'workflowUser',
      scopeId: '[REDACTED_UUID]',
      commands: [{ commandName: 'create_workflow_draft', count: 1 }],
    });
  });
});
