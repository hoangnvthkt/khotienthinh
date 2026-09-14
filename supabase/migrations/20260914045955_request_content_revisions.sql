-- Request content revisions and creator-owned editing with approval restart.
create table app_private.request_feature_gates(
  gate text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  check(gate in ('discussion_read','discussion_write','attachments','content_edit'))
);
insert into app_private.request_feature_gates(gate) values
  ('discussion_read'),('discussion_write'),('attachments'),('content_edit');
revoke all on app_private.request_feature_gates from public,anon,authenticated;

create function app_private.request_feature_enabled(p_gate text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select enabled from app_private.request_feature_gates where gate=p_gate),false);
$$;
revoke all on function app_private.request_feature_enabled(text) from public,anon,authenticated;

alter table public.request_instances
  add column content_revision integer not null default 1
    check (content_revision > 0);

create table public.request_content_revisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.request_instances(id) on delete cascade,
  revision integer not null check (revision > 0),
  title text not null,
  description text not null default '',
  form_data jsonb not null default '{}'::jsonb check (jsonb_typeof(form_data) = 'object'),
  change_kind text not null check (change_kind in ('baseline','creator_edit')),
  changed_by uuid not null references public.users(id),
  command_key text,
  created_at timestamptz not null default now(),
  unique (request_id, revision)
);

create index request_content_revisions_request_cursor_idx
  on public.request_content_revisions(request_id, revision desc);

insert into public.request_content_revisions(
  request_id, revision, title, description, form_data, change_kind, changed_by, created_at
)
select id, 1, title, coalesce(description, ''), coalesce(form_data, '{}'::jsonb),
  'baseline', created_by, coalesce(submitted_at, created_at, now())
from public.request_instances;

alter table public.request_content_revisions enable row level security;
create policy request_content_revision_select
  on public.request_content_revisions for select to authenticated
  using (app_private.request_instance_can_select(request_id, public.current_app_user_id()));
revoke all on public.request_content_revisions from public, anon, authenticated;
grant select on public.request_content_revisions to authenticated;

create or replace function app_private.request_assignment_stamp_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_request_id uuid; v_revision integer;
begin
  if new.metadata ? 'requestId' then
    v_request_id := nullif(new.metadata ->> 'requestId', '')::uuid;
    select content_revision into v_revision
    from public.request_instances where id = v_request_id;
    if v_revision is not null then
      new.metadata := coalesce(new.metadata, '{}'::jsonb)
        || jsonb_build_object('contentRevision', v_revision);
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.request_assignment_stamp_revision() from public, anon, authenticated;

create trigger trg_request_assignment_stamp_revision
before insert on public.workflow_step_assignments
for each row execute function app_private.request_assignment_stamp_revision();

