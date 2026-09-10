create table if not exists app_private.authorization_room_retirement_dispositions (
  room_code text primary key,
  disposition text not null check (disposition in ('view_only_admin_write', 'retired')),
  reason text not null check (char_length(btrim(reason)) >= 10),
  snapshot jsonb not null default '{}'::jsonb,
  retired_at timestamptz not null default now()
);

revoke all on table app_private.authorization_room_retirement_dispositions from public, anon, authenticated;
grant select on table app_private.authorization_room_retirement_dispositions to service_role;

insert into app_private.authorization_room_retirement_dispositions (room_code, disposition, reason, snapshot)
select room.code,
       'view_only_admin_write',
       'Authorization V2 Phase 4: ordinary accounts retain read-only access; System Admin retains mutation authority.',
       jsonb_build_object(
         'allowedActions', room.allowed_actions,
         'requiredActions', room.required_actions,
         'activeMemberships', (
           select count(*) from public.project_permission_room_members member_row
           where member_row.room_code = room.code and member_row.is_active
         ),
         'bindings', (
           select coalesce(jsonb_agg(to_jsonb(binding) order by binding.action_code), '[]'::jsonb)
           from app_private.project_permission_room_action_bindings binding
           where binding.room_code = room.code
         )
       )
from public.project_permission_rooms room
where room.code in ('material_waste', 'custom_material', 'boq_reconciliation', 'subcontract')
on conflict (room_code) do update
set disposition = excluded.disposition,
    reason = excluded.reason,
    snapshot = excluded.snapshot,
    retired_at = now();

update public.project_permission_room_member_actions action_row
set is_active = false,
    updated_at = now()
from public.project_permission_room_members member_row
where member_row.id = action_row.room_member_id
  and member_row.room_code in ('material_waste', 'custom_material', 'boq_reconciliation', 'subcontract')
  and action_row.is_active;

update public.project_permission_room_members
set is_active = false,
    updated_at = now()
where room_code in ('material_waste', 'custom_material', 'boq_reconciliation', 'subcontract')
  and is_active;

update public.project_permission_rooms
set is_active = false,
    updated_at = now()
where code in ('material_waste', 'custom_material', 'boq_reconciliation', 'subcontract')
  and is_active;

update app_private.project_permission_room_action_bindings
set enforcement_status = 'enforced',
    pbac_fallback_enabled = false,
    verified_at = now(),
    verified_source = 'authorization_v2_phase4_retired_view_only_room',
    updated_at = now()
where room_code in ('material_waste', 'custom_material', 'boq_reconciliation', 'subcontract');

update public.permission_actions
set is_active = false,
    updated_at = now()
where is_active
  and permission_code ~ '^project\.(material_waste|custom_material|subcontract)\.'
  and permission_code not in (
    'project.material_waste.view',
    'project.custom_material.view',
    'project.subcontract.view'
  );

update public.user_permission_grants
set is_active = false,
    revoked_at = coalesce(revoked_at, now()),
    revoked_reason = coalesce(revoked_reason, 'Authorization V2 Phase 4 retired non-view capability'),
    updated_at = now()
where is_active
  and permission_code ~ '^project\.(material_waste|custom_material|subcontract)\.'
  and permission_code not in (
    'project.material_waste.view',
    'project.custom_material.view',
    'project.subcontract.view'
  );

create or replace function app_private.custom_material_request_can_mutate(
  p_project_id text,
  p_construction_site_id text,
  p_created_by uuid,
  p_status text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin();
$$;

create or replace function app_private.authorization_v2_assert_retired_module_admin_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'AUTHORIZATION_V2_ADMIN_WRITE_REQUIRED'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_private.authorization_v2_assert_retired_module_admin_write() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'custom_material_import_mapping_profiles',
    'custom_material_request_attachments',
    'custom_material_request_events',
    'custom_material_request_imports',
    'custom_material_request_lines',
    'custom_material_requests',
    'custom_material_po_lines',
    'custom_material_rfq_lines',
    'custom_material_rfq_suppliers',
    'custom_material_rfqs',
    'boq_reconciliation_contract_lines',
    'boq_reconciliation_groups',
    'boq_reconciliation_work_lines',
    'acceptance_records',
    'subcontractor_contracts'
  ] loop
    execute format('drop trigger if exists authorization_v2_admin_write_guard on public.%I', table_name);
    execute format(
      'create trigger authorization_v2_admin_write_guard before insert or update or delete on public.%I for each row execute function app_private.authorization_v2_assert_retired_module_admin_write()',
      table_name
    );
  end loop;
end $$;

drop policy if exists custom_material_requests_insert on public.custom_material_requests;
create policy custom_material_requests_insert on public.custom_material_requests
for insert to authenticated with check (public.is_admin());

drop policy if exists custom_material_requests_delete on public.custom_material_requests;
create policy custom_material_requests_delete on public.custom_material_requests
for delete to authenticated using (public.is_admin());

drop policy if exists boq_reconciliation_groups_insert on public.boq_reconciliation_groups;
create policy boq_reconciliation_groups_insert on public.boq_reconciliation_groups
for insert to authenticated with check (public.is_admin());

drop policy if exists boq_reconciliation_groups_update on public.boq_reconciliation_groups;
create policy boq_reconciliation_groups_update on public.boq_reconciliation_groups
for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists boq_reconciliation_groups_delete on public.boq_reconciliation_groups;
create policy boq_reconciliation_groups_delete on public.boq_reconciliation_groups
for delete to authenticated using (public.is_admin());

drop policy if exists subcontractor_contracts_insert on public.subcontractor_contracts;
create policy subcontractor_contracts_insert on public.subcontractor_contracts
for insert to authenticated with check (public.is_admin());

drop policy if exists subcontractor_contracts_update on public.subcontractor_contracts;
create policy subcontractor_contracts_update on public.subcontractor_contracts
for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists subcontractor_contracts_delete on public.subcontractor_contracts;
create policy subcontractor_contracts_delete on public.subcontractor_contracts
for delete to authenticated using (public.is_admin());

create or replace function app_private.enforce_boq_reconciliation_room_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not public.is_admin() then
    raise exception 'AUTHORIZATION_V2_ADMIN_WRITE_REQUIRED'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
