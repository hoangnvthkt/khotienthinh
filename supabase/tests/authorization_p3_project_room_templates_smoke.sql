-- Run after authorization_p3_project_room_templates. Rolls back.
begin;
create temporary table rt_ctx on commit drop as
select s.id staff_id, s.project_id,
  (select m.construction_site_id from public.project_permission_room_members m
   where m.project_id = s.project_id and m.is_active limit 1) site_id,
  (select auth_id from public.users where role::text = 'ADMIN' and is_active and auth_id is not null limit 1) admin_auth,
  (select email from public.users where role::text = 'ADMIN' and is_active and auth_id is not null limit 1) admin_email,
  (select auth_id from public.users where role::text <> 'ADMIN' and is_active and auth_id is not null limit 1) staff_auth,
  (select email from public.users where role::text <> 'ADMIN' and is_active and auth_id is not null limit 1) staff_email
from public.project_staff s
where s.end_date is null
  and exists (select 1 from public.project_permission_room_members m where m.project_id = s.project_id and m.is_active)
limit 1;
create temporary table rt_out (k text, v jsonb) on commit drop;
grant select on rt_ctx to authenticated;
grant all on rt_out to authenticated;

-- Other people's Room actions in the project, to prove they stay untouched.
create temporary table rt_others on commit drop as
select m.room_code, m.project_staff_id, a.action_code
from public.project_permission_room_members m
join public.project_permission_room_member_actions a on a.room_member_id = m.id and a.is_active
where m.project_id = (select project_id from rt_ctx) and m.is_active and m.project_staff_id <> (select staff_id from rt_ctx);

do $$
begin
  if (select count(*) from public.project_room_templates where is_active) <> 6 then raise exception 'default templates missing'; end if;
  if not ((select room_actions -> 'daily_log' from public.project_room_templates where code = 'site_commander') ? 'view') then
    raise exception 'prerequisite view not added';
  end if;
  if cardinality((select suggested_position_ids from public.project_room_templates where code = 'site_commander')) = 0 then
    raise exception 'no suggested positions for site commander';
  end if;
end $$;

-- Employee cannot apply or edit templates.
select set_config('request.jwt.claims', jsonb_build_object('sub', staff_auth, 'email', staff_email, 'role', 'authenticated')::text, true) from rt_ctx;
set local role authenticated;
do $$
begin
  begin
    perform public.apply_project_room_template((select project_id from rt_ctx), (select site_id from rt_ctx), (select staff_id from rt_ctx), 'viewer', 'merge', false);
    raise exception 'employee applied a template';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_project_room_template('viewer', 'x x', null, '{}'::jsonb, '{}', true);
    raise exception 'employee edited a template';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Admin previews, merges, then replaces.
select set_config('request.jwt.claims', jsonb_build_object('sub', admin_auth, 'email', admin_email, 'role', 'authenticated')::text, true) from rt_ctx;
set local role authenticated;
insert into rt_out select 'preview', public.apply_project_room_template(project_id, site_id, staff_id, 'site_commander', 'merge', true) from rt_ctx;
insert into rt_out select 'merge', public.apply_project_room_template(project_id, site_id, staff_id, 'site_commander', 'merge', false) from rt_ctx;
insert into rt_out select 'replace', public.apply_project_room_template(project_id, site_id, staff_id, 'field_engineer', 'replace', false) from rt_ctx;
-- Admin adjusts the QS template for this person: adds safety view, drops payment submit.
insert into rt_out select 'exact', public.apply_project_room_template(project_id, site_id, staff_id, 'quantity_surveyor', 'exact', false,
  (select (room_actions - 'payment') || '{"payment":["view","edit"],"safety":["view"]}'::jsonb from public.project_room_templates where code = 'quantity_surveyor')) from rt_ctx;
insert into rt_out select 'current', public.get_project_staff_room_actions(project_id, site_id, staff_id) from rt_ctx;
do $$
begin
  begin
    perform public.save_project_room_template('bad_room_action', 'Sai', null, '{"gantt":["approve"]}'::jsonb, '{}', true);
    raise exception 'invalid action accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

do $$
declare
  v_after jsonb;
  v_expected jsonb;
begin
  if (select v from rt_out where k = 'preview') -> 'changes' is distinct from (select v from rt_out where k = 'merge') -> 'changes' then
    raise exception 'preview differs from what was applied';
  end if;
  select coalesce(jsonb_object_agg(room_code, actions), '{}'::jsonb) into v_after from (
    select m.room_code, jsonb_agg(a.action_code order by a.action_code) actions
    from public.project_permission_room_members m
    join public.project_permission_room_member_actions a on a.room_member_id = m.id and a.is_active
    where m.project_id = (select project_id from rt_ctx) and m.construction_site_id is not distinct from (select site_id from rt_ctx)
      and m.project_staff_id = (select staff_id from rt_ctx) and m.is_active
    group by m.room_code) x;
  if (select v from rt_out where k = 'replace') -> 'changes' = '[]'::jsonb then raise exception 'replace changed nothing'; end if;
  -- After the adjusted QS template the person has exactly that set.
  v_expected := (select (room_actions - 'payment') || '{"payment":["edit","view"],"safety":["view"]}'::jsonb from public.project_room_templates where code = 'quantity_surveyor');
  if v_after <> v_expected then raise exception 'exact did not leave the adjusted set: % vs %', v_after, v_expected; end if;
  if (select v from rt_out where k = 'current') <> v_after then raise exception 'current actions read differently'; end if;
  if not ((select v from rt_out where k = 'exact') ->> 'customized')::boolean then raise exception 'adjustment not flagged as customized'; end if;
  if exists (
    select room_code, project_staff_id, action_code from rt_others
    except
    select m.room_code, m.project_staff_id, a.action_code
    from public.project_permission_room_members m
    join public.project_permission_room_member_actions a on a.room_member_id = m.id and a.is_active
    where m.project_id = (select project_id from rt_ctx) and m.is_active
  ) then
    raise exception 'other people''s Room actions changed';
  end if;
  if not exists (select 1 from public.audit_trail where table_name = 'project_permission_room_members'
                 and record_id = (select staff_id::text from rt_ctx) and created_at > now() - interval '1 minute') then
    raise exception 'template application not audited';
  end if;
end $$;
rollback;
