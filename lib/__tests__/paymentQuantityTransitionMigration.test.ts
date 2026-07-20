import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
const candidates = fs
  .readdirSync(migrationDir)
  .filter(name => name.endsWith('_payment_quantity_transition_commands.sql'));

describe('Payment and Quantity transition command migration', () => {
  it('puts existing lifecycle transitions behind scoped backend commands', () => {
    expect(candidates).toHaveLength(1);
    const sql = fs.readFileSync(path.join(migrationDir, candidates[0]), 'utf8');

    expect(sql).toMatch(/create or replace function public\.transition_project_payment_certificate_status/i);
    expect(sql).toMatch(/create or replace function public\.transition_project_quantity_acceptance_status/i);
    expect(sql).toMatch(/app_private\.project_has_permission_v2/i);
    expect(sql).toMatch(/'project\.payment\.verify'/i);
    expect(sql).toMatch(/'project\.payment\.approve'/i);
    expect(sql).toMatch(/'project\.payment\.confirm'/i);
    expect(sql).toMatch(/'project\.quantity_acceptance\.verify'/i);
    expect(sql).toMatch(/'project\.quantity_acceptance\.approve'/i);
    expect(sql).toMatch(/create or replace function app_private\.guard_payment_certificate_direct_workflow_update/i);
    expect(sql).toMatch(/create or replace function app_private\.guard_quantity_acceptance_direct_workflow_update/i);
    expect(sql).toMatch(/payment_certificate_items/i);
    expect(sql).toMatch(/quantity_acceptance_items/i);
    expect(sql).toMatch(/using errcode = '23514'/i);
    expect(sql).not.toMatch(/when\s+'approved',\s*'cancelled'/i);
    expect(sql).not.toMatch(/grant_readiness/i);
    expect(sql).not.toMatch(/user_permission_grants/i);
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
  });
});
