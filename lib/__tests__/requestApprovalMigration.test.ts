import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase/migrations');
const file = readdirSync(dir).find(name =>
  name.endsWith('_request_approval_phase1_schema.sql'));
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';
const publishFile = readdirSync(dir).find(name =>
  name.endsWith('_request_template_publish_phase1.sql'));
const publishSql = publishFile ? readFileSync(join(dir, publishFile), 'utf8') : '';
const submitFile = readdirSync(dir).find(name =>
  name.endsWith('_request_submit_phase1.sql'));
const submitSql = submitFile ? readFileSync(join(dir, submitFile), 'utf8') : '';
const actionsFile = readdirSync(dir).find(name =>
  name.endsWith('_request_actions_phase1.sql'));
const actionsSql = actionsFile ? readFileSync(join(dir, actionsFile), 'utf8') : '';
const queryFile = readdirSync(dir).find(name =>
  name.endsWith('_request_queries_phase1.sql'));
const querySql = queryFile ? readFileSync(join(dir, queryFile), 'utf8') : '';
const docxDraftFile = readdirSync(dir).find(name =>
  name.endsWith('_request_template_docx_draft_contract.sql'));
const docxDraftSql = docxDraftFile ? readFileSync(join(dir, docxDraftFile), 'utf8') : '';
const draftConcurrencyFixFile = readdirSync(dir).find(name =>
  name.endsWith('_fix_request_template_draft_concurrency_token.sql'));
const draftConcurrencyFixSql = draftConcurrencyFixFile
  ? readFileSync(join(dir, draftConcurrencyFixFile), 'utf8')
  : '';
const templatePermissionFixFile = readdirSync(dir).find(name =>
  name.endsWith('_fix_request_template_manage_permission.sql'));
const templatePermissionFixSql = templatePermissionFixFile
  ? readFileSync(join(dir, templatePermissionFixFile), 'utf8')
  : '';
const templatePermissionExecuteFixFile = readdirSync(dir).find(name =>
  name.endsWith('_restore_request_template_manage_execute.sql'));
const templatePermissionExecuteFixSql = templatePermissionExecuteFixFile
  ? readFileSync(join(dir, templatePermissionExecuteFixFile), 'utf8')
  : '';
const templatePublishWrapperFixFile = readdirSync(dir).find(name =>
  name.endsWith('_restore_request_template_publish_wrapper.sql'));
const templatePublishWrapperFixSql = templatePublishWrapperFixFile
  ? readFileSync(join(dir, templatePublishWrapperFixFile), 'utf8')
  : '';
const templateDuplicateFile = readdirSync(dir).find(name =>
  name.endsWith('_request_template_duplicate_and_table_publish.sql'));
const templateDuplicateSql = templateDuplicateFile
  ? readFileSync(join(dir, templateDuplicateFile), 'utf8')
  : '';
const smokeSql = readFileSync(join(process.cwd(), 'supabase', 'tests', 'request_approval_phase1_smoke.sql'), 'utf8');
const schedulerFile = readdirSync(dir).find(name =>
  name.endsWith('_schedule_request_notification_worker.sql'));
const schedulerSql = schedulerFile ? readFileSync(join(dir, schedulerFile), 'utf8') : '';
const workerSchemaAccessFile = readdirSync(dir).find(name =>
  name.endsWith('_request_notification_worker_schema_access.sql'));
const workerSchemaAccessSql = workerSchemaAccessFile
  ? readFileSync(join(dir, workerSchemaAccessFile), 'utf8')
  : '';
const workerPrivateRpcFile = readdirSync(dir).find(name =>
  name.endsWith('_request_notification_worker_private_rpc.sql'));
const workerPrivateRpcSql = workerPrivateRpcFile
  ? readFileSync(join(dir, workerPrivateRpcFile), 'utf8')
  : '';
const pgcryptoSearchPathFile = readdirSync(dir).find(name =>
  name.endsWith('_request_pgcrypto_search_path.sql'));
const pgcryptoSearchPathSql = pgcryptoSearchPathFile
  ? readFileSync(join(dir, pgcryptoSearchPathFile), 'utf8')
  : '';
const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts?: Record<string, string> };

