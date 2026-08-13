import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase', 'tests', 'gantt_room_authoritative_cutover_smoke.sql'),
  'utf8',
);

describe('Gantt Cloud cutover smoke contract', () => {
  it('is transaction-safe and covers the mandatory authorization matrix', () => {
    expect(sql.trimStart().toLowerCase()).toMatch(/^--[^\n]*\nbegin;/);
    expect(sql.trimEnd().toLowerCase()).toMatch(/rollback;$/);
    for (const marker of [
      'matrix_viewer',
      'matrix_editor',
      'matrix_deleter',
      'matrix_pbac_only',
      'matrix_module_only',
      'matrix_assignee_only',
      'matrix_inactive_actor',
      'matrix_inactive_staff',
      'matrix_empty_room',
      'matrix_system_admin',
      'wrong project',
      'wrong site',
    ]) expect(sql).toContain(marker);
  });

  it('checks denial paths, idempotency, rollback and historical completion preservation', () => {
    for (const marker of [
      'GANTT_PERMISSION_DENIED',
      'GANTT_SCOPE_MISMATCH',
      'GANTT_STALE_VERSION',
      'GANTT_REQUEST_ID_REUSED',
      'GANTT_DELETE_BLOCKED',
      'direct project_tasks update denial',
      'completion count changed',
    ]) expect(sql).toContain(marker);
  });
});
