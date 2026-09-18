-- Cloud-only Task 12.4.2-E Request template parity smoke. All writes roll back.
begin;

create temporary table task12_4_2_request_context on commit drop as
select u.id as target_id, u.auth_id as target_auth_id
from public.users u
where u.is_active and u.account_status = 'ACTIVE' and u.role::text <> 'ADMIN'
  and u.auth_id is not null
  and (
    'RQ' = any(coalesce(u.admin_modules, '{}'::text[]))
    or coalesce(u.admin_sub_modules->'RQ', '[]'::jsonb) ? '/rq/templates'
  )
  and exists (
    select 1 from public.user_permission_grants g
    where g.user_id = u.id and g.permission_code = 'request.template.manage' and g.is_active
  )
  and not exists (
    select 1
    from public.principal_role_assignments assignment_row
    join public.role_permission_template_items item on item.template_id = assignment_row.role_template_id
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = u.id
      and assignment_row.status = 'ACTIVE'
      and item.permission_code = 'request.template.manage'
  )
order by u.id limit 1;

grant select on task12_4_2_request_context to authenticated;

do $$
begin
  if not exists (select 1 from task12_4_2_request_context) then
    raise exception 'Request parity smoke fixture unavailable';
  end if;
end;
$$;

select set_config('app.authorization_permission_command', 'on', true);
update public.user_permission_grants
set is_active = false, updated_at = now()
where user_id = (select target_id from task12_4_2_request_context)
  and permission_code in ('request.template.view', 'request.template.manage')
  and is_active;

insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select target_id, 'request.template.view', 'global', '*', true,
       'Task 12.4.2 Request read-only parity smoke'
from task12_4_2_request_context
on conflict (user_id, permission_code, scope_type, scope_id) do update
set is_active = true, updated_at = now();

select set_config('request.jwt.claim.sub', target_auth_id::text, true)
from task12_4_2_request_context;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_target uuid := (select target_id from task12_4_2_request_context);
  v_payload jsonb;
begin
  if app_private.request_user_can_manage(v_target) then
    raise exception 'Legacy RQ fields still grant Request template manage';
  end if;
  if not app_private.request_user_can_view_templates(v_target) then
    raise exception 'Canonical Request template view grant cannot read templates';
  end if;
  v_payload := public.list_request_templates('{}'::jsonb);
  if jsonb_typeof(v_payload->'items') <> 'array' then
    raise exception 'Request template list did not return an item array';
  end if;
end;
$$;

reset role;
rollback;
