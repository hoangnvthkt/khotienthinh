-- Request module phase 4: template notification switches take effect, and
-- template managers can see how many users lack a direct manager.
--
-- Notifications: the template version's notification_config is honoured when
-- an event is queued. Only an explicit `false` disables an event; configs
-- saved before the switches worked (missing keys) keep every notification.
-- Comments, mentions, watcher and restart events are never suppressed.

create or replace function app_private.request_notification_canonicalize()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_actor uuid:=public.current_app_user_id(); v_status text; v_action text:=upper(coalesce(new.payload->>'action',''));
  v_config jsonb; v_config_key text;
begin
  if new.event_type='REQUEST_APPROVAL_REQUIRED' and coalesce((new.payload->>'reassigned')::boolean,false) then
    new.event_key:='request:'||new.request_id||':REASSIGN_ASSIGNMENT:'||coalesce((select a.id::text
      from public.workflow_step_assignments a join public.request_instances r on r.workflow_subject_id=a.workflow_subject_id
      where r.id=new.request_id and a.assignee_user_id=new.recipient_user_id and a.status='PENDING'
      order by a.assigned_at desc,a.id desc limit 1),new.recipient_user_id::text);
  end if;
  if new.event_type='REQUEST_'||'ACTION_APPLIED' then
    select status into v_status from public.request_instances where id=new.request_id;
    new.event_type:=case v_action
      when 'APPROVE' then case when v_status='APPROVED' then 'REQUEST_APPROVED' else 'REQUEST_STEP_APPROVED' end
      when 'REASSIGN' then 'REQUEST_REASSIGNED'
      when 'RETURN' then 'REQUEST_RETURNED'
      when 'RESUBMIT' then 'REQUEST_RESUBMITTED'
      when 'REJECT' then 'REQUEST_REJECTED'
      when 'CANCEL' then 'REQUEST_CANCELLED'
      else 'REQUEST_STEP_APPROVED' end;
  end if;
  new.payload:=jsonb_strip_nulls((coalesce(new.payload,'{}')-'comment')||jsonb_build_object('actorUserId',v_actor));
  if new.recipient_user_id=v_actor or not exists(select 1 from public.users u where u.id=new.recipient_user_id
    and u.is_active and u.account_status='ACTIVE') then return null; end if;

  v_config_key:=case
    when new.event_type='REQUEST_SUBMITTED' then 'SUBMITTED'
    when new.event_type='REQUEST_APPROVAL_REQUIRED' and coalesce((new.payload->>'reassigned')::boolean,false) then 'REASSIGNED'
    when new.event_type='REQUEST_APPROVAL_REQUIRED' then 'ASSIGNED'
    when new.event_type='REQUEST_REASSIGNED' then 'REASSIGNED'
    when new.event_type in ('REQUEST_DUE_SOON','REQUEST_OVERDUE') then 'REMINDER'
    when new.event_type='REQUEST_RETURNED' then 'RETURNED'
    when new.event_type='REQUEST_APPROVED' then 'APPROVED'
    when new.event_type='REQUEST_REJECTED' then 'REJECTED'
  end;
  if v_config_key is not null then
    select version.notification_config into v_config
    from public.request_instances r
    join public.request_template_versions version on version.id=r.request_template_version_id
    where r.id=new.request_id;
    if jsonb_typeof(v_config->v_config_key)='boolean' and (v_config->>v_config_key)::boolean=false then
      return null;
    end if;
  end if;
  return new;
end $function$;

create or replace function app_private.request_direct_manager_coverage()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null or not app_private.request_user_can_manage(v_actor) then
    raise exception using errcode = '42501', message = 'REQUEST_TEMPLATE_FORBIDDEN';
  end if;
  return (
    with active_users as (
      select app_user.id, coalesce(nullif(app_user.name, ''), app_user.username, app_user.email) as name
      from public.users app_user
      where coalesce(app_user.is_active, true)
        and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
    ), missing as (
      select active_users.*
      from active_users
      where app_private.resolve_active_direct_manager(active_users.id) is null
    )
    select jsonb_build_object(
      'activeUsers', (select count(*) from active_users),
      'withoutManager', (select count(*) from missing),
      'sampleNames', coalesce((select jsonb_agg(name order by name) from (select name from missing order by name limit 8) sample), '[]'::jsonb)
    )
  );
end;
$function$;

create or replace function public.request_direct_manager_coverage()
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select app_private.request_direct_manager_coverage();
$function$;

revoke all on function app_private.request_direct_manager_coverage() from public, anon;
grant execute on function app_private.request_direct_manager_coverage() to authenticated;
revoke all on function public.request_direct_manager_coverage() from public, anon;
grant execute on function public.request_direct_manager_coverage() to authenticated;
