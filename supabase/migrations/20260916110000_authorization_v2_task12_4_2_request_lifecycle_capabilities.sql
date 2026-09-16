-- E26-A: separate the Request lifecycle actions that already exist in runtime.
-- Request DRAFT creation/deletion is deliberately not declared complete here.

insert into public.permission_actions (
  module_code, action, permission_code, label, description, scope_modes,
  legacy_module_key, legacy_route, legacy_admin_only, sort_order, is_active,
  risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code,
  direct_grant_allowed
)
values
  ('request.instance','approve_assigned','request.instance.approve_assigned','Duyệt yêu cầu được giao','Duyệt bước yêu cầu đang được giao cho chính actor.',array['assigned']::text[],'RQ','/rq',false,31,true,'sensitive',true,true,true,'enforced','request',true),
  ('request.instance','reject_assigned','request.instance.reject_assigned','Từ chối yêu cầu được giao','Từ chối bước yêu cầu đang được giao cho chính actor.',array['assigned']::text[],'RQ','/rq',false,32,true,'sensitive',true,true,true,'enforced','request',true),
  ('request.instance','return_assigned','request.instance.return_assigned','Trả lại yêu cầu được giao','Trả yêu cầu đang được giao về cho người tạo bổ sung.',array['assigned']::text[],'RQ','/rq',false,33,true,'important',true,true,false,'enforced','request',true),
  ('request.instance','resubmit_own','request.instance.resubmit_own','Gửi lại yêu cầu của mình','Gửi lại yêu cầu của chính actor sau khi bị trả về.',array['own']::text[],'RQ','/rq',false,34,true,'normal',true,false,false,'enforced','request',true),
  ('request.instance','cancel','request.instance.cancel','Hủy yêu cầu','Hủy yêu cầu của mình hoặc yêu cầu trong phạm vi quản trị.',array['own','global']::text[],'RQ','/rq',false,35,true,'important',true,false,false,'enforced','request',true),
  ('request.instance','reassign','request.instance.reassign','Chuyển người xử lý yêu cầu','Chuyển một bước duyệt đang chờ sang người xử lý khác.',array['global']::text[],'RQ','/rq',true,36,true,'sensitive',true,false,true,'enforced','request',true),
  ('request.instance','edit_own_content','request.instance.edit_own_content','Sửa nội dung yêu cầu của mình','Sửa nội dung yêu cầu PENDING hoặc RETURNED do chính actor tạo.',array['own']::text[],'RQ','/rq',false,37,true,'normal',true,false,false,'enforced','request',true)
on conflict (permission_code) do update
set label = excluded.label,
    description = excluded.description,
    scope_modes = excluded.scope_modes,
    legacy_module_key = excluded.legacy_module_key,
    legacy_route = excluded.legacy_route,
    legacy_admin_only = excluded.legacy_admin_only,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    risk_level = excluded.risk_level,
    is_business_action = excluded.is_business_action,
    is_business_approval = excluded.is_business_approval,
    direct_grant_requires_expiry = excluded.direct_grant_requires_expiry,
    grant_readiness = excluded.grant_readiness,
    access_application_code = excluded.access_application_code,
    direct_grant_allowed = excluded.direct_grant_allowed,
    updated_at = now();

