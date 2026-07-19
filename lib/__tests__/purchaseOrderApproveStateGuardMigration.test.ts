import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
const smokePath = path.resolve(process.cwd(), 'supabase/tests/phase3_material_permissions_smoke.sql');
const candidates = fs
  .readdirSync(migrationDir)
  .filter(name => name.endsWith('_purchase_order_approve_state_guard.sql'));

describe('Purchase Order approve state-guard migration', () => {
  it('limits PO approval to sent-to-confirmed or sent-to-returned transitions', () => {
    expect(candidates).toHaveLength(1);
    const sql = fs.readFileSync(path.join(migrationDir, candidates[0]), 'utf8');

    expect(sql).toMatch(/create or replace function public\.transition_project_purchase_order_status/i);
    expect(sql).toMatch(/coalesce\(p_status,\s*''\)\s*=\s*'sent'.*project\.material_po\.create/is);
    expect(sql).toMatch(/coalesce\(p_status,\s*''\)\s+in\s*\('confirmed',\s*'returned'\).*project\.material_po\.approve/is);
    expect(sql).toMatch(/v_required_permission\s*=\s*'project\.material_po\.approve'/i);
    expect(sql).toMatch(/lower\(coalesce\(v_po\.status,\s*''\)\)\s*<>\s*'sent'/i);
    expect(sql).toMatch(/lower\(coalesce\(p_status,\s*''\)\)\s+not in\s*\('confirmed',\s*'returned'\)/i);
    expect(sql).toMatch(/coalesce\(p_status,\s*''\)\s*=\s*'cancelled'/i);
    expect(sql).toMatch(/using errcode = '23514'/i);
    expect(sql).not.toMatch(/grant_readiness/i);
    expect(sql).not.toMatch(/user_permission_grants/i);
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
  });

  it('uses sent PO fixtures for approval and wrong-scope approval evidence', () => {
    const smoke = fs.readFileSync(smokePath, 'utf8');

    expect(smoke).toMatch(/'phase3-po-approve'[\s\S]*?'sent',\s*'proactive_project'/i);
    expect(smoke).toMatch(/'phase3-po-approve-wrong-scope'[\s\S]*?'sent',\s*'proactive_project'/i);
    expect(smoke).toMatch(/'phase3-po-manage'[\s\S]*?'sent',\s*'proactive_project'/i);
  });
});
