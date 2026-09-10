-- WS4: make Workspace membership the mandatory server boundary for tasks and
-- every task-owned resource. Existing direct and not-yet-cut-over legacy scopes
-- preserve their R1A behavior.

alter table public.work_tasks drop constraint work_tasks_scope_shape_check;
alter table public.work_tasks add constraint work_tasks_scope_shape_check check (
  (scope_type='direct' and department_id is null and project_id is null and workspace_id is null)
  or (scope_type='department' and department_id is not null and project_id is null)
  or (scope_type='project' and project_id is not null and department_id is null)
  or (scope_type='workspace' and workspace_id is not null and department_id is null and project_id is null)
);

create index if not exists work_tasks_workspace_cursor_idx
  on public.work_tasks(workspace_id,updated_at desc,id desc)
  where workspace_id is not null;

create table public.work_workspace_user_revisions (
  user_id uuid primary key references public.users(id) on delete cascade,
  revision bigint not null default 1 check(revision>0),
  updated_at timestamptz not null default now()
);
alter table public.work_workspace_user_revisions enable row level security;
revoke all on public.work_workspace_user_revisions from public,anon,authenticated;
grant select on public.work_workspace_user_revisions to authenticated;
create policy work_workspace_user_revision_own_select
  on public.work_workspace_user_revisions for select to authenticated
  using(user_id=public.current_app_user_id());

insert into public.work_workspace_user_revisions(user_id)
select distinct user_id from public.work_workspace_members
on conflict(user_id) do nothing;

create or replace function app_private.work_workspace_bump_user_revision()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_old uuid; v_new uuid;
begin
  if tg_op<>'INSERT' then v_old:=old.user_id; end if;
  if tg_op<>'DELETE' then v_new:=new.user_id; end if;
  if v_old is not null then
    insert into public.work_workspace_user_revisions(user_id) values(v_old)
    on conflict(user_id) do update set revision=work_workspace_user_revisions.revision+1,updated_at=now();
  end if;
  if v_new is not null and v_new is distinct from v_old then
    insert into public.work_workspace_user_revisions(user_id) values(v_new)
    on conflict(user_id) do update set revision=work_workspace_user_revisions.revision+1,updated_at=now();
  elsif v_new is not null and tg_op='INSERT' then
    insert into public.work_workspace_user_revisions(user_id) values(v_new)
    on conflict(user_id) do update set revision=work_workspace_user_revisions.revision+1,updated_at=now();
  end if;
  return coalesce(new,old);
end $$;
revoke all on function app_private.work_workspace_bump_user_revision() from public,anon,authenticated;
create trigger work_workspace_members_bump_user_revision
after insert or update or delete on public.work_workspace_members
for each row execute function app_private.work_workspace_bump_user_revision();

create or replace function app_private.work_workspace_bump_all_revisions()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.name is distinct from old.name or new.status is distinct from old.status
    or new.icon_key is distinct from old.icon_key or new.color_key is distinct from old.color_key
    or new.cover_key is distinct from old.cover_key or new.access_mode is distinct from old.access_mode then
    insert into public.work_workspace_user_revisions(user_id)
    select distinct m.user_id from public.work_workspace_members m where m.workspace_id=new.id
    on conflict(user_id) do update set revision=work_workspace_user_revisions.revision+1,updated_at=now();
  end if;
  return new;
end $$;
revoke all on function app_private.work_workspace_bump_all_revisions() from public,anon,authenticated;
create trigger work_workspaces_bump_user_revisions after update on public.work_workspaces
for each row execute function app_private.work_workspace_bump_all_revisions();
alter publication supabase_realtime add table public.work_workspace_user_revisions;

create or replace function app_private.work_workspace_for_physical_scope(
  p_scope_type text,p_department_id uuid,p_project_id text
)
returns uuid language sql stable security definer set search_path='' as $$
  select w.id from public.work_workspaces w
  where w.access_mode='workspace' and (
    (p_scope_type='department' and w.kind='department' and w.department_id=p_department_id)
    or (p_scope_type='project' and w.kind='project' and w.project_id=p_project_id)
  ) limit 1
$$;
revoke all on function app_private.work_workspace_for_physical_scope(text,uuid,text) from public,anon,authenticated;