create or replace function app_private.request_actor_has_lifecycle_action(
  p_request_id uuid,
  p_actor_id uuid,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_id is not null
    and exists (
      select 1
      from public.users actor
      where actor.id = p_actor_id
        and actor.is_active
        and actor.account_status = 'ACTIVE'
    )
    and exists (
      select 1
      from public.request_instances request_row
      where request_row.id = p_request_id
        and case upper(p_action)
          when 'APPROVE' then
            app_private.has_permission(p_actor_id,'request.instance.approve_assigned','assigned',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.act_assigned','assigned',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.act_assigned','global','*')
            or app_private.has_permission(p_actor_id,'system.rq.view','global','*')
          when 'REJECT' then
            app_private.has_permission(p_actor_id,'request.instance.reject_assigned','assigned',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.act_assigned','assigned',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.act_assigned','global','*')
            or app_private.has_permission(p_actor_id,'system.rq.view','global','*')
          when 'RETURN' then
            app_private.has_permission(p_actor_id,'request.instance.return_assigned','assigned',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.act_assigned','assigned',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.act_assigned','global','*')
            or app_private.has_permission(p_actor_id,'system.rq.view','global','*')
          when 'RESUBMIT' then request_row.created_by = p_actor_id and (
            app_private.has_permission(p_actor_id,'request.instance.resubmit_own','own',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.create','global','*')
            or app_private.has_permission(p_actor_id,'request.instance.view_own','global','*')
            or app_private.has_permission(p_actor_id,'system.rq.view','global','*')
          )
          when 'EDIT_CONTENT' then request_row.created_by = p_actor_id and (
            app_private.has_permission(p_actor_id,'request.instance.edit_own_content','own',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.create','global','*')
            or app_private.has_permission(p_actor_id,'request.instance.view_own','global','*')
            or app_private.has_permission(p_actor_id,'system.rq.view','global','*')
          )
          when 'CANCEL' then
            (
              request_row.created_by = p_actor_id and (
                app_private.has_permission(p_actor_id,'request.instance.cancel','own',p_actor_id::text)
                or app_private.has_permission(p_actor_id,'request.instance.create','global','*')
                or app_private.has_permission(p_actor_id,'request.instance.view_own','global','*')
                or app_private.has_permission(p_actor_id,'system.rq.view','global','*')
              )
            )
            or app_private.has_permission(p_actor_id,'request.instance.cancel','global','*')
            or app_private.request_action_is_admin(p_actor_id)
          when 'REASSIGN' then
            app_private.has_permission(p_actor_id,'request.instance.reassign','global','*')
            or app_private.request_action_is_admin(p_actor_id)
          else false
        end
    );
$$;

revoke all on function app_private.request_actor_has_lifecycle_action(uuid,uuid,text)
  from public, anon, authenticated, service_role;

create or replace function app_private.guard_request_instance_lifecycle_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
begin
  if old.title is distinct from new.title
     or old.description is distinct from new.description
     or old.form_data is distinct from new.form_data then
    if old.status in ('PENDING','RETURNED')
       and not app_private.request_actor_has_lifecycle_action(old.id,v_actor,'EDIT_CONTENT') then
      raise exception 'REQUEST_EDIT_FORBIDDEN' using errcode='42501';
    end if;
  end if;

  if old.status = 'RETURNED' and new.status = 'PENDING'
     and not app_private.request_actor_has_lifecycle_action(old.id,v_actor,'RESUBMIT') then
    raise exception 'REQUEST_ACTION_FORBIDDEN' using errcode='42501';
  end if;

  if old.status is distinct from new.status and new.status = 'CANCELLED'
     and not app_private.request_actor_has_lifecycle_action(old.id,v_actor,'CANCEL') then
    raise exception 'REQUEST_ACTION_FORBIDDEN' using errcode='42501';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_request_instance_lifecycle_v2()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_request_instance_lifecycle_v2 on public.request_instances;
create trigger trg_guard_request_instance_lifecycle_v2
before update on public.request_instances
for each row execute function app_private.guard_request_instance_lifecycle_v2();

create or replace function app_private.guard_request_assignment_lifecycle_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request_id uuid;
  v_action text;
begin
  select request_row.id into v_request_id
  from public.request_instances request_row
  where request_row.workflow_subject_id = new.workflow_subject_id;
  if v_request_id is null then return new; end if;

  if tg_op = 'UPDATE' and old.status = 'PENDING' and new.status in ('APPROVED','REJECTED','RETURNED') then
    v_action := case new.status
      when 'APPROVED' then 'APPROVE'
      when 'REJECTED' then 'REJECT'
      else 'RETURN'
    end;
    if new.assignee_user_id is distinct from v_actor
       or not app_private.request_actor_has_lifecycle_action(v_request_id,v_actor,v_action) then
      raise exception 'REQUEST_ACTION_FORBIDDEN' using errcode='42501';
    end if;
  elsif tg_op = 'INSERT' and coalesce(new.metadata,'{}'::jsonb) ? 'reassignedFrom' then
    if not app_private.request_actor_has_lifecycle_action(v_request_id,v_actor,'REASSIGN') then
      raise exception 'REQUEST_ACTION_FORBIDDEN' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_request_assignment_lifecycle_v2()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_request_assignment_lifecycle_v2 on public.workflow_step_assignments;
create trigger trg_guard_request_assignment_lifecycle_v2
before insert or update on public.workflow_step_assignments
for each row execute function app_private.guard_request_assignment_lifecycle_v2();

comment on function app_private.request_actor_has_lifecycle_action(uuid,uuid,text) is
  'E26 exact Request action resolver with assignment/owner boundaries and temporary shell compatibility.';