describe('request approval phase 1 schema', () => {
  it('runs request smoke against the linked Supabase Cloud project only', () => {
    const command = packageJson.scripts?.['smoke:request'] || '';

    expect(command).toContain('db query --linked');
    expect(command).not.toContain('--local');
  });

  it('uses auth IDs for simulated JWT subjects while retaining app-user IDs for request records', () => {
    expect(smokeSql).toContain('v_admin_auth_id uuid');
    expect(smokeSql).toContain('v_manager_auth_id uuid');
    expect(smokeSql).toContain("jsonb_build_object('sub', v_admin_auth_id, 'role', 'authenticated')");
    expect(smokeSql).toContain("jsonb_build_object('sub', v_manager_auth_id, 'role', 'authenticated')");
  });

  it('schedules the notification worker with a Vault-backed secret key', () => {
    expect(schedulerSql).toContain("'process-request-notifications-every-minute'");
    expect(schedulerSql).toContain('cron.schedule');
    expect(schedulerSql).toContain('net.http_post');
    expect(schedulerSql).toContain("name = 'request_notification_worker_service_key'");
    expect(schedulerSql).toContain('/functions/v1/process-request-notifications');
  });

  it('grants the service worker only schema access needed to execute its public RPC boundary', () => {
    expect(workerSchemaAccessSql).toContain('grant usage on schema app_private to service_role');
  });

  it('grants the worker service role the three private outbox RPCs and nothing broader', () => {
    expect(workerPrivateRpcSql).toContain(
      'grant execute on function app_private.claim_request_notification_outbox(integer) to service_role',
    );
    expect(workerPrivateRpcSql).toContain(
      'grant execute on function app_private.deliver_request_notification(uuid) to service_role',
    );
    expect(workerPrivateRpcSql).toContain(
      'grant execute on function app_private.fail_request_notification_outbox(uuid, text) to service_role',
    );
  });

  it('resolves pgcrypto digest from the extensions schema in request commands', () => {
    expect(pgcryptoSearchPathSql).toContain('alter function app_private.submit_request');
    expect(pgcryptoSearchPathSql).toContain('alter function app_private.act_on_request');
    expect(pgcryptoSearchPathSql).toContain('set search_path = extensions');
  });

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

  it('allows managers to delete only canonical draft DOCX templates', () => {
    expect(sql).toMatch(
      /create policy request_template_docx_delete_gate[\s\S]*?for delete[\s\S]*?request_template_docx_can_manage/i,
    );
    expect(sql).toMatch(
      /create policy request_template_docx_delete\s+on storage\.objects[\s\S]*?for delete[\s\S]*?request_template_docx_can_manage/i,
    );
  });

  it('requires an ACTIVE account at request visibility entry points', () => {
    expect(sql).toMatch(
      /function app_private\.request_template_version_can_use[\s\S]*?app_user\.account_status[\s\S]*?'ACTIVE'/i,
    );
    expect(sql).toMatch(
      /function app_private\.request_instance_can_select[\s\S]*?app_user\.account_status[\s\S]*?'ACTIVE'/i,
    );
  });

  it('publishes immutable request versions through the shared workflow engine', () => {
    expect(publishSql).toContain('app_private.publish_request_template_version');
    expect(publishSql).toContain('public.publish_request_template_version');
    expect(publishSql).toContain("'AUTO_ADVANCE_APPROVAL'");
    expect(publishSql).toContain("'START'::public.workflow_node_type");
    expect(publishSql).toContain("'END'::public.workflow_node_type");
    expect(publishSql).toContain("'APPROVAL'::public.workflow_node_type");
    expect(publishSql).toContain('workflow_template_versions');
    expect(publishSql).toContain("status = 'SUPERSEDED'");
  });

  it('keeps privileged commands private and exposes invoker wrappers', () => {
    expect(publishSql).toMatch(
      /create or replace function app_private\.publish_request_template_version[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    );
    expect(publishSql).toMatch(
      /create or replace function public\.publish_request_template_version[\s\S]*?security invoker[\s\S]*?set search_path = ''/i,
    );
    for (const name of [
      'save_request_template_draft',
      'get_request_template_draft',
      'list_request_templates',
      'create_request_template_draft_from_published',
      'deactivate_request_template',
      'preview_request_template_resolvers',
    ]) expect(publishSql).toContain(`public.${name}`);
  });

  it('guards publish concurrency, form/DOCX schema, and resolver preview', () => {
    expect(publishSql).toContain('p_expected_updated_at is null');
    expect(publishSql).toContain('jsonb_array_length(v_draft.form_schema) = 0');
    expect(publishSql).toContain('REQUEST_PRINT_PLACEHOLDER_UNKNOWN');
    expect(publishSql).toContain('REQUEST_PRINT_TEMPLATE_CLONE_DOCX_UNSUPPORTED');
    expect(publishSql).toContain('app_private.request_user_can_manage(v_actor)');
    expect(publishSql).toMatch(
      /revoke all on function app_private\.preview_request_template_resolvers\(jsonb, uuid\)[\s\S]*?from public, anon, authenticated/i,
    );
  });

  it('uses the template updated_at as the draft concurrency token', () => {
    expect(publishSql).toMatch(
      /public\.get_request_template_draft[\s\S]*?'updatedAt',\s*template\.updated_at/i,
    );
    expect(docxDraftSql).toMatch(
      /public\.get_request_template_draft[\s\S]*?'updatedAt',\s*template\.updated_at/i,
    );
    expect(draftConcurrencyFixSql).toMatch(
      /public\.get_request_template_draft[\s\S]*?'updatedAt',\s*template\.updated_at/i,
    );
  });

  it('updates an existing draft version with one valid SET clause', () => {
    expect(publishSql).not.toMatch(/set\s+form_schema\s*=\s*v_form_schema,\s*set\s+form_schema/i);
  });

  it('recognizes RQ module administrators as request template managers', () => {
    expect(templatePermissionFixSql).toMatch(
      /function app_private\.request_user_can_manage[\s\S]*?'RQ'\s*=\s*any\(coalesce\(app_user\.admin_modules/i,
    );
    expect(templatePermissionFixSql).toMatch(
      /app_user\.admin_sub_modules\s*->\s*'RQ'[\s\S]*?\/rq\/templates/i,
    );
  });

  it('allows authenticated RPC wrappers to execute the template manager guard', () => {
    expect(templatePermissionExecuteFixSql).toContain(
      'grant execute on function app_private.request_user_can_manage(uuid) to authenticated',
    );
  });

  it('restores publish as an invoker wrapper around the private command', () => {
    expect(templatePublishWrapperFixSql).toMatch(
      /create or replace function public\.publish_request_template_version[\s\S]*?language sql[\s\S]*?security invoker/i,
    );
    expect(templatePublishWrapperFixSql).toContain(
      'app_private.publish_request_template_version(',
    );
  });

  it('isolates each published workflow graph and preserves validated DOCX clones', () => {
    expect(publishSql).toContain('v_workflow_template_id := gen_random_uuid()');
    expect(publishSql).toContain('request_print_templates');
    expect(publishSql).toContain('validation_status = \'VALID\'');
  });

  it('adds a permission-guarded atomic request template duplicate command', () => {
    expect(templateDuplicateSql).toContain('app_private.duplicate_request_template');
    expect(templateDuplicateSql).toContain('public.duplicate_request_template');
    expect(templateDuplicateSql).toMatch(
      /request_user_can_manage\(v_actor\)[\s\S]*?REQUEST_TEMPLATE_FORBIDDEN/i,
    );
    expect(templateDuplicateSql).toContain("v_source_template.name || ' - Bản sao'");
    expect(templateDuplicateSql).toContain("'draftVersionId', v_target_version.id");
    expect(templateDuplicateSql).toContain(
      'grant execute on function public.duplicate_request_template(uuid) to authenticated',
    );
  });

  it('copies the complete request template configuration into an independent draft', () => {
    for (const snippet of [
      'insert into public.request_templates',
      'insert into public.request_template_versions',
      'v_source_version.form_schema',
      'v_source_version.usage_scope',
      'v_source_version.flow_mode',
      'v_source_version.completion_policy',
      'v_source_version.request_sla_hours',
      'v_source_version.print_config',
      'v_source_version.notification_config',
      'from public.request_approval_blocks',
      'from public.request_template_watchers',
      'from public.request_print_templates',
    ]) expect(templateDuplicateSql).toContain(snippet);
    expect(templateDuplicateSql).toMatch(
      /insert into public\.request_templates[\s\S]*?'DRAFT'[\s\S]*?returning \* into v_target_template/i,
    );
  });

  it('serializes source reads and copy-name allocation during duplication', () => {
    expect(templateDuplicateSql).toMatch(
      /select \* into v_source_template[\s\S]*?where id = p_request_template_id[\s\S]*?for update/i,
    );
    expect(templateDuplicateSql).toContain(
      'pg_advisory_xact_lock(hashtextextended(lower(v_base_name), 0))',
    );
  });

  it('lets published templates with DOCX metadata enter the same-lineage edit flow', () => {
    expect(templateDuplicateSql).toContain(
      'app_private.create_request_template_draft_from_published',
    );
    expect(templateDuplicateSql).not.toContain(
      'REQUEST_PRINT_TEMPLATE_CLONE_DOCX_UNSUPPORTED',
    );
    expect(templateDuplicateSql).toMatch(
      /create_request_template_draft_from_published[\s\S]*?insert into public\.request_print_templates[\s\S]*?from public\.request_print_templates/i,
    );
    expect(templateDuplicateSql).toContain("'draftVersionId', v_draft.id");
  });

  it('repairs publish validation so table fields are accepted', () => {
    expect(templateDuplicateSql).toContain(
      'app_private.publish_request_template_version',
    );
    expect(templateDuplicateSql).toMatch(
      /coalesce\(field ->> 'fieldType', ''\) not in \([\s\S]*?'table'[\s\S]*?\)/,
    );
  });

  it('submits through a private atomic command with sequence, snapshots and outbox', () => {
    expect(submitSql).toContain('app_private.next_request_code');
    expect(submitSql).toContain('create sequence if not exists app_private.request_code_sequence');
    expect(submitSql).toContain("nextval('app_private.request_code_sequence'::regclass)");
    expect(submitSql).toContain("'RQ-' || v_year::text || '-' || lpad(v_next::text, 6, '0')");
    expect(submitSql).toContain('app_private.resolve_request_block_approvers');
    expect(submitSql).toContain('app_private.request_command_idempotency');
    expect(submitSql).toContain('form_schema_snapshot');
    expect(submitSql).toContain('approval_config_snapshot');
    expect(submitSql).toContain('workflow_subjects');
    expect(submitSql).toContain('workflow_step_assignments');
    expect(submitSql).toContain('request_notification_outbox');
    expect(submitSql).toMatch(
      /create or replace function app_private\.submit_request[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    );
    expect(submitSql).toMatch(
      /create or replace function public\.submit_request[\s\S]*?security invoker[\s\S]*?set search_path = ''/i,
    );
  });

  it('exposes atomic actions with stale-state, idempotency and round guards', () => {
    expect(actionsSql).toContain('create or replace function app_private.act_on_request');
    expect(actionsSql).toContain('create or replace function public.act_on_request');
    expect(actionsSql).toContain('for update');
    expect(actionsSql).toContain('REQUEST_STALE_STATE');
    expect(actionsSql).toContain('REQUEST_ALREADY_PROCESSED');
    expect(actionsSql).toContain("'CANCELLED'");
    expect(actionsSql).toContain('assignment_round_id');
    expect(actionsSql).toContain('app_private.request_notification_outbox');
    expect(actionsSql).toContain('workflow_instance_logs');
    expect(actionsSql).toContain("'REASSIGNED'::public.workflow_instance_action");
    expect(actionsSql).toContain("case when v_flow_mode = 'PARALLEL' then null else v_block_key end");
    expect(actionsSql).toContain("coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'");
    expect(actionsSql).toContain('step_assignees = coalesce(step_assignees');
    expect(actionsSql).toContain('to_jsonb(v_pending_user_ids)');
    expect(actionsSql).toContain('current_assignee_user_ids = v_all_pending_user_ids');
    expect(actionsSql).toContain('v_all_pending_user_ids uuid[]');
    expect(actionsSql).toContain("'{assignmentRoundId}', to_jsonb(v_assignment_round)");
    expect(actionsSql).toContain("message = 'REQUEST_ASSIGNMENT_NOT_ACTIVE'");
  });

  it('exposes secure cursor, detail and summary query RPCs', () => {
    expect(querySql).toContain('public.list_request_instances');
    expect(querySql).toContain('public.get_request_detail');
    expect(querySql).toContain('public.get_request_summary');
    expect(querySql).toContain('security invoker');
    expect(querySql).toContain('request_instance_can_select');
    expect(querySql).toContain('(r.created_at, r.id) < (v_cursor_created_at, v_cursor_id)');
    expect(querySql).toContain("assignment.status = 'PENDING'");
    expect(querySql).toContain('due_at < now()');
    expect(querySql).toContain('canApprove');
    expect(querySql).toContain('canResubmit');
    expect(querySql).toContain('p_user_id is distinct from public.current_app_user_id()');
    expect(querySql).toMatch(
      /function app_private\.request_detail_payload\([\s\S]*?p_user_id uuid[\s\S]*?p_user_id is distinct from public\.current_app_user_id\(\)/i,
    );
    expect(querySql).toContain("REQUEST_QUERY_CURSOR_INVALID");
    expect(querySql).toMatch(
      /revoke all on function public\.list_request_instances\(jsonb, integer\)[\s\S]*?from public, anon/i,
    );
  });
});