create function app_private.update_request_content(
  p_request_id uuid,
  p_title text,
  p_description text,
  p_form_data jsonb,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.request_instances%rowtype;
  v_subject public.workflow_subjects%rowtype;
  v_instance public.workflow_instances%rowtype;
  v_existing app_private.request_command_idempotency%rowtype;
  v_hash text;
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := coalesce(p_description, '');
  v_form_data jsonb := coalesce(p_form_data, '{}'::jsonb);
  v_round uuid;
  v_first_sort integer;
  v_block record;
  v_current_ids uuid[];
  v_dynamic_ids uuid[];
  v_blocks jsonb := '[]'::jsonb;
  v_response jsonb;
  v_cancelled_user uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.users u where u.id = v_actor
      and coalesce(u.is_active, true)
      and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
  ) then raise exception using errcode='42501', message='REQUEST_EDIT_FORBIDDEN'; end if;
  if p_request_id is null or nullif(p_idempotency_key, '') is null
    or p_expected_updated_at is null or v_title = ''
    or jsonb_typeof(v_form_data) <> 'object' then
    raise exception using errcode='22023', message='REQUEST_PAYLOAD_INVALID';
  end if;

  v_hash := encode(extensions.digest(jsonb_build_object(
    'requestId',p_request_id,'title',v_title,'description',v_description,
    'formData',v_form_data,'expectedUpdatedAt',p_expected_updated_at
  )::text,'sha256'),'hex');
  insert into app_private.request_command_idempotency(
    actor_id,idempotency_key,command_name,request_id,payload_hash
  ) values(v_actor,p_idempotency_key,'update_request_content',p_request_id,v_hash)
  on conflict(actor_id,idempotency_key) do nothing;
  select * into strict v_existing from app_private.request_command_idempotency
  where actor_id=v_actor and idempotency_key=p_idempotency_key for update;
  if v_existing.command_name <> 'update_request_content' or v_existing.payload_hash <> v_hash then
    raise exception using errcode='40001', message='REQUEST_IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.result is not null then return v_existing.result; end if;
  if not app_private.request_feature_enabled('content_edit') then
    raise exception using errcode='42501',message='REQUEST_FEATURE_DISABLED'; end if;

  select * into v_request from public.request_instances where id=p_request_id for update;
  if not found or v_request.created_by <> v_actor
    or not app_private.request_instance_can_select(p_request_id,v_actor) then
    raise exception using errcode='42501', message='REQUEST_EDIT_FORBIDDEN';
  end if;
  if v_request.status not in ('PENDING','RETURNED') then
    raise exception using errcode='22023', message='REQUEST_EDIT_STATUS_LOCKED';
  end if;
  if v_request.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='40001', message='REQUEST_STALE_STATE';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_request.form_schema_snapshot,'[]'::jsonb)) f
    where coalesce((f->>'required')::boolean,false)
      and (not (v_form_data ? (f->>'key')) or nullif(btrim(coalesce(v_form_data->>(f->>'key'),'')),'') is null)
  ) then raise exception using errcode='22023', message='REQUEST_REQUIRED_FIELD_MISSING'; end if;

  if v_title = btrim(v_request.title)
    and v_description = coalesce(v_request.description,'')
    and v_form_data = coalesce(v_request.form_data,'{}'::jsonb) then
    v_response := jsonb_build_object(
      'requestId',v_request.id,'requestCode',v_request.code,'status',v_request.status,
      'workflowInstanceId',v_request.workflow_instance_id,'workflowSubjectId',v_request.workflow_subject_id,
      'currentBlockKeys',app_private.request_action_current_blocks(v_request.id),
      'updatedAt',v_request.updated_at,'contentRevision',v_request.content_revision
    );
    update app_private.request_command_idempotency set result=v_response where id=v_existing.id;
    return v_response;
  end if;

  select * into strict v_subject from public.workflow_subjects
    where id=v_request.workflow_subject_id for update;
  select * into strict v_instance from public.workflow_instances
    where id=v_request.workflow_instance_id for update;
  perform 1 from public.workflow_step_assignments a
    where a.workflow_subject_id=v_request.workflow_subject_id order by a.id for update;

  -- Resolve every block before changing content. Any invalid approver aborts the edit.
  for v_block in
    select b.*, snapshot_block.value as snapshot
    from public.request_approval_blocks b
    join lateral jsonb_array_elements(coalesce(v_request.approval_config_snapshot->'blocks','[]'::jsonb)) snapshot_block(value)
      on snapshot_block.value->>'key'=b.block_key
    where b.request_template_version_id=v_request.request_template_version_id
    order by b.sort_order,b.block_key
  loop
    if v_block.approver_source='DYNAMIC_CREATOR_SELECT' then
      select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[]) into v_dynamic_ids
      from jsonb_array_elements_text(coalesce(v_block.snapshot->'resolvedUserIds','[]'::jsonb)) value;
    else v_dynamic_ids := '{}'::uuid[]; end if;
    v_current_ids := app_private.resolve_request_block_approvers(v_block.id,v_actor,v_dynamic_ids);
    v_blocks := v_blocks || jsonb_build_array(
      jsonb_set(v_block.snapshot,'{resolvedUserIds}',to_jsonb(v_current_ids),true)
    );
  end loop;
  if jsonb_array_length(v_blocks)=0 then
    raise exception using errcode='22023', message='REQUEST_EDIT_APPROVER_INVALID';
  end if;

  update public.request_instances set
    title=v_title,description=v_description,form_data=v_form_data,
    content_revision=content_revision+1,
    approval_config_snapshot=jsonb_set(
      jsonb_set(approval_config_snapshot,'{blocks}',v_blocks,true),
      '{contentRevision}',to_jsonb(content_revision+1),true
    ),
    updated_at=now()
  where id=p_request_id returning * into v_request;
  insert into public.request_content_revisions(
    request_id,revision,title,description,form_data,change_kind,changed_by,command_key
  ) values(v_request.id,v_request.content_revision,v_title,v_description,v_form_data,
    'creator_edit',v_actor,p_idempotency_key);
  update public.workflow_instances set title=v_title,updated_at=now() where id=v_instance.id;

  if v_request.status='PENDING' then
    for v_cancelled_user in
      select distinct assignee_user_id from public.workflow_step_assignments
      where workflow_subject_id=v_subject.id and status='PENDING' and assignee_user_id is not null
    loop
      insert into app_private.request_notification_outbox(event_key,request_id,recipient_user_id,event_type,payload)
      values('request:'||v_request.id||':REVISION_CANCELLED:'||v_request.content_revision||':'||v_cancelled_user,
        v_request.id,v_cancelled_user,'REQUEST_APPROVAL_RESTARTED',
        jsonb_build_object('requestId',v_request.id,'requestCode',v_request.code,'contentRevision',v_request.content_revision))
      on conflict(event_key) do nothing;
    end loop;
    perform app_private.close_request_pending_assignments(v_request.id,'CANCELLED',null,null,'REQUEST_CONTENT_REVISED');
    v_round := gen_random_uuid();
    update public.request_instances set approval_config_snapshot=jsonb_set(
      approval_config_snapshot-'returnedBlockKey','{assignmentRoundId}',to_jsonb(v_round),true
    ) where id=v_request.id returning * into v_request;
    update public.workflow_subjects set status='RUNNING',current_assignee_user_id=null,
      current_assignee_user_ids='{}'::uuid[],updated_at=now() where id=v_subject.id;
    update public.workflow_instances set status='RUNNING'::public.workflow_instance_status,
      step_assignees='{}'::jsonb,updated_at=now() where id=v_instance.id;
    select min(sort_order) into v_first_sort from public.request_approval_blocks
      where request_template_version_id=v_request.request_template_version_id;
    for v_block in select * from public.request_approval_blocks
      where request_template_version_id=v_request.request_template_version_id
        and ((v_request.approval_config_snapshot->>'flowMode')='PARALLEL' or sort_order=v_first_sort)
      order by sort_order,block_key
    loop perform app_private.activate_request_block(v_request.id,v_block.block_key,v_round,v_actor); end loop;
    insert into public.workflow_instance_logs(instance_id,node_id,action,acted_by,comment)
      values(v_instance.id,coalesce(v_subject.current_node_id,v_instance.current_node_id),
        'REOPENED'::public.workflow_instance_action,v_actor,'REQUEST_CONTENT_REVISED');
  else
    select min(sort_order) into v_first_sort from public.request_approval_blocks
      where request_template_version_id=v_request.request_template_version_id;
    update public.request_instances r set approval_config_snapshot=jsonb_set(
      r.approval_config_snapshot,'{returnedBlockKey}',to_jsonb((select block_key from public.request_approval_blocks
        where request_template_version_id=r.request_template_version_id and sort_order=v_first_sort
        order by block_key limit 1)),true
    ) where r.id=v_request.id returning * into v_request;
  end if;

  select * into v_request from public.request_instances where id=p_request_id;
  v_response := jsonb_build_object(
    'requestId',v_request.id,'requestCode',v_request.code,'status',v_request.status,
    'workflowInstanceId',v_request.workflow_instance_id,'workflowSubjectId',v_request.workflow_subject_id,
    'currentBlockKeys',app_private.request_action_current_blocks(v_request.id),
    'updatedAt',v_request.updated_at,'contentRevision',v_request.content_revision
  );
  update app_private.request_command_idempotency set result=v_response where id=v_existing.id;
  return v_response;
