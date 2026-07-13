-- Phase 4 AI/Storage/KB/Analytics enforcement smoke.
-- Run transactionally after phase4_global_modules_enforcement.

begin;

do $$
begin
  if to_regprocedure('app_private.ai_has_action(text,uuid)') is null then
    raise exception 'Missing app_private.ai_has_action(text,uuid)';
  end if;
  if to_regprocedure('app_private.storage_has_action(text,uuid)') is null then
    raise exception 'Missing app_private.storage_has_action(text,uuid)';
  end if;
  if to_regprocedure('app_private.kb_has_action(text,uuid)') is null then
    raise exception 'Missing app_private.kb_has_action(text,uuid)';
  end if;
  if to_regprocedure('app_private.analytics_has_action(text,uuid)') is null then
    raise exception 'Missing app_private.analytics_has_action(text,uuid)';
  end if;
end $$;

create temp table phase4_global_smoke_ids (
  admin_id uuid not null,
  no_grant_id uuid not null,
  ai_user_id uuid not null,
  ai_report_viewer_id uuid not null,
  ai_report_generator_id uuid not null,
  kb_viewer_id uuid not null,
  kb_manager_id uuid not null,
  storage_viewer_id uuid not null,
  analytics_viewer_id uuid not null,
  analytics_exporter_id uuid not null,
  admin_email text not null,
  no_grant_email text not null,
  ai_user_email text not null,
  ai_report_viewer_email text not null,
  ai_report_generator_email text not null,
  kb_viewer_email text not null,
  kb_manager_email text not null,
  storage_viewer_email text not null,
  analytics_viewer_email text not null,
  analytics_exporter_email text not null,
  rag_doc_id uuid not null,
  rag_chunk_id uuid not null,
  ai_report_id uuid not null,
  ai_report_result_id uuid not null
) on commit drop;

grant select, insert, update, delete on table phase4_global_smoke_ids to authenticated;

insert into phase4_global_smoke_ids
values (
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'phase4-global-admin-smoke@vioo.local',
  'phase4-global-nogrant-smoke@vioo.local',
  'phase4-global-ai-user-smoke@vioo.local',
  'phase4-global-ai-report-viewer-smoke@vioo.local',
  'phase4-global-ai-report-generator-smoke@vioo.local',
  'phase4-global-kb-viewer-smoke@vioo.local',
  'phase4-global-kb-manager-smoke@vioo.local',
  'phase4-global-storage-viewer-smoke@vioo.local',
  'phase4-global-analytics-viewer-smoke@vioo.local',
  'phase4-global-analytics-exporter-smoke@vioo.local',
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select user_id, user_name, user_email, user_name, user_role::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase4_global_smoke_ids s
cross join lateral (
  values
    (s.admin_id, 'Phase 4 Global Admin', s.admin_email, 'ADMIN'),
    (s.no_grant_id, 'Phase 4 Global No Grant', s.no_grant_email, 'EMPLOYEE'),
    (s.ai_user_id, 'Phase 4 AI User', s.ai_user_email, 'EMPLOYEE'),
    (s.ai_report_viewer_id, 'Phase 4 AI Report Viewer', s.ai_report_viewer_email, 'EMPLOYEE'),
    (s.ai_report_generator_id, 'Phase 4 AI Report Generator', s.ai_report_generator_email, 'EMPLOYEE'),
    (s.kb_viewer_id, 'Phase 4 KB Viewer', s.kb_viewer_email, 'EMPLOYEE'),
    (s.kb_manager_id, 'Phase 4 KB Manager', s.kb_manager_email, 'EMPLOYEE'),
    (s.storage_viewer_id, 'Phase 4 Storage Viewer', s.storage_viewer_email, 'EMPLOYEE'),
    (s.analytics_viewer_id, 'Phase 4 Analytics Viewer', s.analytics_viewer_email, 'EMPLOYEE'),
    (s.analytics_exporter_id, 'Phase 4 Analytics Exporter', s.analytics_exporter_email, 'EMPLOYEE')
) as u(user_id, user_name, user_email, user_role);

set role authenticated;

create or replace function pg_temp.phase4_global_smoke_set_user(p_email text, p_sub uuid default gen_random_uuid())
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.email', p_email, true);
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('email', p_email, 'sub', p_sub::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

select pg_temp.phase4_global_smoke_set_user((select admin_email from phase4_global_smoke_ids));

select public.replace_user_permission_grants(
  (select ai_user_id from phase4_global_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'ai.assistant.use',
    'scope_type', 'global',
    'scope_id', '*',
    'is_active', true
  ))
);

select public.replace_user_permission_grants(
  (select ai_report_viewer_id from phase4_global_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'ai.report.view',
    'scope_type', 'global',
    'scope_id', '*',
    'is_active', true
  ))
);

