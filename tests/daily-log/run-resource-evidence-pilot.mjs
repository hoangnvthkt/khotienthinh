import { readFileSync } from 'node:fs';
import { loginPersonas } from './personas.mjs';
import { query, ref } from './cloud.mjs';

const projectId = 'DL-WBS-PILOT-20260925';
const readerMemberId = '73000000-0000-4000-8000-000000000001';
const approverId = '72000000-0000-4000-8000-000000000004';
const staffId = '72000000-0000-4000-8002-000000000005';
const operation = readFileSync('supabase/operations/resource_usage_evidence_pilot.sql', 'utf8');
const config = mode => ({
  projectId, constructionSiteId: null, fromDate: '2026-10-18', toDate: '2026-10-18',
  releaseId: 'resource-evidence-20260925-pilot', ownerUserId: approverId,
  reason: mode === 'pilot' ? 'Short-lived authorized Cloud pilot' : 'Return test binding to audit-only',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), mode,
});
const literal = value => JSON.stringify(value).replaceAll("'", "''");
const scopedSql = (mode, prefix = '') => `begin;
${prefix}
select set_config('app.resource_evidence_operation','${literal(config(mode))}',true);
${operation}
commit;`;

const sessions = await loginPersonas();
let pilotStarted = false;
try {
  const before = await query(`select count(*)::int as count from public.project_transactions where project_id='${projectId}'`, true);
  const grant = `insert into public.project_permission_room_members(
    id,project_id,room_code,project_staff_id,is_active,created_by
  ) values ('${readerMemberId}','${projectId}','payment','${staffId}',true,'${approverId}')
  on conflict (id) do update set is_active=true;
  insert into public.project_permission_room_member_actions(
    room_member_id,action_code,is_active,granted_by,grant_source
  ) values ('${readerMemberId}','view_resource_evidence',true,'${approverId}','manual_room')
  on conflict (room_member_id,action_code) do update set is_active=true;`;
  const plan = await query(scopedSql('pilot', grant), false);
  pilotStarted = true;

  const args = {
    p_project_id: projectId, p_construction_site_id: null,
    p_from_date: '2026-10-18', p_to_date: '2026-10-18',
    p_provider_key: null, p_task_id: null, p_resource_type: null,
    p_include_superseded: false, p_cursor: null, p_limit: 200,
  };
  const started = performance.now();
  const accepted = await sessions.reader.client.rpc('get_verified_resource_usage_evidence_v1', args);
  const durationMs = Math.round(performance.now() - started);
  if (accepted.error) throw accepted.error;
  const data = accepted.data;
  if (data.rows.length !== 2 || Number(data.totals.totalLaborHours) !== 40
    || Number(data.totals.totalMachineHours) !== 12
    || data.rows.some(row => row.revisionState !== 'current')) {
    throw new Error('RESOURCE_EVIDENCE_PILOT_PHYSICAL_TOTALS_WRONG');
  }
  if (/(unitCost|totalCost|amount|currency|price)/i.test(JSON.stringify(data))) {
    throw new Error('RESOURCE_EVIDENCE_PILOT_MONEY_LEAK');
  }
  const denied = await sessions.denied.client.rpc('get_verified_resource_usage_evidence_v1', args);
  if (!denied.error || !denied.error.message.includes('RESOURCE_EVIDENCE_SCOPE_DENIED')) {
    throw new Error('RESOURCE_EVIDENCE_PILOT_DENIED_PERSONA_ACCEPTED');
  }
  const wrongScope = await sessions.reader.client.rpc('get_verified_resource_usage_evidence_v1', {
    ...args, p_project_id: 'RICO',
  });
  if (!wrongScope.error || !wrongScope.error.message.includes('RESOURCE_EVIDENCE_SCOPE_DENIED')) {
    throw new Error('RESOURCE_EVIDENCE_PILOT_WRONG_SCOPE_ACCEPTED');
  }
  const after = await query(`select count(*)::int as count from public.project_transactions where project_id='${projectId}'`, true);
  if (before[0].count !== after[0].count) throw new Error('RESOURCE_EVIDENCE_PILOT_TRANSACTION_CHANGED');
  console.log(JSON.stringify({ ref, result: 'PASS', projectId, durationMs,
    lineCount: data.rows.length, providerCount: data.totals.providerCount,
    totalLaborHours: data.totals.totalLaborHours, totalMachineHours: data.totals.totalMachineHours,
    unknownLegacyCount: data.unknownLegacyCount, denied: true, wrongScopeDenied: true,
    projectTransactionsUnchanged: true, queryPlanReturned: Array.isArray(plan),
  }));
} finally {
  if (pilotStarted) {
    await query(scopedSql('audit_only', `update public.project_permission_room_member_actions
      set is_active=false where room_member_id='${readerMemberId}' and action_code='view_resource_evidence';
      update public.project_permission_room_members set is_active=false where id='${readerMemberId}';`), false);
    console.log(JSON.stringify({ ref, binding: 'audit_only', testGrant: 'inactive' }));
  }
}
