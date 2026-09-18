#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidAnywherePattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
const droppedKeys = new Set([
  'id', 'name', 'email', 'metadata', 'payload', 'result',
  'targetuserid', 'actoruserid', 'principalid', 'sourceid', 'assignmentid',
  'roletemplateid', 'auditid', 'commandid', 'instanceid', 'nodeid',
]);

export const validateE36Inputs = ({ workflowUserId, workflowAdminId = null, windowStart }) => {
  if (!uuidPattern.test(String(workflowUserId || ''))) {
    throw new Error('E36_WORKFLOW_USER_ID must be a UUID');
  }
  if (workflowAdminId && !uuidPattern.test(String(workflowAdminId))) {
    throw new Error('E36_WORKFLOW_ADMIN_ID must be a UUID');
  }
  if (workflowAdminId && workflowUserId === workflowAdminId) {
    throw new Error('E36 Workflow personas must be different users');
  }
  const parsedWindow = new Date(String(windowStart || ''));
  if (!windowStart || Number.isNaN(parsedWindow.getTime())) {
    throw new Error('E36_WINDOW_START must be an ISO timestamp');
  }
  return {
    workflowUserId: String(workflowUserId).toLowerCase(),
    workflowAdminId: workflowAdminId ? String(workflowAdminId).toLowerCase() : null,
    windowStart: parsedWindow.toISOString(),
  };
};

const redactString = value => value
  .replace(uuidAnywherePattern, '[REDACTED_UUID]')
  .replace(emailPattern, '[REDACTED_EMAIL]');

export const redactE36Evidence = value => {
  if (Array.isArray(value)) return value.map(redactE36Evidence);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !droppedKeys.has(key.toLowerCase()))
      .map(([key, nested]) => [key, redactE36Evidence(nested)]));
  }
  return typeof value === 'string' ? redactString(value) : value;
};

