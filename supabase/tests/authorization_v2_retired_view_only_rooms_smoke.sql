begin;

do $$
begin
  if (select count(*) from public.project_permission_rooms
      where code in ('material_waste', 'custom_material', 'boq_reconciliation', 'subcontract') and is_active) <> 0 then
    raise exception 'AUTH_V2_RETIRED_ROOM_STILL_ACTIVE';
  end if;
  if (select count(*) from app_private.authorization_room_retirement_dispositions
      where room_code in ('material_waste', 'custom_material', 'boq_reconciliation', 'subcontract')
        and disposition = 'view_only_admin_write') <> 4 then
    raise exception 'AUTH_V2_ROOM_DISPOSITION_MISSING';
  end if;
  if (select count(*) from app_private.project_permission_room_action_bindings
      where room_code in ('material_waste', 'custom_material', 'boq_reconciliation', 'subcontract')
        and enforcement_status = 'enforced' and not pbac_fallback_enabled) <> 17 then
    raise exception 'AUTH_V2_RETIRED_BINDING_STILL_AUTHORIZES_FALLBACK';
  end if;
  if exists (
    select 1 from public.project_permission_room_members member_row
    where member_row.room_code in ('material_waste', 'custom_material', 'boq_reconciliation', 'subcontract')
      and member_row.is_active
  ) then raise exception 'AUTH_V2_RETIRED_MEMBERSHIP_ACTIVE'; end if;
  if exists (
    select 1 from public.permission_actions action_row
    where action_row.is_active
      and action_row.permission_code ~ '^project\.(material_waste|custom_material|subcontract)\.'
      and action_row.permission_code not in ('project.material_waste.view', 'project.custom_material.view', 'project.subcontract.view')
  ) then raise exception 'AUTH_V2_RETIRED_NON_VIEW_ACTION_ACTIVE'; end if;
  if exists (
    select 1 from public.user_permission_grants grant_row
    where grant_row.is_active
      and grant_row.permission_code ~ '^project\.(material_waste|custom_material|subcontract)\.'
      and grant_row.permission_code not in ('project.material_waste.view', 'project.custom_material.view', 'project.subcontract.view')
  ) then raise exception 'AUTH_V2_RETIRED_NON_VIEW_GRANT_ACTIVE'; end if;
  if (select count(*) from pg_trigger
      where tgname = 'authorization_v2_admin_write_guard' and not tgisinternal) <> 15 then
    raise exception 'AUTH_V2_ADMIN_WRITE_GUARDS_INCOMPLETE';
  end if;
end;
$$;

create temporary table authorization_v2_retired_room_actor (
  admin_auth_id uuid not null,
  admin_email text not null,
  ordinary_auth_id uuid not null,
  ordinary_email text not null
) on commit drop;
grant select on authorization_v2_retired_room_actor to authenticated;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_ordinary uuid := gen_random_uuid();
begin
  insert into public.users (id, name, email, username, role, is_active, account_status)
  values
    (v_admin, 'Auth V2 retired Admin', 'auth-v2-retired-admin-' || v_admin || '@invalid.local', 'auth-v2-retired-admin-' || v_admin, 'ADMIN', true, 'ACTIVE'),
    (v_ordinary, 'Auth V2 retired Ordinary', 'auth-v2-retired-ordinary-' || v_ordinary || '@invalid.local', 'auth-v2-retired-ordinary-' || v_ordinary, 'EMPLOYEE', true, 'ACTIVE');
  insert into authorization_v2_retired_room_actor
  select gen_random_uuid(), admin_user.email, gen_random_uuid(), ordinary_user.email
  from public.users admin_user, public.users ordinary_user
  where admin_user.id = v_admin and ordinary_user.id = v_ordinary;
end;
$$;

create temporary table authorization_v2_admin_guard_probe (id integer primary key) on commit drop;
create trigger authorization_v2_admin_write_guard
before insert or update or delete on authorization_v2_admin_guard_probe
for each row execute function app_private.authorization_v2_assert_retired_module_admin_write();
grant all on authorization_v2_admin_guard_probe to authenticated;

set local role authenticated;

do $$
declare
  actor authorization_v2_retired_room_actor%rowtype;
  denied boolean := false;
  existing_subcontract_id text;
  affected_rows integer;
begin
  select * into actor from authorization_v2_retired_room_actor;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor.ordinary_auth_id, 'email', actor.ordinary_email, 'role', 'authenticated')::text, true);
  if app_private.custom_material_request_can_mutate(null, null, null, 'draft') then
    raise exception 'AUTH_V2_ORDINARY_CUSTOM_MATERIAL_MUTATION_ALLOWED';
  end if;
  begin
    insert into authorization_v2_admin_guard_probe values (1);
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'AUTH_V2_ORDINARY_WRITE_NOT_DENIED'; end if;
  perform count(*) from public.subcontractor_contracts;
  select id into existing_subcontract_id from public.subcontractor_contracts limit 1;
  if existing_subcontract_id is not null then
    update public.subcontractor_contracts set updated_at = updated_at where id = existing_subcontract_id;
    get diagnostics affected_rows = row_count;
    if affected_rows <> 0 then raise exception 'AUTH_V2_ORDINARY_SUBCONTRACT_WRITE_NOT_DENIED'; end if;
  end if;
end;
$$;

do $$
declare
  actor authorization_v2_retired_room_actor%rowtype;
  existing_subcontract_id text;
  affected_rows integer;
begin
  select * into actor from authorization_v2_retired_room_actor;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor.admin_auth_id, 'email', actor.admin_email, 'role', 'authenticated')::text, true);
  if not app_private.custom_material_request_can_mutate(null, null, null, 'draft') then
    raise exception 'AUTH_V2_ADMIN_CUSTOM_MATERIAL_MUTATION_DENIED';
  end if;
  insert into authorization_v2_admin_guard_probe values (2);
  select id into existing_subcontract_id from public.subcontractor_contracts limit 1;
  if existing_subcontract_id is not null then
    update public.subcontractor_contracts set updated_at = updated_at where id = existing_subcontract_id;
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then raise exception 'AUTH_V2_ADMIN_SUBCONTRACT_WRITE_DENIED'; end if;
  end if;
end;
$$;

rollback;