exception when sqlstate '22023' then
  if sqlerrm like 'REQUEST_%' then raise; end if;
  raise exception using errcode='22023',message='REQUEST_EDIT_APPROVER_INVALID';
end $$;
revoke all on function app_private.update_request_content(uuid,text,text,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function app_private.update_request_content(uuid,text,text,jsonb,timestamptz,text) to authenticated;

create function public.update_request_content(
  p_request_id uuid,p_title text,p_description text,p_form_data jsonb,
  p_expected_updated_at timestamptz,p_idempotency_key text
) returns jsonb language sql security invoker set search_path='' as $$
  select app_private.update_request_content(p_request_id,p_title,p_description,p_form_data,p_expected_updated_at,p_idempotency_key);
$$;
revoke all on function public.update_request_content(uuid,text,text,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function public.update_request_content(uuid,text,text,jsonb,timestamptz,text) to authenticated;

-- Preserve the validated phase-1 payload and layer revision capabilities on top.
alter function app_private.request_detail_payload(uuid,uuid) rename to request_detail_payload_base;
revoke all on function app_private.request_detail_payload_base(uuid,uuid) from public,anon,authenticated;

create function app_private.request_detail_payload(p_request_id uuid,p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when base.payload is null then null else
    base.payload || jsonb_build_object(
      'contentRevision',r.content_revision,
      'currentRoundId',nullif(r.approval_config_snapshot->>'assignmentRoundId',''),
      'approvalBlocks',coalesce((
        select jsonb_agg(
          (block.value - 'status' - 'assignments') || jsonb_build_object(
            'status',case
              when exists(select 1 from jsonb_array_elements(coalesce(block.value->'assignments','[]')) a
                where a->>'roundId'=r.approval_config_snapshot->>'assignmentRoundId' and a->>'status'='PENDING') then 'ACTIVE'
              when exists(select 1 from jsonb_array_elements(coalesce(block.value->'assignments','[]')) a
                where a->>'roundId'=r.approval_config_snapshot->>'assignmentRoundId' and a->>'status'='RETURNED') then 'RETURNED'
              when exists(select 1 from jsonb_array_elements(coalesce(block.value->'assignments','[]')) a
                where a->>'roundId'=r.approval_config_snapshot->>'assignmentRoundId' and a->>'status' in ('APPROVED','REJECTED')) then 'COMPLETED'
              when exists(select 1 from jsonb_array_elements(coalesce(block.value->'assignments','[]')) a
                where a->>'roundId'=r.approval_config_snapshot->>'assignmentRoundId' and a->>'status' in ('CANCELLED','SKIPPED')) then 'CANCELLED'
              else 'NOT_ACTIVE' end,
            'assignments',coalesce((select jsonb_agg(
              assignment.value || jsonb_build_object(
                'contentRevision',coalesce((select (wa.metadata->>'contentRevision')::integer
                  from public.workflow_step_assignments wa where wa.id=(assignment.value->>'id')::uuid),1),
                'isCurrentRound',assignment.value->>'roundId'=r.approval_config_snapshot->>'assignmentRoundId'
              ) order by assignment.ordinality)
              from jsonb_array_elements(coalesce(block.value->'assignments','[]')) with ordinality assignment(value,ordinality)),'[]')
          ) order by block.ordinality
        ) from jsonb_array_elements(coalesce(base.payload->'approvalBlocks','[]')) with ordinality block(value,ordinality)
      ),'[]'),
      'capabilities',(base.payload->'capabilities') || jsonb_build_object(
        'canEditContent',app_private.request_feature_enabled('content_edit')
          and r.created_by=p_user_id and r.status in ('PENDING','RETURNED')
          and exists(select 1 from public.users u where u.id=p_user_id and coalesce(u.is_active,true)
            and coalesce(u.account_status,'ACTIVE')='ACTIVE'),
        'canReadDiscussion',app_private.request_feature_enabled('discussion_read')
          and app_private.request_instance_can_select(r.id,p_user_id),
        'canComment',app_private.request_feature_enabled('discussion_write')
          and app_private.request_instance_can_select(r.id,p_user_id),
        'canAttach',app_private.request_feature_enabled('attachments')
          and app_private.request_instance_can_select(r.id,p_user_id)
      )
    ) end
  from public.request_instances r
  cross join lateral (select app_private.request_detail_payload_base(p_request_id,p_user_id) payload) base
  where r.id=p_request_id;
$$;
revoke all on function app_private.request_detail_payload(uuid,uuid) from public,anon;
grant execute on function app_private.request_detail_payload(uuid,uuid) to authenticated;
