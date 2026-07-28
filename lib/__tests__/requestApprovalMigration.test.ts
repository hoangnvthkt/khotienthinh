import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase/migrations');
const file = readdirSync(dir).find(name =>
  name.endsWith('_request_approval_phase1_schema.sql'));
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';

describe('request approval phase 1 schema', () => {
  it('creates versioned request tables and private runtime support tables', () => {
    for (const table of [
      'request_templates',
      'request_template_versions',
      'request_approval_blocks',
      'request_template_watchers',
      'request_sequence_counters',
    ]) expect(sql).toContain(`public.${table}`);
    for (const table of [
      'request_command_idempotency',
      'request_notification_outbox',
      'request_export_audit',
    ]) expect(sql).toContain(`app_private.${table}`);
  });

  it('enables RLS and revokes direct writes', () => {
    expect(sql.match(/enable row level security/g)?.length).toBeGreaterThanOrEqual(6);
    expect(sql).toMatch(/revoke\s+insert,\s*update,\s*delete[\s\S]*authenticated/i);
    expect(sql).toContain('request_instance_can_select');
    expect(sql).toContain("'workflow-templates'");
    expect(sql).toContain('storage.objects');
  });

  it('adds request to shared workflow subjects and CANCELLED assignments', () => {
    expect(sql).toContain("'request'");
    expect(sql).toContain("'CANCELLED'");
    expect(sql).toContain('assignment_round_id');
  });
});