select public.replace_user_permission_grants(
  (select ai_report_generator_id from phase4_global_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'ai.report.generate',
    'scope_type', 'global',
    'scope_id', '*',
    'is_active', true
  ))
);

select public.replace_user_permission_grants(
  (select kb_viewer_id from phase4_global_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'kb.view',
    'scope_type', 'global',
    'scope_id', '*',
    'is_active', true
  ))
);

select public.replace_user_permission_grants(
  (select kb_manager_id from phase4_global_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'kb.manage',
    'scope_type', 'global',
    'scope_id', '*',
    'is_active', true
  ))
);

select public.replace_user_permission_grants(
  (select storage_viewer_id from phase4_global_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'storage.view',
    'scope_type', 'global',
    'scope_id', '*',
    'is_active', true
  ))
);

select public.replace_user_permission_grants(
  (select analytics_viewer_id from phase4_global_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'analytics.view',
    'scope_type', 'global',
    'scope_id', '*',
    'is_active', true
  ))
);

select public.replace_user_permission_grants(
  (select analytics_exporter_id from phase4_global_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'analytics.export',
    'scope_type', 'global',
    'scope_id', '*',
    'is_active', true
  ))
);

select pg_temp.phase4_global_smoke_set_user((select no_grant_email from phase4_global_smoke_ids));

do $$
declare
  s phase4_global_smoke_ids%rowtype;
begin
  select * into s from phase4_global_smoke_ids;

  if app_private.ai_has_action('storage.view', s.ai_user_id) then
    raise exception 'ai_has_action accepted a non-ai permission';
  end if;
  if app_private.storage_has_action('kb.view', s.storage_viewer_id) then
    raise exception 'storage_has_action accepted a non-storage permission';
  end if;
  if app_private.kb_has_action('analytics.view', s.kb_viewer_id) then
    raise exception 'kb_has_action accepted a non-kb permission';
  end if;
  if app_private.analytics_has_action('ai.assistant.use', s.analytics_exporter_id) then
    raise exception 'analytics_has_action accepted a non-analytics permission';
  end if;

  if app_private.ai_has_action('ai.assistant.use', s.no_grant_id) then
    raise exception 'No-grant user unexpectedly has ai.assistant.use';
  end if;
  if not app_private.ai_has_action('ai.assistant.use', s.ai_user_id) then
    raise exception 'AI user missing ai.assistant.use';
  end if;
  if app_private.ai_has_action('ai.report.generate', s.ai_report_viewer_id) then
    raise exception 'ai.report.view unexpectedly implies ai.report.generate';
  end if;
  if not app_private.ai_has_action('ai.report.generate', s.ai_report_generator_id) then
    raise exception 'AI report generator missing ai.report.generate';
  end if;
  if app_private.kb_has_action('kb.manage', s.kb_viewer_id) then
    raise exception 'kb.view unexpectedly implies kb.manage';
  end if;
  if not app_private.storage_has_action('storage.view', s.storage_viewer_id) then
    raise exception 'Storage viewer missing storage.view';
  end if;
  if app_private.analytics_has_action('analytics.export', s.analytics_viewer_id) then
    raise exception 'analytics.view unexpectedly implies analytics.export';
  end if;
  if not app_private.analytics_has_action('analytics.export', s.analytics_exporter_id) then
    raise exception 'Analytics exporter missing analytics.export';
  end if;
end $$;

do $$
declare
  s phase4_global_smoke_ids%rowtype;
  v_count integer;