create or replace function app_private.work_task_workspace_id(p_task_id uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select case when w.access_mode='workspace' then w.id end
  from public.work_tasks t
  left join public.work_workspaces w on w.id=coalesce(t.workspace_id,
    app_private.work_workspace_for_physical_scope(t.scope_type,t.department_id,t.project_id))
  where t.id=p_task_id
$$;
revoke all on function app_private.work_task_workspace_id(uuid) from public,anon,authenticated;

create or replace function app_private.work_resolve_workspace_scope(p_scope jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_type text; v_workspace uuid; v_department uuid; v_project text; w public.work_workspaces%rowtype;
begin
  if jsonb_typeof(p_scope) is distinct from 'object' then
    raise exception 'WORK_INVALID_SCOPE' using errcode='22023';
  end if;
  v_type:=p_scope->>'type';
  begin
    if v_type='direct' and p_scope='{"type":"direct"}'::jsonb then return p_scope; end if;
    if v_type='workspace' and p_scope-array['type','workspaceId']='{}'::jsonb
       and nullif(p_scope->>'workspaceId','') is not null then
      v_workspace:=(p_scope->>'workspaceId')::uuid;
      select * into w from public.work_workspaces where id=v_workspace and access_mode='workspace';
      if w.id is null or app_private.work_workspace_member_role(w.id,public.current_app_user_id()) is null then
        raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode='42501';
      end if;
      return case w.kind
        when 'department' then jsonb_build_object('type','department','departmentId',w.department_id,'workspaceId',w.id)
        when 'project' then jsonb_build_object('type','project','projectId',w.project_id,'workspaceId',w.id)
        else jsonb_build_object('type','workspace','workspaceId',w.id) end;
    end if;
    if v_type='department' and p_scope-array['type','departmentId']='{}'::jsonb
       and nullif(p_scope->>'departmentId','') is not null then
      v_department:=(p_scope->>'departmentId')::uuid;
      if not exists(select 1 from public.org_units where id=v_department) then raise exception 'WORK_INVALID_SCOPE' using errcode='22023'; end if;
      v_workspace:=app_private.work_workspace_for_physical_scope('department',v_department,null);
      if v_workspace is not null then
        if app_private.work_workspace_member_role(v_workspace,public.current_app_user_id()) is null then raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode='42501'; end if;
        return p_scope||jsonb_build_object('workspaceId',v_workspace);
      end if;
      return p_scope;
    end if;
    if v_type='project' and p_scope-array['type','projectId']='{}'::jsonb
       and nullif(p_scope->>'projectId','') is not null then
      v_project:=p_scope->>'projectId';
      if not exists(select 1 from public.projects where id=v_project) then raise exception 'WORK_INVALID_SCOPE' using errcode='22023'; end if;
      v_workspace:=app_private.work_workspace_for_physical_scope('project',null,v_project);
      if v_workspace is not null then
        if app_private.work_workspace_member_role(v_workspace,public.current_app_user_id()) is null then raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode='42501'; end if;
        return p_scope||jsonb_build_object('workspaceId',v_workspace);
      end if;
      return p_scope;
    end if;
  exception when invalid_text_representation then
    raise exception 'WORK_INVALID_SCOPE' using errcode='22023';
  end;
  raise exception 'WORK_INVALID_SCOPE' using errcode='22023';
end $$;
revoke all on function app_private.work_resolve_workspace_scope(jsonb) from public,anon,authenticated;

create or replace function app_private.has_permission(
  p_user_id uuid,p_permission_code text,p_scope_type text default 'global',p_scope_id text default '*'
)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid; v_status text;
begin
  if p_permission_code like 'work.task.%' then
    begin
      if p_scope_type='work_workspace' then v_workspace:=p_scope_id::uuid;
      elsif p_scope_type='workspace' then v_workspace:=coalesce(nullif(p_scope_id,'*')::uuid,
        nullif(current_setting('app.work_workspace_id',true),'')::uuid);
      elsif p_scope_type='department' then
        v_workspace:=app_private.work_workspace_for_physical_scope('department',p_scope_id::uuid,null);
      elsif p_scope_type='project' then
        v_workspace:=app_private.work_workspace_for_physical_scope('project',null,p_scope_id);
      end if;
    exception when invalid_text_representation then return false; end;
    if v_workspace is not null then
      if app_private.work_workspace_member_role(v_workspace,p_user_id) is null then return false; end if;
      select status into v_status from public.work_workspaces where id=v_workspace;
      if v_status='archived' and p_permission_code not in (
        'work.task.view_scope','work.task.view_related','work.task.view_restricted','work.task.audit_view'
      ) then return false; end if;
      return exists(select 1 from app_private.resolve_effective_permission_sources(
        p_user_id,p_permission_code,'work_workspace',v_workspace::text,now()
      ) s where upper(s.source_type)<>'LEGACY');
    end if;
  end if;
  return exists(select 1 from app_private.resolve_effective_permission_sources(
    p_user_id,p_permission_code,p_scope_type,p_scope_id,now()
  ) s where p_permission_code not like 'work.%' or upper(s.source_type)<>'LEGACY');
end $$;

create or replace function app_private.work_assert_create_scope(p_scope jsonb)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=public.current_app_user_id(); v_scope jsonb; v_ctx text; v_id text; v_workspace uuid; v_status text;
begin
  if v_actor is null or not app_private.has_permission(v_actor,'work.module.access','global','*') then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
  v_scope:=app_private.work_resolve_workspace_scope(p_scope);
  v_workspace:=(v_scope->>'workspaceId')::uuid;
  perform set_config('app.work_workspace_id',coalesce(v_workspace::text,''),true);
  v_ctx:=case when v_workspace is not null then 'work_workspace' when v_scope->>'type'='direct' then 'own' else v_scope->>'type' end;
  v_id:=coalesce(v_workspace::text,v_scope->>'departmentId',v_scope->>'projectId','*');
  if v_workspace is not null then
    select status into v_status from public.work_workspaces where id=v_workspace;
    if v_status<>'active' then raise exception 'WORK_WORKSPACE_ARCHIVED' using errcode='42501'; end if;
  end if;
  if not app_private.has_permission(v_actor,'work.task.create',v_ctx,v_id) then raise exception 'WORK_CREATE_DENIED' using errcode='42501'; end if;
  return v_actor;
end $$;
revoke all on function app_private.work_assert_create_scope(jsonb) from public,anon,authenticated;

create or replace function app_private.work_tasks_attach_workspace()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_workspace uuid; w public.work_workspaces%rowtype; v_actor uuid:=public.current_app_user_id();
begin
  if tg_op='UPDATE' and old.workspace_id is not null and new.workspace_id is distinct from old.workspace_id then
    raise exception 'WORK_TASK_WORKSPACE_IMMUTABLE' using errcode='23514';
  end if;
  v_workspace:=coalesce(new.workspace_id,
    nullif(current_setting('app.work_workspace_id',true),'')::uuid,
    app_private.work_workspace_for_physical_scope(new.scope_type,new.department_id,new.project_id));
  if v_workspace is null then return new; end if;
  select * into w from public.work_workspaces where id=v_workspace for update;
  if w.id is null then raise exception 'WORK_INVALID_SCOPE' using errcode='23514'; end if;
  if tg_op='INSERT' and w.status<>'active' then raise exception 'WORK_WORKSPACE_ARCHIVED' using errcode='42501'; end if;
  if v_actor is not null and app_private.work_workspace_member_role(w.id,v_actor) is null then raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode='42501'; end if;
  new.workspace_id:=w.id;
  if w.kind='department' then new.scope_type:='department';new.department_id:=w.department_id;new.project_id:=null;
  elsif w.kind='project' then new.scope_type:='project';new.project_id:=w.project_id;new.department_id:=null;
  else new.scope_type:='workspace';new.department_id:=null;new.project_id:=null;
  end if;
  return new;
exception when invalid_text_representation then raise exception 'WORK_INVALID_SCOPE' using errcode='23514';
end $$;
revoke all on function app_private.work_tasks_attach_workspace() from public,anon,authenticated;
create trigger work_tasks_attach_workspace before insert or update of workspace_id,scope_type,department_id,project_id
on public.work_tasks for each row execute function app_private.work_tasks_attach_workspace();

create or replace function app_private.validate_work_task_group_scope()
returns trigger language plpgsql set search_path='' as $$
declare v_group public.work_task_groups%rowtype; v_group_workspace uuid; v_task_workspace uuid;
begin
  if new.task_group_id is null then return new; end if;
  select * into v_group from public.work_task_groups where id=new.task_group_id;
  v_group_workspace:=coalesce(v_group.workspace_id,
    app_private.work_workspace_for_physical_scope(v_group.scope_type,v_group.department_id,v_group.project_id));
  v_task_workspace:=coalesce(new.workspace_id,
    app_private.work_workspace_for_physical_scope(new.scope_type,new.department_id,new.project_id));
  if v_group.id is null or v_group.scope_type<>new.scope_type
    or v_group.department_id is distinct from new.department_id
    or v_group.project_id is distinct from new.project_id
    or v_group_workspace is distinct from v_task_workspace then
    raise exception 'WORK_TASK_GROUP_SCOPE_MISMATCH' using errcode='23514';
  end if;
  return new;
end $$;

-- Serialize every Workspace-owned mutation with membership/profile commands.
-- Membership commands already lock the Workspace row first, so a writer that
-- waited for a removal must re-check membership after acquiring the same lock.
create or replace function app_private.work_lock_task_workspace(
  p_task_id uuid,p_actor_id uuid,p_require_active boolean default true
)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid; v_status text;
begin
  v_workspace:=app_private.work_task_workspace_id(p_task_id);
  if v_workspace is null then return null; end if;
  select status into v_status from public.work_workspaces where id=v_workspace for update;
  if not found then raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode='42501'; end if;
  if p_require_active and v_status<>'active' then raise exception 'WORK_WORKSPACE_ARCHIVED' using errcode='42501'; end if;
  if p_actor_id is not null and app_private.work_workspace_member_role(v_workspace,p_actor_id) is null then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501';
  end if;
  return v_workspace;
end $$;
revoke all on function app_private.work_lock_task_workspace(uuid,uuid,boolean) from public,anon,authenticated;

create or replace function app_private.work_workspace_task_mutation_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_task uuid; v_actor uuid;
begin
  if auth.role()='service_role' then return coalesce(new,old); end if;
  v_actor:=public.current_app_user_id();
  if v_actor is null then return coalesce(new,old); end if;
  if tg_table_name='work_tasks' then v_task:=coalesce(new.id,old.id);
  else v_task:=coalesce(new.task_id,old.task_id); end if;
  perform app_private.work_lock_task_workspace(v_task,v_actor,true);
  return coalesce(new,old);
end $$;
revoke all on function app_private.work_workspace_task_mutation_guard() from public,anon,authenticated;
create trigger work_workspace_task_update_guard before update on public.work_tasks
for each row execute function app_private.work_workspace_task_mutation_guard();
create trigger work_workspace_assignment_mutation_guard before insert or update or delete on public.work_task_assignments
for each row execute function app_private.work_workspace_task_mutation_guard();
create trigger work_workspace_participant_mutation_guard before insert or update or delete on public.work_task_participants
for each row execute function app_private.work_workspace_task_mutation_guard();
create trigger work_workspace_recipient_mutation_guard before insert or update or delete on public.work_task_recipient_members
for each row execute function app_private.work_workspace_task_mutation_guard();
create trigger work_workspace_checklist_mutation_guard before insert or update or delete on public.work_task_checklist_items
for each row execute function app_private.work_workspace_task_mutation_guard();
create trigger work_workspace_comment_mutation_guard before insert or update or delete on public.work_task_comments
for each row execute function app_private.work_workspace_task_mutation_guard();
create trigger work_workspace_mention_mutation_guard before insert or update or delete on public.work_task_mentions
for each row execute function app_private.work_workspace_task_mutation_guard();
create trigger work_workspace_attachment_mutation_guard before insert or update or delete on public.work_task_attachments
for each row execute function app_private.work_workspace_task_mutation_guard();
create or replace function app_private.work_workspace_attachment_worker_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.role()='service_role' and new.status='ready' then
    perform app_private.work_lock_task_workspace(new.task_id,null,true);
    if not app_private.work_attachment_can_mutate(new.task_id,new.uploader_user_id,new.attachment_kind) then
      raise exception 'WORK_ATTACHMENT_ACCESS_REVOKED' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.work_workspace_attachment_worker_guard() from public,anon,authenticated;
create trigger work_workspace_attachment_worker_guard before update on public.work_task_attachments
for each row execute function app_private.work_workspace_attachment_worker_guard();
create trigger work_workspace_submission_mutation_guard before insert or update or delete on public.work_task_submissions
for each row execute function app_private.work_workspace_task_mutation_guard();
create trigger work_workspace_pin_mutation_guard before insert or update or delete on public.work_task_pins
for each row execute function app_private.work_workspace_task_mutation_guard();
create trigger work_workspace_notification_preference_mutation_guard before insert or update or delete on public.work_task_notification_preferences
for each row execute function app_private.work_workspace_task_mutation_guard();

create or replace function app_private.work_workspace_open_assignment_count(p_workspace_id uuid,p_user_id uuid)
returns integer language sql stable security definer set search_path='' as $$
  select count(*)::integer from public.work_task_assignments a join public.work_tasks t on t.id=a.task_id
  where app_private.work_task_workspace_id(t.id)=p_workspace_id and a.user_id=p_user_id
    and a.ended_at is null and t.status not in('completed','cancelled')
$$;
create or replace function app_private.work_workspace_open_review_count(p_workspace_id uuid,p_user_id uuid)
returns integer language sql stable security definer set search_path='' as $$
  select count(distinct x.task_id)::integer from(
    select t.id task_id from public.work_tasks t where app_private.work_task_workspace_id(t.id)=p_workspace_id
      and t.reviewer_user_id=p_user_id and t.status not in('completed','cancelled')
    union all
    select t.id from public.work_task_participants p join public.work_tasks t on t.id=p.task_id
      where app_private.work_task_workspace_id(t.id)=p_workspace_id and p.user_id=p_user_id
        and p.participant_role='reviewer' and p.ended_at is null and t.status not in('completed','cancelled')
  )x
$$;

create or replace function app_private.work_workspace_archive_task_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='archived' and old.status is distinct from new.status and exists(
    select 1 from public.work_tasks t where app_private.work_task_workspace_id(t.id)=new.id
      and t.status not in('completed','cancelled')
  ) then raise exception 'WORK_WORKSPACE_OPEN_TASKS' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function app_private.work_workspace_archive_task_guard() from public,anon,authenticated;
create trigger work_workspace_archive_task_guard before update of status on public.work_workspaces
for each row execute function app_private.work_workspace_archive_task_guard();

create or replace function app_private.work_guard_task_command(p_task_id uuid,p_require_active boolean)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=public.current_app_user_id(); v_workspace uuid;
begin
  if v_actor is null then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  perform 1 from public.work_tasks where id=p_task_id for update;
  if not found then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  v_workspace:=app_private.work_lock_task_workspace(p_task_id,v_actor,p_require_active);
  if not app_private.work_task_user_can_view(p_task_id,v_actor) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501';
  end if;
  return v_workspace;
end $$;
revoke all on function app_private.work_guard_task_command(uuid,boolean) from public,anon,authenticated;
grant execute on function app_private.work_guard_task_command(uuid,boolean) to authenticated;

create or replace function public.command_work_task(
  p_task_id uuid,p_command text,p_payload jsonb,p_expected_lock_version bigint,p_idempotency_key uuid
)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
begin
  perform app_private.work_guard_task_command(p_task_id,true);
  return app_private.work_command_task(p_task_id,p_command,p_payload,p_expected_lock_version,p_idempotency_key);
end $$;

create or replace function public.command_work_task_collaboration(
  p_task_id uuid,p_command text,p_payload jsonb,p_idempotency_key uuid
)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
begin
  perform app_private.work_guard_task_command(p_task_id,true);
  return app_private.work_command_collaboration(p_task_id,p_command,p_payload,p_idempotency_key);
end $$;

create or replace function app_private.work_attachment_task_id(p_attachment_id uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select task_id from public.work_task_attachments where id=p_attachment_id
$$;
revoke all on function app_private.work_attachment_task_id(uuid) from public,anon,authenticated;
grant execute on function app_private.work_attachment_task_id(uuid) to authenticated;

create or replace function public.command_work_attachment(p_command text,p_payload jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v_task uuid; v_result jsonb; v_workspace uuid; v_revision bigint;
begin
  if p_command='begin' then v_task:=(p_payload->>'taskId')::uuid;
  else v_task:=app_private.work_attachment_task_id((p_payload->>'attachmentId')::uuid); end if;
  v_workspace:=app_private.work_guard_task_command(v_task,p_command<>'read');
  v_result:=app_private.work_command_attachment(p_command,p_payload,p_idempotency_key);
  if p_command='read' then
    if v_workspace is not null then
      select revision into v_revision from public.work_workspace_user_revisions
        where user_id=public.current_app_user_id();
      v_result:=v_result||jsonb_build_object('workspaceId',v_workspace,'accessRevision',coalesce(v_revision,0));
    end if;
  end if;
  return v_result;
end $$;

create or replace function app_private.work_task_user_can_view(p_task_id uuid,p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare t public.work_tasks%rowtype; v_workspace uuid; v_creator boolean; v_assignee boolean; v_participant boolean;
  v_related boolean; v_scope boolean; v_restricted boolean; v_ctx text; v_id text;
begin
  if p_user_id is null or not exists(select 1 from public.users where id=p_user_id and is_active and account_status='ACTIVE')
    or not app_private.has_permission(p_user_id,'work.module.access','global','*') then return false; end if;
  select * into t from public.work_tasks where id=p_task_id;
  if t.id is null then return false; end if;
  v_workspace:=app_private.work_task_workspace_id(t.id);
  if v_workspace is not null and app_private.work_workspace_member_role(v_workspace,p_user_id) is null then return false; end if;
  v_creator:=t.created_by=p_user_id;
  v_assignee:=exists(select 1 from public.work_task_assignments a where a.task_id=t.id and a.user_id=p_user_id);
  v_participant:=exists(select 1 from public.work_task_participants p where p.task_id=t.id and p.user_id=p_user_id and p.ended_at is null);
  v_ctx:=case when v_workspace is not null then 'work_workspace' when t.scope_type='direct' then 'global' else t.scope_type end;
  v_id:=coalesce(v_workspace::text,t.department_id::text,t.project_id,'*');
  v_related:=(v_creator and app_private.has_permission(p_user_id,'work.task.view_related','own','*'))
    or ((v_assignee or v_participant) and app_private.has_permission(p_user_id,'work.task.view_related','assigned','*'))
    or (v_workspace is null and t.scope_type='direct' and (v_creator or v_assignee or v_participant)
      and app_private.has_permission(p_user_id,'work.task.view_related','global','*'))
    or ((v_creator or v_assignee or v_participant) and v_workspace is null and t.scope_type in('department','project')
      and app_private.has_permission(p_user_id,'work.task.view_related',t.scope_type,v_id))
    or (v_workspace is not null and (v_creator or v_assignee or v_participant)
      and app_private.has_permission(p_user_id,'work.task.view_related',v_ctx,v_id));
  v_scope:=app_private.has_permission(p_user_id,'work.task.view_scope',v_ctx,v_id);
  v_restricted:=t.privacy='standard' or v_creator or v_assignee or v_participant
    or app_private.has_permission(p_user_id,'work.task.view_restricted',v_ctx,v_id);
  return (v_related or v_scope) and v_restricted;
end $$;
revoke all on function app_private.work_task_user_can_view(uuid,uuid) from public,anon,authenticated;

create or replace function app_private.work_task_permission_scope(p_task_id uuid)
returns table(scope_type text,scope_id text,workspace_id uuid,workspace_status text)
language sql stable security definer set search_path='' as $$
  select case when w.id is not null then 'work_workspace' when t.scope_type='direct' then 'global' else t.scope_type end,
    coalesce(w.id::text,t.department_id::text,t.project_id,'*'),w.id,w.status
  from public.work_tasks t left join public.work_workspaces w on w.id=app_private.work_task_workspace_id(t.id)
  where t.id=p_task_id
$$;
revoke all on function app_private.work_task_permission_scope(uuid) from public,anon,authenticated;

create or replace function app_private.work_task_actor_can_audit(p_task_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=public.current_app_user_id(); t public.work_tasks%rowtype; s record;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then return false; end if;
  select * into strict t from public.work_tasks where id=p_task_id;
  select * into strict s from app_private.work_task_permission_scope(p_task_id);
  return app_private.has_permission(v_actor,'work.task.audit_view',s.scope_type,s.scope_id)
    or (t.created_by=v_actor and app_private.has_permission(v_actor,'work.task.audit_view','own','*'))
    or (app_private.has_permission(v_actor,'work.task.audit_view','assigned','*') and (
      exists(select 1 from public.work_task_assignments where task_id=t.id and user_id=v_actor)
      or exists(select 1 from public.work_task_participants where task_id=t.id and user_id=v_actor and ended_at is null)));
end $$;
revoke all on function app_private.work_task_actor_can_audit(uuid) from public,anon,authenticated;
grant execute on function app_private.work_task_actor_can_audit(uuid) to authenticated;

create or replace function app_private.work_task_read_capabilities(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s record;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  select * into strict s from app_private.work_task_permission_scope(p_task_id);
  return jsonb_build_object('canClone',(s.workspace_id is null or s.workspace_status='active')
    and app_private.has_permission(public.current_app_user_id(),'work.task.create',s.scope_type,s.scope_id),
    'canViewHistory',app_private.work_task_actor_can_audit(p_task_id));
end $$;

create or replace function app_private.work_attachment_can_mutate(p_task_id uuid,p_user_id uuid,p_kind text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare t public.work_tasks%rowtype; s record;
begin
  if not app_private.work_task_user_can_view(p_task_id,p_user_id) then return false; end if;
  select * into t from public.work_tasks where id=p_task_id;
  select * into s from app_private.work_task_permission_scope(p_task_id);
  return t.id is not null and (s.workspace_id is null or s.workspace_status='active')
    and t.status not in('completed','cancelled') and (p_kind in('discussion','evidence') or t.status<>'awaiting_review')
    and (t.created_by=p_user_id or app_private.has_permission(p_user_id,'work.task.manage_scope',s.scope_type,s.scope_id)
      or exists(select 1 from public.work_task_assignments a where a.task_id=t.id and a.user_id=p_user_id and a.ended_at is null and (p_kind in('discussion','evidence') or a.acknowledged_at is not null))
      or (p_kind in('discussion','evidence') and exists(select 1 from public.work_task_participants p where p.task_id=t.id and p.user_id=p_user_id and p.ended_at is null)));
end $$;
revoke all on function app_private.work_attachment_can_mutate(uuid,uuid,text) from public,anon,authenticated;

create or replace function app_private.work_task_capabilities(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid:=public.current_app_user_id(); t public.work_tasks%rowtype; mine public.work_task_assignments%rowtype;
  active boolean; accepted boolean; assignable boolean; manager boolean; s record;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  select * into strict t from public.work_tasks where id=p_task_id;
  select * into mine from public.work_task_assignments where task_id=p_task_id and user_id=a and ended_at is null;
  select * into strict s from app_private.work_task_permission_scope(p_task_id);
  active:=t.status not in('completed','cancelled') and (s.workspace_id is null or s.workspace_status='active');
  accepted:=mine.id is not null and mine.acknowledged_at is not null;
  assignable:=app_private.has_permission(a,'work.task.assign_user',s.scope_type,s.scope_id);
  manager:=app_private.has_permission(a,'work.task.manage_scope',s.scope_type,s.scope_id);
  return app_private.work_task_read_capabilities(p_task_id)||jsonb_build_object(
    'canAcknowledge',active and mine.id is not null and mine.acknowledged_at is null,
    'canRequestClarification',active and mine.id is not null and mine.acknowledged_at is null,
    'canStart',active and accepted and t.status in('not_started','changes_requested'),
    'canBlock',active and accepted and t.status='in_progress',
    'canUnblock',active and accepted and t.status='blocked',
    'canSubmit',active and accepted and t.status in('in_progress','changes_requested'),
    'canReview',active and t.status='awaiting_review' and t.reviewer_user_id=a and (
      app_private.has_permission(a,'work.task.review','assigned','*')
      or app_private.has_permission(a,'work.task.review',s.scope_type,s.scope_id)),
    'canCancel',active and (t.created_by=a or manager),
    'canTransfer',active and mine.id is not null and assignable,
    'canAddAssignees',active and (t.created_by=a or accepted or manager) and assignable,
    'canManageChecklist',active and t.status<>'awaiting_review' and (t.created_by=a or accepted or manager),
    'canComment',active and (t.created_by=a or mine.id is not null or manager
      or exists(select 1 from public.work_task_participants where task_id=t.id and user_id=a and ended_at is null)),
    'canSetPreferences',active,
    'canAttachInput',app_private.work_attachment_can_mutate(t.id,a,'input'),
    'canAttachDiscussion',app_private.work_attachment_can_mutate(t.id,a,'discussion'),
    'canAttachResult',app_private.work_attachment_can_mutate(t.id,a,'result'),
    'canAttachEvidence',app_private.work_attachment_can_mutate(t.id,a,'evidence'));
end $$;
revoke all on function app_private.work_task_capabilities(uuid) from public,anon,authenticated;

create or replace function app_private.work_assert_assignment_recipient(p_task_id uuid,p_user_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
declare t public.work_tasks%rowtype; s record; related boolean;
begin
  select * into strict t from public.work_tasks where id=p_task_id;
  select * into strict s from app_private.work_task_permission_scope(p_task_id);
  if p_user_id is null or not exists(select 1 from public.users where id=p_user_id and is_active and account_status='ACTIVE')
    or (s.workspace_id is not null and app_private.work_workspace_member_role(s.workspace_id,p_user_id) is null)
    or not app_private.has_permission(p_user_id,'work.module.access','global','*')
    or not (app_private.has_permission(p_user_id,'work.task.view_related','assigned','*')
      or app_private.has_permission(p_user_id,'work.task.view_related',s.scope_type,s.scope_id)
      or app_private.has_permission(p_user_id,'work.task.view_scope',s.scope_type,s.scope_id)
      or (t.created_by=p_user_id and app_private.has_permission(p_user_id,'work.task.view_related','own','*'))) then
    raise exception 'WORK_RECIPIENT_INELIGIBLE' using errcode='42501';
  end if;
  related:=t.created_by=p_user_id or exists(select 1 from public.work_task_assignments where task_id=t.id and user_id=p_user_id)
    or exists(select 1 from public.work_task_participants where task_id=t.id and user_id=p_user_id and ended_at is null);
  if t.privacy='restricted' and not related and not app_private.has_permission(p_user_id,'work.task.view_restricted',s.scope_type,s.scope_id) then
    raise exception 'WORK_RESTRICTED_RECIPIENT_DENIED' using errcode='42501';
  end if;
end $$;
revoke all on function app_private.work_assert_assignment_recipient(uuid,uuid) from public,anon,authenticated;

create or replace function app_private.work_workspace_recipient_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_task uuid; v_user uuid; v_workspace uuid;
begin
  v_task:=new.task_id;
  if tg_table_name='work_task_recipient_members' then v_user:=new.user_id;
  elsif tg_table_name='work_task_assignments' then v_user:=new.user_id;
  elsif tg_table_name='work_task_participants' then v_user:=new.user_id;
  elsif tg_table_name='work_task_mentions' then v_user:=new.mentioned_user_id;
  else return new; end if;
  v_workspace:=app_private.work_task_workspace_id(v_task);
  if v_workspace is not null and app_private.work_workspace_member_role(v_workspace,v_user) is null then
    raise exception 'WORK_RECIPIENT_INELIGIBLE' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function app_private.work_workspace_recipient_guard() from public,anon,authenticated;
create trigger work_recipient_members_workspace_guard before insert or update of user_id on public.work_task_recipient_members
for each row execute function app_private.work_workspace_recipient_guard();
create trigger work_assignments_workspace_guard before insert or update of user_id on public.work_task_assignments
for each row execute function app_private.work_workspace_recipient_guard();
create trigger work_participants_workspace_guard before insert or update of user_id on public.work_task_participants
for each row execute function app_private.work_workspace_recipient_guard();
create trigger work_mentions_workspace_guard before insert or update of mentioned_user_id on public.work_task_mentions
for each row execute function app_private.work_workspace_recipient_guard();

create or replace function app_private.work_preview_recipients(p_sources jsonb,p_scope jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a uuid:=app_private.work_assert_create_scope(p_scope); v_scope jsonb:=app_private.work_resolve_workspace_scope(p_scope);
  s text:=v_scope->>'type'; k text:=coalesce(v_scope->>'workspaceId',v_scope->>'departmentId',v_scope->>'projectId','*');
  v_workspace uuid:=(v_scope->>'workspaceId')::uuid; sources jsonb; valid jsonb; invalid jsonb; result jsonb;
begin
  if jsonb_typeof(p_sources) is distinct from 'array' then raise exception 'WORK_INVALID_RECIPIENT_SOURCES' using errcode='22023'; end if;
  if jsonb_array_length(p_sources)>100 or exists(select 1 from jsonb_array_elements(p_sources) x
    where jsonb_typeof(x)<>'object' or coalesce(x->>'type','') not in('user','work_group')
      or nullif(btrim(x->>'id'),'') is null or length(x->>'id')>200) then raise exception 'WORK_INVALID_RECIPIENT_SOURCES' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_sources) x where x->>'type'='user')
    and not app_private.has_permission(a,'work.task.assign_user',case when v_workspace is not null then 'work_workspace' when s='direct' then 'own' else s end,k) then
    raise exception 'WORK_ASSIGN_USER_DENIED' using errcode='42501'; end if;
  if exists(select 1 from jsonb_array_elements(p_sources) x where x->>'type'='work_group')
    and not app_private.has_permission(a,'work.task.assign_group',case when v_workspace is not null then 'work_workspace' when s='direct' then 'own' else s end,k) then
    raise exception 'WORK_ASSIGN_GROUP_DENIED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(x order by x->>'type',x->>'id'),'[]') into sources
  from(select distinct jsonb_build_object('type',x->>'type','id',x->>'id') x from jsonb_array_elements(p_sources) x)q;
  with src as(select x->>'type' type,x->>'id' id from jsonb_array_elements(sources)x), expanded as(
    select src.type,src.id,src.id user_id,null::text reason from src where type='user'
    union all select src.type,src.id,m.user_id,case when g.id is null then 'GROUP_NOT_FOUND' when not g.is_active then 'GROUP_INACTIVE' when m.id is null then 'NO_ACTIVE_MEMBERS' end
    from src left join public.work_groups g on g.id::text=src.id left join public.work_group_members m on m.group_id=g.id and m.is_active and g.is_active where src.type='work_group'
  ),resolved as(
    select e.*,u.name,coalesce(e.reason,case when u.id is null then 'NO_APP_ACCOUNT' when not u.is_active then 'INACTIVE_USER'
      when u.account_status<>'ACTIVE' then 'ACCOUNT_NOT_ACTIVE' when not app_private.has_permission(u.id,'work.module.access','global','*') then 'NO_MODULE_ACCESS'
      when v_workspace is not null and app_private.work_workspace_member_role(v_workspace,u.id) is null then 'NOT_WORKSPACE_MEMBER' end) exclusion
    from expanded e left join public.users u on e.user_id=u.id::text
  ),grouped as(select user_id,max(name) name,exclusion,jsonb_agg(jsonb_build_object('type',type,'id',id) order by type,id) sources from resolved group by user_id,exclusion)
  select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'name',name,'sources',grouped.sources) order by user_id)filter(where exclusion is null),'[]'),
    coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'reason',exclusion,'sources',grouped.sources) order by user_id,exclusion)filter(where exclusion is not null),'[]')
  into valid,invalid from grouped;
  if jsonb_array_length(valid)>500 or jsonb_array_length(invalid)>1000 then raise exception 'WORK_RECIPIENT_LIMIT' using errcode='22023'; end if;
  result:=jsonb_build_object('sources',sources,'validRecipients',valid,'invalidRecipients',invalid,'validCount',jsonb_array_length(valid),'invalidCount',jsonb_array_length(invalid));
  return result||jsonb_build_object('fingerprint',md5(jsonb_build_object('scope',v_scope,'preview',result)::text));
end $$;
revoke all on function app_private.work_preview_recipients(jsonb,jsonb) from public,anon,authenticated;
grant execute on function app_private.work_preview_recipients(jsonb,jsonb) to authenticated;

create or replace function app_private.work_list_workspace_tasks(p_workspace_id uuid,p_filters jsonb,p_cursor jsonb,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=public.current_app_user_id(); v_n integer:=coalesce(p_limit,30); v_at timestamptz; v_id uuid; v_rows jsonb;
begin
  perform app_private.work_workspace_assert_member(p_workspace_id,v_actor);
  if v_n not between 1 and 50 or jsonb_typeof(p_filters) is distinct from 'object'
    or p_filters-array['status','priority','taskGroupId','assigneeUserId','deadlineFrom','deadlineTo','search']<>'{}'::jsonb
    or (p_filters?'status' and jsonb_typeof(p_filters->'status')<>'array')
    or (p_filters?'priority' and jsonb_typeof(p_filters->'priority')<>'array')
    or length(coalesce(p_filters->>'search',''))>100 then raise exception 'WORK_INVALID_FILTER' using errcode='22023'; end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) is distinct from 'object' or p_cursor-array['sortAt','id']<>'{}'::jsonb then raise exception 'WORK_INVALID_CURSOR' using errcode='22023'; end if;
    begin v_at:=(p_cursor->>'sortAt')::timestamptz;v_id:=(p_cursor->>'id')::uuid;
      if v_at is null or v_id is null or not isfinite(v_at) then raise exception 'WORK_INVALID_CURSOR' using errcode='22023'; end if;
    exception when invalid_text_representation or datetime_field_overflow then raise exception 'WORK_INVALID_CURSOR' using errcode='22023'; end;
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.id desc),'[]') into v_rows from(
    select t.id,t.task_code,t.title,t.status,t.priority,t.privacy,t.scope_type,t.department_id,t.project_id,
      p_workspace_id workspace_id,t.task_group_id,t.deadline_at,t.created_by,t.reviewer_user_id,t.updated_at,t.lock_version,
      (select count(*) from public.work_task_assignments a where a.task_id=t.id and (a.ended_at is null or a.state in('completed','cancelled'))) assignment_count,
      (select count(*) from public.work_task_assignments a where a.task_id=t.id and (a.ended_at is null or a.state in('completed','cancelled')) and a.acknowledged_at is not null) acknowledged_count
    from public.work_tasks t join public.work_workspaces w on w.id=p_workspace_id
    where (t.workspace_id=p_workspace_id or (t.workspace_id is null and ((w.kind='department' and t.department_id=w.department_id) or (w.kind='project' and t.project_id=w.project_id))))
      and (v_at is null or (t.updated_at,t.id)<(v_at,v_id))
      and (not p_filters?'status' or t.status in(select jsonb_array_elements_text(p_filters->'status')))
      and (not p_filters?'priority' or t.priority in(select jsonb_array_elements_text(p_filters->'priority')))
      and (not p_filters?'taskGroupId' or t.task_group_id=(p_filters->>'taskGroupId')::uuid)
      and (not p_filters?'assigneeUserId' or exists(select 1 from public.work_task_assignments fa
        where fa.task_id=t.id and fa.user_id=(p_filters->>'assigneeUserId')::uuid
          and (fa.ended_at is null or fa.state in('completed','cancelled'))))
      and (not p_filters?'deadlineFrom' or t.deadline_at>=(p_filters->>'deadlineFrom')::timestamptz)
      and (not p_filters?'deadlineTo' or t.deadline_at<=(p_filters->>'deadlineTo')::timestamptz)
      and (nullif(btrim(p_filters->>'search'),'') is null or t.task_code=p_filters->>'search'
        or to_tsvector('simple',coalesce(t.title,'')||' '||coalesce(t.description_text,''))@@plainto_tsquery('simple',p_filters->>'search'))
      and app_private.work_task_actor_can_view(t.id)
    order by t.updated_at desc,t.id desc limit v_n+1
  )q;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(v_rows)with ordinality where ordinality<=v_n),
    'nextCursor',case when jsonb_array_length(v_rows)>v_n then jsonb_build_object('sortAt',v_rows->(v_n-1)->'updated_at','id',v_rows->(v_n-1)->'id') else null end);