export const buildE36EvidenceSql = inputs => {
  const { workflowUserId, workflowAdminId, windowStart } = validateE36Inputs(inputs);
  const personaRows = [
    `('workflowUser'::text, '${workflowUserId}'::uuid)`,
    ...(workflowAdminId ? [`('workflowAdmin'::text, '${workflowAdminId}'::uuid)`] : []),
  ].join(',\n    ');
  return `
with
inputs as (
  select '${windowStart}'::timestamptz as window_start
),
personas(label, user_id) as (
  values
    ${personaRows}
),
persona_accounts as (
  select
    persona.label,
    account.is_active,
    account.account_status,
    account.updated_at,
    auth_account.last_sign_in_at,
    session_state.active_session_count,
    session_state.refreshed_last_two_hours,
    session_state.last_refreshed_at
  from personas persona
  left join public.users account on account.id = persona.user_id
  left join auth.users auth_account on auth_account.id = account.auth_id
  left join lateral (
    select
      count(session.id)::integer as active_session_count,
      count(session.id) filter (
        where session.refreshed_at >= now() - interval '2 hours'
      )::integer as refreshed_last_two_hours,
      max(session.refreshed_at) as last_refreshed_at
    from auth.sessions session
    where session.user_id = account.auth_id
      and (session.not_after is null or session.not_after > now())
  ) session_state on true
),
active_grants as (
  select
    persona.label,
    grant_row.permission_code,
    grant_row.scope_type,
    grant_row.scope_id,
    grant_row.expires_at
  from personas persona
  join public.user_permission_grants grant_row on grant_row.user_id = persona.user_id
  where grant_row.is_active
    and (grant_row.expires_at is null or grant_row.expires_at > now())
),
direct_summaries as (
  select
    persona.label,
    count(grant_row.permission_code)::integer as active_count,
    count(grant_row.permission_code) filter (
      where grant_row.permission_code like 'workflow.%'
    )::integer as workflow_direct_count,
    count(grant_row.permission_code) filter (
      where grant_row.permission_code not like 'workflow.%'
    )::integer as non_workflow_count,
    encode(extensions.digest(convert_to(coalesce((
      select jsonb_agg(jsonb_build_object(
        'permissionCode', fingerprint_row.permission_code,
        'scopeType', fingerprint_row.scope_type,
        'scopeId', fingerprint_row.scope_id,
        'expiresAt', fingerprint_row.expires_at
      ) order by fingerprint_row.permission_code, fingerprint_row.scope_type,
        fingerprint_row.scope_id, fingerprint_row.expires_at)::text
      from active_grants fingerprint_row
      where fingerprint_row.label = persona.label
        and fingerprint_row.permission_code not like 'workflow.%'
    ), '[]'), 'UTF8'), 'sha256'), 'hex') as non_workflow_fingerprint
  from personas persona
  left join active_grants grant_row on grant_row.label = persona.label
  group by persona.label
),
workflow_direct_grants as (
  select
    persona.label,
    coalesce(jsonb_agg(jsonb_build_object(
      'permissionCode', grant_row.permission_code,
      'scopeType', grant_row.scope_type,
      'scopeId', grant_row.scope_id,
      'expiresAt', grant_row.expires_at
    ) order by grant_row.permission_code, grant_row.scope_type, grant_row.scope_id)
      filter (where grant_row.permission_code is not null), '[]'::jsonb) as grants
  from personas persona
  left join active_grants grant_row on grant_row.label = persona.label
    and grant_row.permission_code like 'workflow.%'
  group by persona.label
),
compatibility_shells as (
  select
    persona.label,
    coalesce(jsonb_agg(jsonb_build_object(
      'permissionCode', grant_row.permission_code,
      'scopeType', grant_row.scope_type,
      'scopeId', grant_row.scope_id,
      'expiresAt', grant_row.expires_at
    ) order by grant_row.permission_code)
      filter (where grant_row.permission_code is not null), '[]'::jsonb) as grants
  from personas persona
  left join active_grants grant_row on grant_row.label = persona.label
    and grant_row.permission_code like 'system.wf.%'
  group by persona.label
),
role_sources as (
  select
    persona.label,
    coalesce(jsonb_agg(jsonb_build_object(
      'permissionCode', source_row.permission_code,
      'sourceType', source_row.source_type,
      'sourceCode', source_row.source_code,
      'scopeType', source_row.scope_type,
      'scopeId', source_row.scope_id,
      'expiresAt', source_row.expires_at
    ) order by source_row.permission_code, source_row.source_type, source_row.source_code)
      filter (where source_row.permission_code is not null), '[]'::jsonb) as sources
  from personas persona
  left join lateral app_private.resolve_effective_permission_sources(
    persona.user_id, null, null, null, now()
  ) source_row on source_row.permission_code like 'workflow.%'
    or source_row.permission_code like 'system.wf.%'
  group by persona.label
),
role_assignments as (
  select
    persona.label,
    coalesce(jsonb_agg(jsonb_build_object(
      'roleCode', template.code,
      'roleVersion', template.version,
      'status', assignment.status,
      'startsAt', assignment.starts_at,
      'expiresAt', assignment.expires_at,
      'createdAt', assignment.created_at,
      'updatedAt', assignment.updated_at
    ) order by assignment.created_at desc)
      filter (where assignment.created_at is not null), '[]'::jsonb) as assignments
  from personas persona
  left join public.principal_role_assignments assignment
    on assignment.principal_type = 'user'
    and assignment.principal_id = persona.user_id
    and assignment.role_template_id in (
      select workflow_template.id
      from public.role_permission_templates workflow_template
      where workflow_template.code in ('WORKFLOW_USER', 'WORKFLOW_ADMIN')
    )
  left join public.role_permission_templates template
    on template.id = assignment.role_template_id
    and template.code in ('WORKFLOW_USER', 'WORKFLOW_ADMIN')
  group by persona.label
),
authorization_audits as (
  select
    persona.label,
    coalesce(jsonb_agg(jsonb_build_object(
      'eventType', event.event_type,
      'createdAt', event.created_at
    ) order by event.created_at)
      filter (where event.created_at is not null), '[]'::jsonb) as events
  from personas persona
  cross join inputs
  left join public.permission_audit_events event
    on event.target_user_id = persona.user_id
    and event.created_at >= inputs.window_start
  group by persona.label
),
workflow_commands as (
  select
    persona.label,
    coalesce(jsonb_agg(jsonb_build_object(
      'commandName', command.command_name,
      'createdAt', command.created_at,
      'completed', command.result is not null
    ) order by command.created_at)
      filter (where command.created_at is not null), '[]'::jsonb) as commands
  from personas persona
  cross join inputs
  left join app_private.workflow_notification_command_keys command
    on command.actor_user_id = persona.user_id
    and command.created_at >= inputs.window_start
  group by persona.label
),
workflow_logs as (
  select
    persona.label,
    coalesce(jsonb_agg(jsonb_build_object(
      'action', log.action,
      'createdAt', log.created_at
    ) order by log.created_at)
      filter (where log.created_at is not null), '[]'::jsonb) as logs
  from personas persona
  cross join inputs
  left join public.workflow_instance_logs log
    on log.acted_by = persona.user_id
    and log.created_at >= inputs.window_start
  group by persona.label
),
workflow_instances as (
  select
    persona.label,
    coalesce(jsonb_agg(jsonb_build_object(
      'status', instance.status,
      'createdAt', instance.created_at,
      'updatedAt', instance.updated_at
    ) order by instance.created_at)
      filter (where instance.created_at is not null), '[]'::jsonb) as instances
  from personas persona
  cross join inputs
  left join public.workflow_instances instance
    on instance.created_by = persona.user_id
    and instance.created_at >= inputs.window_start
  group by persona.label
),
revoked_workflow_grants as (
  select
    persona.label,
    count(grant_row.id)::integer as revoked_count,
    max(grant_row.revoked_at) as last_revoked_at,
    coalesce(jsonb_agg(distinct grant_row.revoked_reason)
      filter (where grant_row.revoked_reason is not null), '[]'::jsonb) as reasons
  from personas persona
  cross join inputs
  left join public.user_permission_grants grant_row
    on grant_row.user_id = persona.user_id
    and grant_row.permission_code like 'workflow.%'
    and not grant_row.is_active
    and grant_row.revoked_at >= inputs.window_start
  group by persona.label
),
template_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'roleCode', template.code,
    'roleVersion', template.version,
    'itemCount', (
      select count(*)::integer
      from public.role_permission_template_items item
      where item.template_id = template.id
    ),
    'activeAssignmentCount', (
      select count(*)::integer
      from public.principal_role_assignments assignment
      where assignment.role_template_id = template.id
        and assignment.status = 'ACTIVE'
        and assignment.starts_at <= now()
        and (assignment.expires_at is null or assignment.expires_at > now())
    )
  ) order by template.code), '[]'::jsonb) as templates
  from public.role_permission_templates template
  where template.code in ('WORKFLOW_USER', 'WORKFLOW_ADMIN') and template.is_active
),
transition_ledger as (
  select jsonb_build_object(
    'batchCount', (select count(*)::integer from app_private.authorization_transition_batches),
    'itemCount', (select count(*)::integer from app_private.authorization_transition_items)
  ) as ledger
)
select jsonb_build_object(
  'checkpoint', 'E36',
  'checkedAt', now(),
  'windowStart', inputs.window_start,
  'personas', (
    select jsonb_agg(jsonb_build_object(
      'label', persona.label,
      'account', jsonb_build_object(
        'isActive', account.is_active,
        'accountStatus', account.account_status,
        'updatedAt', account.updated_at,
        'lastSignInAt', account.last_sign_in_at,
        'activeSessionCount', account.active_session_count,
        'refreshedLastTwoHours', account.refreshed_last_two_hours,
        'lastSessionRefreshedAt', account.last_refreshed_at
      ),
      'directGrantSummary', jsonb_build_object(
        'activeCount', summary.active_count,
        'workflowDirectCount', summary.workflow_direct_count,
        'nonWorkflowCount', summary.non_workflow_count,
        'nonWorkflowFingerprint', summary.non_workflow_fingerprint
      ),
      'workflowDirectGrants', workflow_grants.grants,
      'compatibilityShells', shells.grants,
      'effectiveWorkflowSources', sources.sources,
      'roleAssignments', assignments.assignments,
      'authorizationAuditEvents', audits.events,
      'workflowCommands', commands.commands,
      'workflowLogs', logs.logs,
      'workflowInstances', instances.instances,
      'revokedWorkflowGrants', jsonb_build_object(
        'revokedCount', revoked.revoked_count,
        'lastRevokedAt', revoked.last_revoked_at,
        'reasons', revoked.reasons
      )
    ) order by persona.label)
    from personas persona
    join persona_accounts account using (label)
    join direct_summaries summary using (label)
    join workflow_direct_grants workflow_grants using (label)
    join compatibility_shells shells using (label)
    join role_sources sources using (label)
    join role_assignments assignments using (label)
    join authorization_audits audits using (label)
    join workflow_commands commands using (label)
    join workflow_logs logs using (label)
    join workflow_instances instances using (label)
    join revoked_workflow_grants revoked using (label)
  ),
  'templates', template_state.templates,
  'transitionLedger', transition_ledger.ledger
) as evidence
from inputs cross join template_state cross join transition_ledger;
`.trim();
};