begin
  select * into s from phase4_global_smoke_ids;

  if to_regclass('public.rag_documents') is not null and to_regclass('public.rag_chunks') is not null then
    reset role;
    insert into public.rag_documents (id, title, source, file_name, file_type, file_size, storage_path, chunk_count, status, uploaded_by)
    values (s.rag_doc_id, 'Phase 4 KB Smoke', 'upload', 'phase4-kb-smoke.txt', 'txt', 10, 'docs/phase4-kb-smoke.txt', 1, 'ready', 'phase4');
    insert into public.rag_chunks (id, document_id, chunk_index, content)
    values (s.rag_chunk_id, s.rag_doc_id, 0, 'Phase 4 KB smoke content');
    set role authenticated;

    perform pg_temp.phase4_global_smoke_set_user(s.no_grant_email);
    select count(*) into v_count from public.rag_documents where id = s.rag_doc_id;
    if v_count <> 0 then
      raise exception 'No-grant user can read rag_documents';
    end if;

    begin
      insert into public.rag_documents (title, source, file_name, file_type, file_size, status, uploaded_by)
      values ('Phase 4 KB bad insert', 'upload', 'bad.txt', 'txt', 1, 'pending', 'phase4');
      raise exception 'No-grant user inserted rag_documents';
    exception
      when insufficient_privilege or check_violation or with_check_option_violation then
        null;
    end;

    perform pg_temp.phase4_global_smoke_set_user(s.kb_viewer_email);
    select count(*) into v_count from public.rag_documents where id = s.rag_doc_id;
    if v_count <> 1 then
      raise exception 'kb.view user cannot read rag_documents';
    end if;

    begin
      update public.rag_documents
      set status = 'pending'
      where id = s.rag_doc_id;
      if found then
        raise exception 'kb.view user updated rag_documents';
      end if;
    exception
      when insufficient_privilege or check_violation or with_check_option_violation then
        null;
    end;

    perform pg_temp.phase4_global_smoke_set_user(s.kb_manager_email);
    update public.rag_documents
    set status = 'processing'
    where id = s.rag_doc_id;
    if not found then
      raise exception 'kb.manage user could not update rag_documents';
    end if;
  end if;
end $$;

do $$
declare
  s phase4_global_smoke_ids%rowtype;
  v_count integer;
begin
  select * into s from phase4_global_smoke_ids;

  if to_regclass('public.ai_scheduled_reports') is not null and to_regclass('public.ai_report_results') is not null then
    reset role;
    insert into public.ai_scheduled_reports (id, name, description, type, frequency, is_active, created_by)
    values (s.ai_report_id, 'Phase 4 AI Report Smoke', 'Smoke', 'custom', 'daily', true, null);
    insert into public.ai_report_results (id, report_id, content, data, status)
    values (s.ai_report_result_id, s.ai_report_id, 'Smoke result', '{}'::jsonb, 'completed');
    set role authenticated;

    perform pg_temp.phase4_global_smoke_set_user(s.no_grant_email);
    select count(*) into v_count from public.ai_scheduled_reports where id = s.ai_report_id;
    if v_count <> 0 then
      raise exception 'No-grant user can read ai_scheduled_reports';
    end if;

    perform pg_temp.phase4_global_smoke_set_user(s.ai_report_viewer_email);
    select count(*) into v_count from public.ai_scheduled_reports where id = s.ai_report_id;
    if v_count <> 1 then
      raise exception 'ai.report.view user cannot read ai_scheduled_reports';
    end if;

    begin
      insert into public.ai_report_results (report_id, content, data, status)
      values (s.ai_report_id, 'bad generate', '{}'::jsonb, 'completed');
      raise exception 'ai.report.view user generated ai_report_results';
    exception
      when insufficient_privilege or check_violation or with_check_option_violation then
        null;
    end;

    perform pg_temp.phase4_global_smoke_set_user(s.ai_report_generator_email);
    insert into public.ai_report_results (report_id, content, data, status)
    values (s.ai_report_id, 'good generate', '{}'::jsonb, 'completed');
  end if;
end $$;

reset role;

rollback;
