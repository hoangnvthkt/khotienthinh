begin;

create or replace function app_private.resolve_active_direct_manager(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select manager.id
  from public.users employee
  join public.users manager on manager.id = employee.manager_id
  where employee.id = p_user_id
    and manager.id <> p_user_id
    and coalesce(manager.is_active, true)
    and coalesce(manager.account_status, 'ACTIVE') = 'ACTIVE';
$$;

create or replace function app_private.resolve_request_direct_manager(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.resolve_active_direct_manager(p_user_id);
$$;

create or replace function app_private.resolve_request_block_approvers(
  p_block_id uuid,
  p_creator_id uuid,
  p_dynamic_user_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block public.request_approval_blocks%rowtype;
  v_source text;
  v_result uuid[] := '{}'::uuid[];
  v_ids uuid[] := '{}'::uuid[];
  v_id uuid;
  v_manager_id uuid;
  v_minimum integer;
begin
  select * into v_block
  from public.request_approval_blocks
  where id = p_block_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_APPROVAL_BLOCK_NOT_FOUND';
  end if;

  v_source := v_block.approver_source;
  if v_source in ('FIXED_SINGLE', 'FIXED_MULTI') then
    v_ids := coalesce(v_block.fixed_user_ids, '{}'::uuid[]);
  elsif v_source = 'DIRECT_MANAGER' then
    v_manager_id := app_private.resolve_active_direct_manager(p_creator_id);
    if v_manager_id is null then
      raise exception using errcode = '22023', message = 'REQUEST_DIRECT_MANAGER_MISSING';
    end if;
    v_ids := array[v_manager_id];
  elsif v_source = 'DYNAMIC_CREATOR_SELECT' then
    v_ids := coalesce(p_dynamic_user_ids, '{}'::uuid[]);
    v_minimum := coalesce(v_block.minimum_dynamic_approvers, 1);
    if cardinality(v_ids) < v_minimum then
      raise exception using errcode = '22023', message = 'REQUEST_DYNAMIC_APPROVER_REQUIRED';
    end if;
  else
    raise exception using errcode = '22023', message = 'REQUEST_APPROVER_SOURCE_INVALID';
  end if;

  foreach v_id in array v_ids loop
    if v_id is null or v_id = any(v_result) then
      continue;
    end if;
    if v_id = p_creator_id then
      raise exception using errcode = '22023', message = 'REQUEST_APPROVER_SELF_NOT_ALLOWED';
    end if;
    if not exists (
      select 1
      from public.users app_user
      where app_user.id = v_id
        and coalesce(app_user.is_active, true)
        and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
    ) then
      raise exception using errcode = '22023', message = 'REQUEST_APPROVER_INACTIVE';
    end if;
    v_result := array_append(v_result, v_id);
  end loop;

  if cardinality(v_result) = 0 then
    raise exception using errcode = '22023', message = 'REQUEST_APPROVER_REQUIRED';
  end if;
  if v_source = 'FIXED_SINGLE' and cardinality(v_result) <> 1 then
    raise exception using errcode = '22023', message = 'REQUEST_APPROVER_SINGLE_REQUIRED';
  end if;
  return v_result;
end;
$$;

create or replace function app_private.enforce_request_approver_not_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
begin
  select request_instance.created_by
  into v_creator_id
  from public.request_instances request_instance
  where request_instance.workflow_subject_id = new.workflow_subject_id;

  if found and new.assignee_user_id = v_creator_id then
    raise exception using errcode = '22023', message = 'REQUEST_APPROVER_SELF_NOT_ALLOWED';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_request_approver_not_creator
  on public.workflow_step_assignments;
create trigger trg_request_approver_not_creator
before insert or update of assignee_user_id
on public.workflow_step_assignments
for each row
execute function app_private.enforce_request_approver_not_creator();

revoke all on function app_private.resolve_active_direct_manager(uuid)
  from public, anon, authenticated;
revoke all on function app_private.resolve_request_direct_manager(uuid)
  from public, anon, authenticated;
revoke all on function app_private.resolve_request_block_approvers(uuid, uuid, uuid[])
  from public, anon;
grant execute on function app_private.resolve_request_block_approvers(uuid, uuid, uuid[])
  to authenticated;
revoke all on function app_private.enforce_request_approver_not_creator()
  from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