end $$;
revoke all on function app_private.work_list_workspace_tasks(uuid,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function app_private.work_list_workspace_tasks(uuid,jsonb,jsonb,integer) to authenticated;
create or replace function public.list_work_workspace_tasks(p_workspace_id uuid,p_filters jsonb default '{}',p_cursor jsonb default null,p_limit integer default 30)
returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.work_list_workspace_tasks(p_workspace_id,p_filters,p_cursor,p_limit) $$;
revoke all on function public.list_work_workspace_tasks(uuid,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.list_work_workspace_tasks(uuid,jsonb,jsonb,integer) to authenticated;

create or replace function app_private.work_workspace_summary(p_workspace_id uuid,p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w public.work_workspaces%rowtype; v_role text; v_pinned boolean; v_source text; v_member_count integer;
  v_open integer; v_actions integer; v_can_view boolean;
begin
  select * into w from public.work_workspaces where id=p_workspace_id;
  v_role:=app_private.work_workspace_member_role(p_workspace_id,p_actor_id);
  if w.id is null or v_role is null then raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode='42501'; end if;
  v_can_view:=app_private.has_permission(p_actor_id,'work.module.access','global','*');
  if not v_can_view then raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode='42501'; end if;
  select pinned into v_pinned from public.work_workspace_preferences where user_id=p_actor_id and workspace_id=p_workspace_id;
  v_source:=app_private.work_workspace_source_name(w.kind,w.department_id,w.project_id);
  select count(*)::integer into v_member_count from public.work_workspace_members m join public.users u on u.id=m.user_id
    where m.workspace_id=p_workspace_id and m.status='active' and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now())
      and u.is_active and u.account_status='ACTIVE';
  select count(*)::integer into v_open from public.work_tasks t
    where (t.workspace_id=p_workspace_id or (t.workspace_id is null and ((w.kind='department' and t.department_id=w.department_id) or (w.kind='project' and t.project_id=w.project_id))))
      and t.status not in('completed','cancelled') and app_private.work_task_user_can_view(t.id,p_actor_id);
  select count(distinct t.id)::integer into v_actions from public.work_tasks t
    where (t.workspace_id=p_workspace_id or (t.workspace_id is null and ((w.kind='department' and t.department_id=w.department_id) or (w.kind='project' and t.project_id=w.project_id))))
      and app_private.work_task_user_can_view(t.id,p_actor_id) and (
        exists(select 1 from public.work_task_assignments a where a.task_id=t.id and a.user_id=p_actor_id and a.ended_at is null and a.state not in('completed','cancelled','transferred'))
        or (t.reviewer_user_id=p_actor_id and t.status='awaiting_review'));
  return jsonb_build_object('id',w.id,'name',w.name,'kind',w.kind,'status',w.status,'sourceName',v_source,
    'iconKey',w.icon_key,'colorKey',w.color_key,'coverKey',w.cover_key,'pinned',coalesce(v_pinned,false),
    'memberCount',v_member_count,'visibleOpenTaskCount',v_open,'myActionCount',v_actions,
    'capabilities',jsonb_build_object('canView',v_can_view,
      'canCreateTask',w.status='active' and app_private.has_permission(p_actor_id,'work.task.create','work_workspace',w.id::text),
      'canManageMembers',w.status='active' and v_role='admin' and app_private.has_permission(p_actor_id,'work.workspace.manage_members','work_workspace',w.id::text),
      'canConfigure',w.status='active' and v_role='admin' and app_private.has_permission(p_actor_id,'work.task.configure','work_workspace',w.id::text),
      'canArchive',v_role='admin' and app_private.has_permission(p_actor_id,'work.workspace.archive','work_workspace',w.id::text)),
    'lockVersion',w.lock_version);
end $$;
revoke all on function app_private.work_workspace_summary(uuid,uuid) from public,anon,authenticated;

-- Delivery eligibility is re-evaluated at processing time. In particular, a
-- reviewer who left a Workspace is suppressed before any private payload or URL
-- is created, and collaboration tasks use the canonical Workspace scope.
create or replace function app_private.work_notification_mandatory(p_event_id uuid,p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare e public.work_task_events%rowtype; t public.work_tasks%rowtype; a public.work_task_assignments%rowtype;
  v_related boolean; v_mandatory boolean:=false; v_target boolean; s record;
begin
  select * into e from public.work_task_events where id=p_event_id;
  if e.id is null or not app_private.work_task_user_can_view(e.task_id,p_user_id) then return null; end if;
  select * into strict t from public.work_tasks where id=e.task_id;
  select * into strict s from app_private.work_task_permission_scope(t.id);
  if s.workspace_id is not null and s.workspace_status<>'active' then return null; end if;
  select * into a from public.work_task_assignments where task_id=t.id and user_id=p_user_id
    and (ended_at is null or (t.status='completed' and state='completed') or (t.status='cancelled' and state='cancelled'));
  v_related:=t.created_by=p_user_id or a.id is not null
    or exists(select 1 from public.work_task_participants where task_id=t.id and user_id=p_user_id and ended_at is null)
    or (e.event_type='assignment.transferred' and e.actor_user_id=p_user_id);
  if e.event_type='comment.mentioned' then
    if not coalesce(e.payload->'recipientUserIds'@>jsonb_build_array(p_user_id),false) then return null; end if;
    return true;
  elsif e.event_type='assignment.ack_overdue' then
    if not exists(select 1 from public.work_task_assignments x where x.id=(e.payload->>'assignmentId')::uuid and x.task_id=t.id
      and x.ended_at is null and x.acknowledged_at is null and x.acknowledgement_due_at=(e.payload->>'dueAt')::timestamptz and x.acknowledgement_due_at<=now()) then return null; end if;
    v_target:=p_user_id=(e.payload->>'userId')::uuid;
    if not(v_target or t.created_by=p_user_id or coalesce(p_user_id=app_private.resolve_strict_direct_manager((e.payload->>'userId')::uuid),false)) then return null; end if;
    return true;
  elsif e.event_type in('task.deadline_soon','task.overdue') then
    if t.status in('completed','cancelled') or t.deadline_at is distinct from (e.payload->>'dueAt')::timestamptz
      or (e.event_type='task.deadline_soon' and t.deadline_at<=now()) then return null; end if;
    if t.created_by<>p_user_id and a.id is null then return null; end if;
    return true;
  end if;
  if not v_related then return null; end if;
  if e.event_type in('comment.created','comment.edited')
    and coalesce(e.payload->'after'->'mentionedUserIds'@>jsonb_build_array(p_user_id),false) then return null; end if;
  v_mandatory:=(e.event_type='task.created' and a.id is not null and a.ended_at is null and a.acknowledged_at is null)
    or (e.event_type='assignment.transferred' and e.payload->>'toUserId'=p_user_id::text and a.id is not null and a.ended_at is null and a.acknowledged_at is null)
    or (e.event_type='assignment.co_assignees_added' and coalesce(e.payload->'userIds'@>jsonb_build_array(p_user_id),false) and a.id is not null and a.ended_at is null and a.acknowledged_at is null)
    or (e.event_type='task.review_submitted' and t.status='awaiting_review' and t.reviewer_user_id=p_user_id
      and (app_private.has_permission(p_user_id,'work.task.review','assigned','*')
        or app_private.has_permission(p_user_id,'work.task.review',s.scope_type,s.scope_id)))
    or (e.event_type='task.changes_requested' and a.id is not null and a.acknowledged_at is not null and t.status='changes_requested')
    or e.event_type like 'security.%';
  v_mandatory:=coalesce(v_mandatory,false);
  if e.actor_user_id=p_user_id and not v_mandatory then return null; end if;
  return v_mandatory;
end $$;
revoke all on function app_private.work_notification_mandatory(uuid,uuid) from public,anon,authenticated;

create or replace function app_private.work_workspace_notification_insert_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_task uuid; v_user uuid; v_workspace uuid; v_status text;
begin
  if new.work_delivery_id is null then return new; end if;
  begin v_task:=new.entity_id::uuid; v_user:=new.user_id::uuid;
  exception when invalid_text_representation then
    raise exception 'WORK_NOTIFICATION_RECIPIENT_REVOKED' using errcode='42501';
  end;
  v_workspace:=app_private.work_lock_task_workspace(v_task,null,false);
  if v_workspace is not null then
    select status into v_status from public.work_workspaces where id=v_workspace;
    if v_status<>'active' or app_private.work_workspace_member_role(v_workspace,v_user) is null
      or not app_private.work_task_user_can_view(v_task,v_user) then
      raise exception 'WORK_NOTIFICATION_RECIPIENT_REVOKED' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.work_workspace_notification_insert_guard() from public,anon,authenticated;
create trigger work_workspace_notification_insert_guard before insert on public.notifications
for each row execute function app_private.work_workspace_notification_insert_guard();

create or replace function app_private.work_workspace_calendar_visible(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select app_private.has_permission(public.current_app_user_id(),'work.module.access','global','*') and(
    p_workspace_id is null or app_private.work_workspace_member_role(p_workspace_id,public.current_app_user_id()) is not null
  )
$$;
create or replace function app_private.work_workspace_calendar_exception_visible(p_calendar_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.work_sla_calendars c where c.id=p_calendar_id
    and app_private.work_workspace_calendar_visible(c.workspace_id))
$$;
create or replace function app_private.work_workspace_policy_visible(
  p_workspace_id uuid,p_scope_type text,p_department_id uuid,p_project_id text
)
returns boolean language sql stable security definer set search_path='' as $$
  select app_private.work_workspace_calendar_visible(coalesce(p_workspace_id,
    app_private.work_workspace_for_physical_scope(p_scope_type,p_department_id,p_project_id)))
$$;
revoke all on function app_private.work_workspace_calendar_visible(uuid) from public,anon,authenticated;
revoke all on function app_private.work_workspace_calendar_exception_visible(uuid) from public,anon,authenticated;
revoke all on function app_private.work_workspace_policy_visible(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function app_private.work_workspace_calendar_visible(uuid) to authenticated;
grant execute on function app_private.work_workspace_calendar_exception_visible(uuid) to authenticated;
grant execute on function app_private.work_workspace_policy_visible(uuid,text,uuid,text) to authenticated;

drop policy work_sla_calendars_select on public.work_sla_calendars;
create policy work_sla_calendars_select on public.work_sla_calendars for select to authenticated
using(app_private.work_workspace_calendar_visible(workspace_id));
drop policy work_sla_calendar_exceptions_select on public.work_sla_calendar_exceptions;
create policy work_sla_calendar_exceptions_select on public.work_sla_calendar_exceptions for select to authenticated
using(app_private.work_workspace_calendar_exception_visible(calendar_id));
drop policy work_sla_policies_select on public.work_sla_policies;
create policy work_sla_policies_select on public.work_sla_policies for select to authenticated
using(app_private.work_workspace_policy_visible(workspace_id,scope_type,department_id,project_id));

create or replace function app_private.work_get_clone_draft(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.work_tasks%rowtype; draft jsonb; v_scope jsonb; v_workspace uuid; v_members jsonb; v_sources jsonb;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  select * into strict t from public.work_tasks where id=p_task_id;
  v_workspace:=app_private.work_task_workspace_id(t.id);
  v_scope:=case when v_workspace is not null and not exists(
      select 1 from public.work_task_groups g where g.id=t.task_group_id and g.workspace_id is null
    ) then jsonb_build_object('type','workspace','workspaceId',v_workspace)
    else jsonb_strip_nulls(jsonb_build_object('type',t.scope_type,'departmentId',t.department_id,'projectId',t.project_id)) end;
  perform app_private.work_assert_create_scope(v_scope);
  select coalesce(jsonb_agg(to_jsonb(q.user_id) order by q.user_id),'[]') into v_members from(
    select distinct a.user_id from public.work_task_assignments a where a.task_id=t.id and(
      a.ended_at is null or(t.status='completed' and a.state='completed')or(t.status='cancelled' and a.state='cancelled'))
  )q;
  if v_members is distinct from(select coalesce(jsonb_agg(to_jsonb(m.user_id)order by m.user_id),'[]')
      from public.work_task_recipient_members m where m.task_id=t.id) then
    select coalesce(jsonb_agg(jsonb_build_object('type','user','id',x)order by x),'[]') into v_sources
      from jsonb_array_elements(v_members)x;
  else
    select coalesce(jsonb_agg(jsonb_build_object('type',s.source_type,'id',s.source_id)order by s.sort_order,s.id),'[]')
      into v_sources from public.work_task_recipient_specs s where s.task_id=t.id;
  end if;
  draft:=jsonb_strip_nulls(jsonb_build_object('title',t.title,'description',t.description_document,'scope',v_scope,
    'taskGroupId',t.task_group_id,'labels',t.labels,'priority',t.priority,'privacy',t.privacy,
    'recipientSources',v_sources,
    'watcherUserIds',coalesce((select jsonb_agg(p.user_id order by p.user_id) from public.work_task_participants p
      where p.task_id=t.id and p.participant_role='watcher' and p.ended_at is null),'[]'),
    'reviewerUserId',t.reviewer_user_id,'reviewPolicy',t.review_policy,
    'checklist',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('title',c.title,
      'assigneeUserId',case when v_members@>jsonb_build_array(c.assignee_user_id) then c.assignee_user_id end)) order by c.sort_order,c.id)
      from public.work_task_checklist_items c where c.task_id=t.id and c.completed_at is null and c.deleted_at is null),'[]'),
    'clonedFromTaskId',t.id,'deadlineAt',case when t.deadline_at>now() then t.deadline_at end));
  return jsonb_build_object('draft',draft,'requiresDeadlineConfirmation',coalesce(t.deadline_at<=now(),false),
    'recipientSnapshot',coalesce((select jsonb_agg(jsonb_build_object('userId',x)order by x)
      from jsonb_array_elements(v_members)x),'[]'));
end $$;
revoke all on function app_private.work_get_clone_draft(uuid) from public,anon,authenticated;
grant execute on function app_private.work_get_clone_draft(uuid) to authenticated;

create or replace function app_private.work_clone_form(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;v_labels jsonb;v_draft jsonb;
begin
  v_result:=app_private.work_get_clone_draft(p_task_id);v_draft:=v_result->'draft';
  select coalesce(jsonb_object_agg(id,name),'{}') into v_labels from(
    select u.id::text id,u.name from public.users u where u.id::text in(
      select x->>'id' from jsonb_array_elements(v_draft->'recipientSources')x where x->>'type'='user'
      union select jsonb_array_elements_text(v_draft->'watcherUserIds') union select v_draft->>'reviewerUserId')
    union all select g.id::text,g.name from public.work_groups g where g.id::text in(select x->>'id' from jsonb_array_elements(v_draft->'recipientSources')x where x->>'type'='work_group')
    union all select g.id::text,g.name from public.work_task_groups g where g.id::text=v_draft->>'taskGroupId'
    union all select 'department:'||d.id,d.name from public.org_units d where d.id::text=v_draft->'scope'->>'departmentId'
    union all select 'project:'||p.id,p.name from public.projects p where p.id=v_draft->'scope'->>'projectId'
    union all select 'workspace:'||w.id,w.name from public.work_workspaces w where w.id::text=v_draft->'scope'->>'workspaceId'
    union all select 'direct','Trực tiếp' where v_draft->'scope'->>'type'='direct'
  )q;
  return v_result||jsonb_build_object('labels',v_labels);
end $$;
revoke all on function app_private.work_clone_form(uuid) from public,anon,authenticated;
grant execute on function app_private.work_clone_form(uuid) to authenticated;

create or replace function app_private.work_creation_options(p_kind text,p_scope jsonb,p_search text,p_cursor jsonb,p_limit integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=public.current_app_user_id();v_scope jsonb;v_ctx text;v_scope_id text;v_workspace uuid;
  v_rows jsonb;v_after text;v_n integer:=coalesce(p_limit,30);
begin
  if v_actor is null or not app_private.has_permission(v_actor,'work.module.access','global','*') then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
  if p_kind is null or p_kind not in('scope','filter_scope','user','work_group','watcher','reviewer') or v_n not between 1 and 50 or length(coalesce(p_search,''))>100
    or (p_cursor is not null and (jsonb_typeof(p_cursor)<>'object' or p_cursor-array['id']<>'{}' or jsonb_typeof(p_cursor->'id') is distinct from 'string' or nullif(p_cursor->>'id','') is null)) then
    raise exception 'WORK_INVALID_OPTIONS' using errcode='22023'; end if;
  v_after:=p_cursor->>'id';
  if p_kind not in('scope','filter_scope') then
    perform app_private.work_assert_create_scope(p_scope);
    v_scope:=app_private.work_resolve_workspace_scope(p_scope);v_workspace:=(v_scope->>'workspaceId')::uuid;
    v_ctx:=case when v_workspace is not null then 'work_workspace' when v_scope->>'type'='direct' then 'own' else v_scope->>'type' end;
    v_scope_id:=coalesce(v_workspace::text,v_scope->>'departmentId',v_scope->>'projectId','*');
    if (p_kind='user' and not app_private.has_permission(v_actor,'work.task.assign_user',v_ctx,v_scope_id))
      or (p_kind='work_group' and not app_private.has_permission(v_actor,'work.task.assign_group',v_ctx,v_scope_id))
      or (p_kind='reviewer' and not app_private.has_permission(v_actor,'work.task.manage_scope',v_ctx,v_scope_id)) then
      raise exception 'WORK_OPTIONS_DENIED' using errcode='42501'; end if;
  end if;
  with choices as(
    select 'direct'::text id,'Trực tiếp'::text name,'direct'::text kind
      where (p_kind='scope' and app_private.has_permission(v_actor,'work.task.create','own','*')) or p_kind='filter_scope'
    union all select 'workspace:'||w.id,w.name,'workspace' from public.work_workspaces w
      where app_private.work_workspace_member_role(w.id,v_actor) is not null and (
        (p_kind='scope' and w.status='active' and app_private.has_permission(v_actor,'work.task.create','work_workspace',w.id::text))
        or (p_kind='filter_scope' and exists(select 1 from public.work_tasks t where app_private.work_task_workspace_id(t.id)=w.id and app_private.work_task_actor_can_view(t.id))))
    union all select 'department:'||d.id,d.name,'department' from public.org_units d where app_private.work_workspace_for_physical_scope('department',d.id,null) is null and (
      (p_kind='scope' and app_private.has_permission(v_actor,'work.task.create','department',d.id::text))
      or (p_kind='filter_scope' and exists(select 1 from public.work_tasks t where t.workspace_id is null and t.department_id=d.id and app_private.work_task_actor_can_view(t.id))))
    union all select 'project:'||p.id,p.name,'project' from public.projects p where app_private.work_workspace_for_physical_scope('project',null,p.id) is null and (
      (p_kind='scope' and app_private.has_permission(v_actor,'work.task.create','project',p.id))
      or (p_kind='filter_scope' and exists(select 1 from public.work_tasks t where t.workspace_id is null and t.project_id=p.id and app_private.work_task_actor_can_view(t.id))))
    union all select u.id::text,u.name,'user' from public.users u where p_kind in('user','watcher','reviewer') and u.is_active and u.account_status='ACTIVE'
      and app_private.has_permission(u.id,'work.module.access','global','*')
      and (v_workspace is null or app_private.work_workspace_member_role(v_workspace,u.id) is not null)
      and (p_kind<>'reviewer' or app_private.has_permission(u.id,'work.task.review','assigned','*') or app_private.has_permission(u.id,'work.task.review',v_ctx,v_scope_id))
    union all select g.id::text,g.name,'work_group' from public.work_groups g where p_kind='work_group' and g.is_active
  ),page as(select * from choices where (v_after is null or id>v_after)
    and (nullif(btrim(p_search),'') is null or strpos(lower(name),lower(btrim(p_search)))>0) order by id limit v_n+1)
  select coalesce(jsonb_agg(to_jsonb(page)order by id),'[]') into v_rows from page;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(v_rows)with ordinality where ordinality<=v_n),
    'nextCursor',case when jsonb_array_length(v_rows)>v_n then jsonb_build_object('id',v_rows->(v_n-1)->>'id') else null end);
end $$;
revoke all on function app_private.work_creation_options(text,jsonb,text,jsonb,integer) from public,anon,authenticated;
grant execute on function app_private.work_creation_options(text,jsonb,text,jsonb,integer) to authenticated;
create or replace function public.list_work_creation_options(p_kind text,p_scope jsonb default null,p_search text default '',p_cursor jsonb default null,p_limit integer default 30)
returns jsonb language sql volatile security invoker set search_path='' as $$ select app_private.work_creation_options(p_kind,p_scope,p_search,p_cursor,p_limit) $$;

create or replace function app_private.work_resolve_sla(p_scope jsonb,p_priority text,p_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.work_sla_policies%rowtype;c public.work_sla_calendars%rowtype;minutes integer;v_scope jsonb;
begin
  if p_at is null or p_priority is null or p_priority not in('normal','important','urgent') then raise exception 'WORK_INVALID_SLA_PRIORITY' using errcode='22023'; end if;
  v_scope:=app_private.work_resolve_workspace_scope(p_scope);
  select policy.* into p from public.work_sla_policies policy join public.work_sla_calendars calendar on calendar.id=policy.calendar_id and calendar.is_active
  where policy.is_active and policy.effective_from<=p_at and (policy.effective_to is null or policy.effective_to>p_at)
    and (policy.priority is null or policy.priority=p_priority) and (
      policy.scope_type='global'
      or (v_scope->>'workspaceId' is not null and policy.workspace_id=(v_scope->>'workspaceId')::uuid)
      or (policy.workspace_id is null and policy.scope_type=v_scope->>'type'
        and coalesce(policy.department_id::text,policy.project_id)=coalesce(v_scope->>'departmentId',v_scope->>'projectId')))
  order by (policy.scope_type<>'global')desc,(policy.workspace_id is not null)desc,(policy.priority is not null)desc,policy.effective_from desc,policy.id desc limit 1;
  if p.id is not null then select * into c from public.work_sla_calendars where id=p.calendar_id;
  else select * into c from public.work_sla_calendars where is_default and is_active;end if;
  if c.id is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=c.timezone) then raise exception 'WORK_CALENDAR_NOT_CONFIGURED';end if;
  if p.id is not null then minutes:=p.acknowledgement_minutes;
  elsif p_priority='urgent' then minutes:=60;elsif p_priority='important' then minutes:=240;
  elsif c.working_intervals='[]'::jsonb then minutes:=extract(epoch from(c.workday_end-c.workday_start))::integer/60;
  else select sum(extract(epoch from((x->>'end')::time-(x->>'start')::time))/60)::integer into minutes from jsonb_array_elements(c.working_intervals)x;end if;
  if minutes not between 1 and 525600 then raise exception 'WORK_CALENDAR_NOT_CONFIGURED';end if;
  return jsonb_build_object('calendarId',c.id,'calendar',to_jsonb(c),'policyId',p.id,'priority',p_priority,
    'acknowledgementMinutes',minutes,'executionMinutes',p.execution_minutes,'resolvedAt',p_at);
end $$;
revoke all on function app_private.work_resolve_sla(jsonb,text,timestamptz) from public,anon,authenticated;

create or replace function app_private.work_apply_assignment_sla(p_assignment_id uuid,p_include_ack boolean)
returns void language plpgsql volatile security definer set search_path='' as $$
declare a public.work_task_assignments%rowtype;t public.work_tasks%rowtype;scope jsonb;config jsonb;v_workspace uuid;
  ack_due timestamptz;execution_due timestamptz;snapshot jsonb;v_at timestamptz;
begin
  select * into strict a from public.work_task_assignments where id=p_assignment_id;
  select * into strict t from public.work_tasks where id=a.task_id;
  v_workspace:=app_private.work_task_workspace_id(t.id);
  scope:=case when v_workspace is not null then jsonb_build_object('type','workspace','workspaceId',v_workspace)
    else jsonb_strip_nulls(jsonb_build_object('type',t.scope_type,'departmentId',t.department_id,'projectId',t.project_id)) end;
  snapshot:=a.sla_snapshot;ack_due:=a.acknowledgement_due_at;
  if p_include_ack then
    config:=app_private.work_resolve_sla(scope,t.priority,a.assigned_at);
    if a.acknowledged_at is null then ack_due:=app_private.work_add_business_minutes((config->>'calendarId')::uuid,a.assigned_at,(config->>'acknowledgementMinutes')::integer);end if;
    config:=config||jsonb_build_object('exceptions',coalesce((select jsonb_agg(to_jsonb(e)order by e.exception_date)
      from public.work_sla_calendar_exceptions e where e.calendar_id=(config->>'calendarId')::uuid
        and e.exception_date between(a.assigned_at at time zone(config->'calendar'->>'timezone'))::date
          and(coalesce(ack_due,a.assigned_at)at time zone(config->'calendar'->>'timezone'))::date),'[]'));
    snapshot:=snapshot||jsonb_build_object('acknowledgement',config);
  end if;
  if a.acknowledged_at is not null then
    v_at:=a.acknowledged_at;config:=app_private.work_resolve_sla(scope,t.priority,v_at);
    if config->>'executionMinutes' is not null then execution_due:=app_private.work_add_business_minutes((config->>'calendarId')::uuid,v_at,(config->>'executionMinutes')::integer);end if;
    config:=config||jsonb_build_object('exceptions',coalesce((select jsonb_agg(to_jsonb(e)order by e.exception_date)
      from public.work_sla_calendar_exceptions e where e.calendar_id=(config->>'calendarId')::uuid
        and e.exception_date between(v_at at time zone(config->'calendar'->>'timezone'))::date
          and(coalesce(execution_due,v_at)at time zone(config->'calendar'->>'timezone'))::date),'[]'));
    snapshot:=snapshot||jsonb_build_object('execution',config);
  end if;
  update public.work_task_assignments set acknowledgement_due_at=ack_due,execution_sla_started_at=a.acknowledged_at,
    execution_sla_due_at=execution_due,sla_snapshot=snapshot where id=a.id;
end $$;
revoke all on function app_private.work_apply_assignment_sla(uuid,boolean) from public,anon,authenticated;