const extractEvidence = response => {
  const rows = Array.isArray(response) ? response : response?.rows;
  if (!Array.isArray(rows) || !rows[0]?.evidence) {
    throw new Error('Cloud E36 evidence query returned an invalid response');
  }
  return rows[0].evidence;
};

const runCloudCheck = ({ expectedProjectRef, env = process.env }) => {
  if (!expectedProjectRef) {
    throw new Error('Usage: check-task12-4-2-e36-workflow-pilot.mjs <expected-project-ref>');
  }
  const projectRoot = resolve(scriptDirectory, '../..');
  const linkedRef = readFileSync(resolve(projectRoot, 'supabase/.temp/project-ref'), 'utf8').trim();
  if (linkedRef !== expectedProjectRef) {
    throw new Error(`Cloud target mismatch: expected ${expectedProjectRef}, received ${linkedRef || '<unset>'}`);
  }
  const inputs = validateE36Inputs({
    workflowUserId: env.E36_WORKFLOW_USER_ID,
    workflowAdminId: env.E36_WORKFLOW_ADMIN_ID,
    windowStart: env.E36_WINDOW_START,
  });
  const query = spawnSync('npx', [
    '--yes', 'supabase@2.116.0', 'db', 'query', '--linked', '--agent=no',
    '--output', 'json', buildE36EvidenceSql(inputs),
  ], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (query.status !== 0) {
    throw new Error(`Cloud E36 evidence query failed: ${query.stderr.trim() || 'unknown error'}`);
  }
  const report = redactE36Evidence(extractEvidence(JSON.parse(query.stdout)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCloudCheck({ expectedProjectRef: process.argv[2] });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'E36 evidence check failed'}\n`);
    process.exitCode = 1;
  }
}
