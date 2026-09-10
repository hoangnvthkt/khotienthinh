-- Editable task content drafts and independently reported progress.
alter table public.work_tasks
  add column progress_percent integer not null default 0,
  add column result_draft_document jsonb not null default '{"version":1,"type":"doc","content":[]}'::jsonb,
  add column result_draft_text text not null default '',
  add column result_draft_updated_at timestamptz,
  add column result_draft_updated_by uuid references public.users(id) on delete restrict,
  add constraint work_tasks_progress_percent_check check (progress_percent between 0 and 100),
  add constraint work_tasks_result_draft_document_check check (
    jsonb_typeof(result_draft_document) = 'object'
    and result_draft_document ?& array['version', 'type', 'content']
  );

create index work_tasks_result_draft_updated_by_idx
  on public.work_tasks(result_draft_updated_by)
  where result_draft_updated_by is not null;

update public.work_tasks set progress_percent = 100 where status = 'completed';

create or replace function app_private.work_force_completed_progress()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'completed' then new.progress_percent := 100; end if;
  return new;
end $$;
revoke all on function app_private.work_force_completed_progress() from public, anon, authenticated;
create trigger work_tasks_force_completed_progress
before insert or update of status on public.work_tasks
for each row execute function app_private.work_force_completed_progress();

-- The editor never persists HTML. These helpers accept one bounded document
-- schema and derive searchable plain text inside the same command transaction.
create or replace function app_private.work_validate_inline_content(p_content jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare v_node jsonb; v_mark jsonb; v_text text := ''; v_href text;
begin
  if jsonb_typeof(p_content) is distinct from 'array'
    or jsonb_array_length(p_content) > 500 then
    raise exception 'WORK_INVALID_DOCUMENT' using errcode = '22023';
  end if;
  for v_node in select value from jsonb_array_elements(p_content) loop
    if jsonb_typeof(v_node) is distinct from 'object'
      or v_node->>'type' is distinct from 'text'
      or jsonb_typeof(v_node->'text') is distinct from 'string'
      or v_node - 'type' - 'text' - 'marks' <> '{}'::jsonb
      or char_length(v_node->>'text') > 30000
      or (v_node ? 'marks' and jsonb_typeof(v_node->'marks') is distinct from 'array')
      or jsonb_array_length(coalesce(v_node->'marks', '[]'::jsonb)) > 20 then
      raise exception 'WORK_INVALID_DOCUMENT' using errcode = '22023';
    end if;
    for v_mark in select value from jsonb_array_elements(coalesce(v_node->'marks', '[]'::jsonb)) loop
      if jsonb_typeof(v_mark) is distinct from 'object' then
        raise exception 'WORK_INVALID_DOCUMENT' using errcode = '22023';
      end if;
      if v_mark->>'type' = 'link' then
        v_href := v_mark->'attrs'->>'href';
        if v_mark - 'type' - 'attrs' <> '{}'::jsonb
          or jsonb_typeof(v_mark->'attrs') is distinct from 'object'
          or (v_mark->'attrs') - 'href' <> '{}'::jsonb
          or jsonb_typeof(v_mark->'attrs'->'href') is distinct from 'string'
          or char_length(v_href) not between 1 and 2048
          or v_href !~* '^(https?://|mailto:)' then
          raise exception 'WORK_INVALID_DOCUMENT' using errcode = '22023';
        end if;
      elsif coalesce(v_mark->>'type', '') not in ('bold', 'italic', 'underline', 'strike', 'code')
        or v_mark - 'type' <> '{}'::jsonb then
        raise exception 'WORK_INVALID_DOCUMENT' using errcode = '22023';
      end if;
    end loop;
    v_text := v_text || (v_node->>'text');
  end loop;
  return v_text;
end $$;
revoke all on function app_private.work_validate_inline_content(jsonb) from public, anon, authenticated, service_role;

create or replace function app_private.work_validate_document(p_document jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_block jsonb; v_item jsonb; v_type text; v_line text;
  v_parts text[] := '{}'; v_result text;
begin
  if jsonb_typeof(p_document) is distinct from 'object'
    or p_document->>'version' is distinct from '1'
    or p_document->>'type' is distinct from 'doc'
    or jsonb_typeof(p_document->'content') is distinct from 'array'
    or jsonb_array_length(p_document->'content') > 500
    or octet_length(p_document::text) > 120000
    or p_document - 'version' - 'type' - 'content' <> '{}'::jsonb then
    raise exception 'WORK_INVALID_DOCUMENT' using errcode = '22023';
  end if;
  for v_block in select value from jsonb_array_elements(p_document->'content') loop
    if jsonb_typeof(v_block) is distinct from 'object' then
      raise exception 'WORK_INVALID_DOCUMENT' using errcode = '22023';
    end if;
    v_type := v_block->>'type';
    if v_type in ('paragraph', 'blockquote', 'code_block') then
      if v_block - 'type' - 'content' <> '{}'::jsonb then
        raise exception 'WORK_INVALID_DOCUMENT' using errcode = '22023';
      end if;
      v_parts := array_append(v_parts, app_private.work_validate_inline_content(v_block->'content'));
    elsif v_type = 'heading' then
      if v_block - 'type' - 'level' - 'content' <> '{}'::jsonb
        or jsonb_typeof(v_block->'level') is distinct from 'number'
        or (v_block->>'level') not in ('1', '2') then
        raise exception 'WORK_INVALID_DOCUMENT' using errcode = '22023';
      end if;
      v_parts := array_append(v_parts, app_private.work_validate_inline_content(v_block->'content'));
    elsif v_type in ('bullet_list', 'ordered_list') then
      if v_block - 'type' - 'content' <> '{}'::jsonb
        or jsonb_typeof(v_block->'content') is distinct from 'array'
        or jsonb_array_length(v_block->'content') > 500 then
        raise exception 'WORK_INVALID_DOCUMENT' using errcode = '22023';
      end if;
      for v_item in select value from jsonb_array_elements(v_block->'content') loop
        if jsonb_typeof(v_item) is distinct from 'object'
          or v_item->>'type' is distinct from 'list_item'
          or v_item - 'type' - 'content' <> '{}'::jsonb then
          raise exception 'WORK_INVALID_DOCUMENT' using errcode = '22023';
        end if;
        v_line := app_private.work_validate_inline_content(v_item->'content');
        v_parts := array_append(v_parts, v_line);
      end loop;
    else
      raise exception 'WORK_INVALID_DOCUMENT' using errcode = '22023';
    end if;
  end loop;
  v_result := array_to_string(v_parts, E'\n');
  if char_length(v_result) > 30000 then
    raise exception 'WORK_INVALID_DOCUMENT' using errcode = '22023';
  end if;
  return v_result;
end $$;
revoke all on function app_private.work_validate_document(jsonb) from public, anon, authenticated;

create or replace function app_private.work_task_capabilities(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_task public.work_tasks%rowtype;
  v_assignment public.work_task_assignments%rowtype;
  v_active boolean; v_accepted boolean; v_assignable boolean; v_manager boolean;
  v_scope record;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  select * into strict v_task from public.work_tasks where id = p_task_id;
  select * into v_assignment from public.work_task_assignments
    where task_id = p_task_id and user_id = v_actor and ended_at is null;
  select * into strict v_scope from app_private.work_task_permission_scope(p_task_id);
  v_active := v_task.status not in ('completed', 'cancelled')
    and (v_scope.workspace_id is null or v_scope.workspace_status = 'active');
  v_accepted := v_assignment.id is not null and v_assignment.acknowledged_at is not null;
  v_assignable := app_private.has_permission(v_actor, 'work.task.assign_user', v_scope.scope_type, v_scope.scope_id);
  v_manager := app_private.has_permission(v_actor, 'work.task.manage_scope', v_scope.scope_type, v_scope.scope_id);
  return app_private.work_task_read_capabilities(p_task_id) || jsonb_build_object(
    'canAcknowledge', v_active and v_assignment.id is not null and v_assignment.acknowledged_at is null,
    'canRequestClarification', v_active and v_assignment.id is not null and v_assignment.acknowledged_at is null,
    'canStart', v_active and v_accepted and v_task.status in ('not_started', 'changes_requested'),
    'canBlock', v_active and v_accepted and v_task.status = 'in_progress',
    'canUnblock', v_active and v_accepted and v_task.status = 'blocked',
    'canSubmit', v_active and v_accepted and v_task.status in ('in_progress', 'changes_requested'),
    'canReview', v_active and v_task.status = 'awaiting_review' and v_task.reviewer_user_id = v_actor and (
      app_private.has_permission(v_actor, 'work.task.review', 'assigned', '*')
      or app_private.has_permission(v_actor, 'work.task.review', v_scope.scope_type, v_scope.scope_id)
    ),
    'canCancel', v_active and (v_task.created_by = v_actor or v_manager),
    'canTransfer', v_active and v_assignment.id is not null and v_assignable,
    'canAddAssignees', v_active and (v_task.created_by = v_actor or v_accepted or v_manager) and v_assignable,
    'canManageChecklist', v_active and v_task.status <> 'awaiting_review'
      and (v_task.created_by = v_actor or v_accepted or v_manager),
    'canComment', v_active and (v_task.created_by = v_actor or v_assignment.id is not null or v_manager
      or exists(select 1 from public.work_task_participants
        where task_id = v_task.id and user_id = v_actor and ended_at is null)),
    'canSetPreferences', v_active,
    'canAttachInput', app_private.work_attachment_can_mutate(v_task.id, v_actor, 'input'),
    'canAttachDiscussion', app_private.work_attachment_can_mutate(v_task.id, v_actor, 'discussion'),
    'canAttachResult', app_private.work_attachment_can_mutate(v_task.id, v_actor, 'result'),
    'canAttachEvidence', app_private.work_attachment_can_mutate(v_task.id, v_actor, 'evidence'),
    'canCreateChild', v_active and v_task.parent_task_id is null
      and app_private.has_permission(v_actor, 'work.task.create', v_scope.scope_type, v_scope.scope_id),
    'canManageSchedule', v_active and (v_task.created_by = v_actor or v_manager),
    'canManageWatchers', v_active and (v_task.created_by = v_actor or v_manager),
    'canUpdateDescription', v_active and v_task.status <> 'awaiting_review'
      and (v_task.created_by = v_actor or v_manager),
    'canUpdateResultDraft', v_active and v_accepted
      and v_task.status in ('in_progress', 'changes_requested'),
    'canUpdateProgress', v_active and v_accepted
      and v_task.status in ('in_progress', 'changes_requested')
  );
end $$;
revoke all on function app_private.work_task_capabilities(uuid) from public, anon, authenticated;

create or replace function app_private.work_command_content_progress(
  p_task_id uuid, p_command text, p_payload jsonb, p_idempotency_key uuid
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_task public.work_tasks%rowtype;
  v_prior app_private.work_command_idempotency%rowtype;
  v_caps jsonb; v_allowed text[]; v_expected bigint; v_text text; v_progress integer;
  v_hash text := md5(jsonb_build_object('taskId', p_task_id, 'command', p_command, 'payload', p_payload)::text);
  v_before jsonb; v_after jsonb; v_event_type text; v_event_id uuid; v_response jsonb;
begin
  if v_actor is null or not app_private.work_task_actor_can_view(p_task_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  v_allowed := case p_command
    when 'description_update' then array['content', 'expectedLockVersion']
    when 'result_draft_update' then array['content', 'expectedLockVersion']
    when 'progress_update' then array['progressPercent', 'expectedLockVersion']
  end;
  if v_allowed is null or p_idempotency_key is null
    or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload - v_allowed <> '{}'::jsonb
    or not (p_payload ?& v_allowed)
    or jsonb_typeof(p_payload->'expectedLockVersion') is distinct from 'number'
    or octet_length(p_payload::text) > 140000 then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  v_expected := (p_payload->>'expectedLockVersion')::bigint;
  insert into app_private.work_command_idempotency(actor_user_id, idempotency_key, command_name, request_hash)
    values(v_actor, p_idempotency_key, 'command_work_task_content', v_hash) on conflict do nothing;
  select * into strict v_prior from app_private.work_command_idempotency
    where actor_user_id = v_actor and idempotency_key = p_idempotency_key for update;
  if v_prior.command_name <> 'command_work_task_content' or v_prior.request_hash <> v_hash then
    raise exception 'WORK_IDEMPOTENCY_CONFLICT';
  end if;
  if v_prior.response_payload is not null then return v_prior.response_payload; end if;
  select * into strict v_task from public.work_tasks where id = p_task_id for update;
  if v_task.lock_version <> v_expected then raise exception 'WORK_VERSION_CONFLICT'; end if;
  if v_task.status in ('completed', 'cancelled') then raise exception 'WORK_TASK_TERMINAL'; end if;
  v_caps := app_private.work_task_capabilities(v_task.id);

  if p_command = 'description_update' then
    if not coalesce((v_caps->>'canUpdateDescription')::boolean, false) then
      raise exception 'WORK_COMMAND_DENIED' using errcode = '42501';
    end if;
    v_text := app_private.work_validate_document(p_payload->'content');
    if v_task.description_document is distinct from p_payload->'content' then
      v_before := jsonb_build_object('text', v_task.description_text);
      update public.work_tasks set description_document = p_payload->'content', description_text = v_text,
        lock_version = lock_version + 1, updated_at = now() where id = v_task.id returning * into v_task;
      v_after := jsonb_build_object('text', v_task.description_text);
      v_event_type := 'task.description_updated';
    end if;
    v_response := jsonb_build_object('taskId', v_task.id, 'taskLockVersion', v_task.lock_version,
      'content', jsonb_build_object('kind', 'description', 'document', v_task.description_document, 'text', v_task.description_text));
  elsif p_command = 'result_draft_update' then
    if not coalesce((v_caps->>'canUpdateResultDraft')::boolean, false) then
      raise exception 'WORK_COMMAND_DENIED' using errcode = '42501';
    end if;
    v_text := app_private.work_validate_document(p_payload->'content');
    if v_task.result_draft_document is distinct from p_payload->'content' then
      v_before := jsonb_build_object('text', v_task.result_draft_text);
      update public.work_tasks set result_draft_document = p_payload->'content', result_draft_text = v_text,
        result_draft_updated_at = now(), result_draft_updated_by = v_actor,
        lock_version = lock_version + 1, updated_at = now() where id = v_task.id returning * into v_task;
      v_after := jsonb_build_object('text', v_task.result_draft_text);
      v_event_type := 'task.result_draft_updated';
    end if;
    v_response := jsonb_build_object('taskId', v_task.id, 'taskLockVersion', v_task.lock_version,
      'content', jsonb_build_object('kind', 'result_draft', 'document', v_task.result_draft_document, 'text', v_task.result_draft_text));
  else
    if not coalesce((v_caps->>'canUpdateProgress')::boolean, false) then
      raise exception 'WORK_COMMAND_DENIED' using errcode = '42501';
    end if;
    if jsonb_typeof(p_payload->'progressPercent') is distinct from 'number'
      or (p_payload->>'progressPercent') !~ '^(0|[1-9][0-9]?|100)$' then
      raise exception 'WORK_INVALID_PROGRESS' using errcode = '22023';
    end if;
    v_progress := (p_payload->>'progressPercent')::integer;
    if v_task.progress_percent is distinct from v_progress then
      v_before := jsonb_build_object('progressPercent', v_task.progress_percent);
      update public.work_tasks set progress_percent = v_progress,
        lock_version = lock_version + 1, updated_at = now() where id = v_task.id returning * into v_task;
      v_after := jsonb_build_object('progressPercent', v_task.progress_percent);
      v_event_type := 'task.progress_updated';
    end if;
    v_response := jsonb_build_object('taskId', v_task.id, 'taskLockVersion', v_task.lock_version,
      'progressPercent', v_task.progress_percent);
  end if;

  if v_event_type is not null then
    insert into public.work_task_versions(task_id, version, snapshot, actor_user_id, idempotency_key)
      values(v_task.id, v_task.lock_version,
        jsonb_build_object('task', to_jsonb(v_task), 'change', jsonb_build_object('before', v_before, 'after', v_after)),
        v_actor, p_idempotency_key);
    insert into public.work_task_events(task_id, actor_user_id, event_type, payload, correlation_id, idempotency_key)
      values(v_task.id, v_actor, v_event_type, jsonb_build_object('before', v_before, 'after', v_after),
        p_idempotency_key, p_idempotency_key) returning id into v_event_id;
    insert into app_private.work_notification_outbox(event_id, task_id, event_type, payload)
      values(v_event_id, v_task.id, v_event_type, jsonb_build_object('taskId', v_task.id));
  end if;
  update app_private.work_command_idempotency set response_payload = v_response, completed_at = now()
    where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  return v_response;
end $$;
revoke all on function app_private.work_command_content_progress(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function app_private.work_command_content_progress(uuid, text, jsonb, uuid) to authenticated;

create or replace function public.command_work_task_collaboration(
  p_task_id uuid, p_command text, p_payload jsonb, p_idempotency_key uuid
)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform app_private.work_guard_task_command(p_task_id, true);
  if p_command in ('description_update', 'result_draft_update', 'progress_update') then
    return app_private.work_command_content_progress(p_task_id, p_command, p_payload, p_idempotency_key);
  end if;
  return app_private.work_command_collaboration(p_task_id, p_command, p_payload, p_idempotency_key);
end $$;

-- Enrich existing bounded list pages without duplicating their access/filter logic.
create or replace function app_private.work_page_with_progress(p_page jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_items jsonb;
begin
  select coalesce(jsonb_agg(item.value || jsonb_build_object('progress_percent', task.progress_percent)
    order by item.ordinality), '[]'::jsonb) into v_items
  from jsonb_array_elements(coalesce(p_page->'items', '[]'::jsonb)) with ordinality item(value, ordinality)
  join public.work_tasks task on task.id = (item.value->>'id')::uuid;
  return jsonb_set(p_page, '{items}', v_items, true);
end $$;
revoke all on function app_private.work_page_with_progress(jsonb) from public, anon, authenticated;
grant execute on function app_private.work_page_with_progress(jsonb) to authenticated;

create or replace function public.list_work_tasks(
  p_view text, p_filters jsonb default '{}', p_cursor jsonb default null, p_limit integer default 50
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.work_page_with_progress(app_private.work_list_tasks(p_view, p_filters, p_cursor, p_limit));
$$;

create or replace function public.list_work_workspace_tasks(
  p_workspace_id uuid, p_filters jsonb default '{}', p_cursor jsonb default null, p_limit integer default 30
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.work_page_with_progress(app_private.work_list_workspace_tasks(p_workspace_id, p_filters, p_cursor, p_limit));
$$;

create or replace function public.list_work_task_children(
  p_task_id uuid, p_cursor jsonb default null, p_limit integer default 30
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.work_page_with_progress(app_private.work_list_task_children(p_task_id, p_cursor, p_limit));
$$;
