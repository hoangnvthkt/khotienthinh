-- Authorization V2 / Phase 4
-- Cut over the final three active Project Rooms, retire the unused
-- material_request.verify action, reconcile measured drift, and disable the
-- global Room PBAC fallback. This migration intentionally does not rerun any
-- of the seven prior Room cutover migrations.

create temp table authorization_v2_remaining_room_map (
  room_code text not null,
  action_code text not null,
  legacy_permission_codes text[] not null,
  prerequisite_action_codes text[] not null default '{}',
  primary key (room_code, action_code)
) on commit drop;

insert into authorization_v2_remaining_room_map values
  ('quantity_acceptance', 'view',    array['project.quantity_acceptance.view'], '{}'),
  ('quantity_acceptance', 'edit',    array['project.quantity_acceptance.create','project.quantity_acceptance.manage'], array['view']),
  ('quantity_acceptance', 'delete',  array['project.quantity_acceptance.manage'], array['view']),
  ('quantity_acceptance', 'submit',  array['project.quantity_acceptance.submit','project.quantity_acceptance.manage'], array['view']),
  ('quantity_acceptance', 'verify',  array['project.quantity_acceptance.verify','project.quantity_acceptance.manage'], array['view']),
  ('quantity_acceptance', 'approve', array['project.quantity_acceptance.approve','project.quantity_acceptance.manage'], array['view']),
  ('payment', 'view',    array['project.payment.view'], '{}'),
  ('payment', 'edit',    array['project.payment.create','project.payment.edit_own','project.payment.edit_all','project.payment.manage'], array['view']),
  ('payment', 'delete',  array['project.payment.delete_own','project.payment.delete_all','project.payment.manage'], array['view']),
  ('payment', 'submit',  array['project.payment.submit','project.payment.manage'], array['view']),
  ('payment', 'verify',  array['project.payment.return','project.payment.verify','project.payment.manage'], array['view']),
  ('payment', 'approve', array['project.payment.approve','project.payment.manage'], array['view']),
  ('payment', 'confirm', array['project.payment.confirm','project.payment.mark_paid','project.payment.manage'], array['view']),
  ('safety', 'view',    array['project.safety.view','project.safety.worker_manage','project.safety.document_verify','project.safety.manage'], '{}'),
  ('safety', 'edit',    array['project.safety.worker_manage','project.safety.issue_create','project.safety.issue_edit_own','project.safety.issue_edit_all','project.safety.training_manage','project.safety.create','project.safety.edit_all','project.safety.manage'], array['view']),
  ('safety', 'delete',  array['project.safety.manage'], array['view']),
  ('safety', 'submit',  array['project.safety.issue_create','project.safety.create','project.safety.manage'], array['view']),
  ('safety', 'verify',  array['project.safety.document_verify','project.safety.verify','project.safety.manage'], array['view']),
  ('safety', 'confirm', array['project.safety.issue_close','project.safety.manage'], array['view']),
  ('safety', 'approve', array['project.safety.approve','project.safety.manage'], array['view']);

do $$
begin
  if (select count(*) from authorization_v2_remaining_room_map) <> 20 then
    raise exception 'Authorization V2 expected exactly 20 final Room bindings';
  end if;

  if exists (
    select 1
    from authorization_v2_remaining_room_map map
    left join app_private.project_permission_room_action_bindings binding
      using (room_code, action_code)
    where binding.room_code is null
  ) then
    raise exception 'Authorization V2 final Room binding inventory is incomplete';
  end if;
end $$;

update app_private.project_permission_room_action_bindings binding
set legacy_permission_codes = map.legacy_permission_codes,
    prerequisite_action_codes = map.prerequisite_action_codes,
    enforcement_status = 'pilot',
    pbac_fallback_enabled = true,
    verified_at = now(),
    verified_source = 'authorization_v2_phase4_pre_cutover_mapping',
    updated_at = now()
from authorization_v2_remaining_room_map map
where binding.room_code = map.room_code
  and binding.action_code = map.action_code;

-- Materialize every currently effective DIRECT, ROLE, or LEGACY decision at
-- each active staff scope before the fallback is disabled. Mutation actions
-- also materialize their view prerequisite.
create temp table authorization_v2_room_backfill_candidates on commit drop as
with mapped_actions as (
  select * from authorization_v2_remaining_room_map
  union all
  select binding.room_code, binding.action_code,
         binding.legacy_permission_codes, binding.prerequisite_action_codes
  from app_private.project_permission_room_action_bindings binding
  where binding.room_code = 'weekly_progress'
), matched as (
  select distinct staff.id project_staff_id,
         staff.project_id,
         staff.construction_site_id,
         map.room_code,
         map.action_code
  from public.project_staff staff
  join public.users user_row on user_row.id::text = staff.user_id
  cross join mapped_actions map
  where staff.end_date is null
    and staff.project_id is not null
    and user_row.is_active
    and user_row.account_status = 'ACTIVE'
    and user_row.role <> 'ADMIN'
    and exists (
      select 1
      from unnest(map.legacy_permission_codes) permission(permission_code)
      where exists (
        select 1
        from app_private.resolve_effective_permission_sources(
          user_row.id,
          permission.permission_code,
          case when staff.construction_site_id is null then 'project' else 'construction_site' end,
          coalesce(staff.construction_site_id, staff.project_id),
          now()
        ) source
      )
    )
), with_prerequisites as (
  select * from matched
  union
  select project_staff_id, project_id, construction_site_id, room_code, 'view'
  from matched
  where action_code <> 'view'
)
select distinct * from with_prerequisites;

insert into public.project_permission_room_members (
  project_id, construction_site_id, room_code, project_staff_id,
  is_active, created_by, created_at, updated_at
)
select candidate.project_id, candidate.construction_site_id,
       candidate.room_code, candidate.project_staff_id,
       true, null::uuid, now(), now()
from authorization_v2_room_backfill_candidates candidate
group by candidate.project_id, candidate.construction_site_id,
         candidate.room_code, candidate.project_staff_id
on conflict (project_id, (coalesce(construction_site_id, '')), room_code, project_staff_id)
do update set is_active = true, updated_at = now();

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, granted_by,
  granted_at, updated_at, grant_source
)
select member.id, candidate.action_code, true, null::uuid, now(), now(), 'pbac_backfill'
from authorization_v2_room_backfill_candidates candidate
join public.project_permission_room_members member
  on member.project_id = candidate.project_id
 and member.construction_site_id is not distinct from candidate.construction_site_id
 and member.room_code = candidate.room_code
 and member.project_staff_id = candidate.project_staff_id
on conflict (room_member_id, action_code) do update
set is_active = true,
    grant_source = case
      when public.project_permission_room_member_actions.is_active
        then public.project_permission_room_member_actions.grant_source
      else 'pbac_backfill'
    end,
    updated_at = now();

-- Existing final-Room mutations must also satisfy the new view prerequisite.
insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, granted_by,
  granted_at, updated_at, grant_source
)
select distinct member.id, 'view', true, null::uuid, now(), now(), 'pbac_backfill'
from public.project_permission_room_members member
join public.project_permission_room_member_actions action_row
  on action_row.room_member_id = member.id
 and action_row.is_active
 and action_row.action_code <> 'view'
where member.is_active
  and member.room_code in ('quantity_acceptance', 'payment', 'safety', 'weekly_progress')
on conflict (room_member_id, action_code) do update
set is_active = true, updated_at = now();

-- Approved action-level retirement: there is no exact runtime business path.
create table if not exists app_private.authorization_room_action_dispositions (
  room_code text not null,
  action_code text not null,
  disposition text not null check (disposition in ('retired_no_business_path')),
  reason text not null check (char_length(btrim(reason)) >= 10),
  snapshot jsonb not null default '{}'::jsonb,
  retired_at timestamptz not null default now(),
  primary key (room_code, action_code)
);

revoke all on table app_private.authorization_room_action_dispositions from public, anon, authenticated;
grant select on table app_private.authorization_room_action_dispositions to service_role;

insert into app_private.authorization_room_action_dispositions (
  room_code, action_code, disposition, reason, snapshot
)
select 'material_request', 'verify', 'retired_no_business_path',
       'Task 7 found no exact policy, function, frontend, or service business path for project.material_request.verify.',
       jsonb_build_object(
         'binding', to_jsonb(binding),
         'activeMemberActions', (
           select count(*)
           from public.project_permission_room_members member
           join public.project_permission_room_member_actions action_row
             on action_row.room_member_id = member.id
           where member.room_code = 'material_request'
             and member.is_active and action_row.is_active
             and action_row.action_code = 'verify'
         )
       )
from app_private.project_permission_room_action_bindings binding
where binding.room_code = 'material_request' and binding.action_code = 'verify'
on conflict (room_code, action_code) do update
set disposition = excluded.disposition,
    reason = excluded.reason,
    snapshot = excluded.snapshot,
    retired_at = now();

update public.project_permission_room_member_actions action_row
set is_active = false, updated_at = now()
from public.project_permission_room_members member
where member.id = action_row.room_member_id
  and member.room_code = 'material_request'
  and action_row.action_code = 'verify'
  and action_row.is_active;

update public.project_permission_rooms
set allowed_actions = array_remove(allowed_actions, 'verify'),
    required_actions = array_remove(required_actions, 'verify'),
    updated_at = now()
where code = 'material_request';

update public.permission_actions
set is_active = false, updated_at = now()
where permission_code = 'project.material_request.verify' and is_active;

update public.user_permission_grants
set is_active = false,
    revoked_at = coalesce(revoked_at, now()),
    revoked_reason = coalesce(revoked_reason, 'Authorization V2 retired action without a business path'),
    updated_at = now()
where permission_code = 'project.material_request.verify' and is_active;

update app_private.project_permission_room_action_bindings
set enforcement_status = 'enforced',
    pbac_fallback_enabled = false,
    verified_at = now(),
    verified_source = 'authorization_v2_phase4_retired_no_business_path',
    updated_at = now()
where room_code = 'material_request' and action_code = 'verify';

-- Stale memberships are never an acceptable fallback bridge. This is a
-- targeted reconciliation of measured drift, not a prior-Room recutover.
update public.project_permission_room_member_actions action_row
set is_active = false, updated_at = now()
from public.project_permission_room_members member
join public.project_staff staff on staff.id = member.project_staff_id
where action_row.room_member_id = member.id
  and member.is_active
  and staff.end_date is not null
  and action_row.is_active;

update public.project_permission_room_members member
set is_active = false, updated_at = now()
from public.project_staff staff
where staff.id = member.project_staff_id
  and member.is_active
  and staff.end_date is not null;

-- Promote metadata only for every still-active Room action. The seven earlier
-- Room implementations and their domain data are not rerun or rewritten.
update app_private.project_permission_room_action_bindings binding
set enforcement_status = 'enforced',
    pbac_fallback_enabled = false,
    prerequisite_action_codes = case
      when binding.action_code = 'view' then '{}'
      when binding.action_code = any(room.allowed_actions) then array['view']
      else binding.prerequisite_action_codes
    end,
    verified_at = now(),
    verified_source = case
      when binding.room_code in ('quantity_acceptance', 'payment', 'safety')
        then 'authorization_v2_phase4_final_room_cutover'
      else 'authorization_v2_phase4_existing_room_metadata_reconciled'
    end,
    updated_at = now()
from public.project_permission_rooms room
where room.code = binding.room_code
  and room.is_active
  and binding.action_code = any(room.allowed_actions);

-- All Room assertions now share the admin-aware authoritative evaluator.
create or replace function app_private.assert_project_permission_room_action(
  p_project_id text,
  p_construction_site_id text,
  p_room_code text,
  p_action_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or not app_private.project_actor_has_effective_room_action(
    p_user_id, p_project_id, nullif(p_construction_site_id, ''), p_room_code, p_action_code
  ) then
    raise exception 'Bạn chưa có quyền % trong Room % của dự án này.', p_action_code, p_room_code
      using errcode = '42501';
  end if;
end;
$$;

-- Existing domain functions ask for canonical permission codes. For the final
-- three modules those decisions now resolve to their authoritative Room action
-- so a stale DIRECT/ROLE/LEGACY grant cannot bypass Room assignment.
create or replace function app_private.authorization_v2_final_room_action(
  p_permission_code text
)
returns table(room_code text, action_code text)
language sql
immutable
security definer
set search_path = ''
as $$
  select split_part(p_permission_code, '.', 2),
    case
      when p_permission_code in (
        'project.payment.view', 'project.quantity_acceptance.view', 'project.safety.view'
      ) then 'view'
      when p_permission_code ~ '^project\.payment\.(create|edit_own|edit_all|manage)$'
        or p_permission_code ~ '^project\.quantity_acceptance\.(create|manage)$'
        or p_permission_code ~ '^project\.safety\.(worker_manage|issue_create|issue_edit_own|issue_edit_all|training_manage|create|edit_all|manage)$'
        then 'edit'
      when p_permission_code ~ '^project\.payment\.(delete_own|delete_all)$'
        or p_permission_code = 'project.quantity_acceptance.delete' then 'delete'
      when p_permission_code in ('project.payment.submit', 'project.quantity_acceptance.submit', 'project.safety.create') then 'submit'
      when p_permission_code in (
        'project.payment.return', 'project.payment.verify',
        'project.quantity_acceptance.verify',
        'project.safety.document_verify', 'project.safety.verify'
      ) then 'verify'
      when p_permission_code in (
        'project.payment.approve', 'project.quantity_acceptance.approve', 'project.safety.approve'
      ) then 'approve'
      when p_permission_code in (
        'project.payment.confirm', 'project.payment.mark_paid', 'project.safety.issue_close'
      ) then 'confirm'
    end
  where p_permission_code ~ '^project\.(payment|quantity_acceptance|safety)\.';
$$;

revoke all on function app_private.authorization_v2_final_room_action(text) from public, anon, authenticated;

create or replace function app_private.project_has_permission_v2(
  p_project_id text,
  p_construction_site_id text,
  p_permission_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with room_mapping as (
    select * from app_private.authorization_v2_final_room_action(p_permission_code)
  )
  select p_permission_code like 'project.%'
  and case
    when exists (select 1 from room_mapping) then exists (
      select 1
      from room_mapping map
      where map.action_code is not null
        and app_private.project_actor_has_effective_room_action(
          p_user_id, p_project_id, p_construction_site_id, map.room_code, map.action_code
        )
    )
    else (
      exists (
        select 1
        from public.users user_row
        where user_row.id = p_user_id
          and coalesce(user_row.is_active, true)
          and user_row.role = 'ADMIN'
      )
      or exists (
        select 1
        from public.users user_row
        join public.user_permission_grants grant_row on grant_row.user_id = user_row.id
        where user_row.id = p_user_id
          and coalesce(user_row.is_active, true)
          and grant_row.permission_code = p_permission_code
          and coalesce(grant_row.is_active, false)
          and (grant_row.expires_at is null or grant_row.expires_at > now())
          and (
            grant_row.scope_type = 'global'
            or (grant_row.scope_type = 'project' and (grant_row.scope_id = '*' or grant_row.scope_id = p_project_id))
            or (
              p_construction_site_id is not null
              and grant_row.scope_type = 'construction_site'
              and (grant_row.scope_id = '*' or grant_row.scope_id = p_construction_site_id)
            )
          )
      )
      or (
        p_permission_code like 'project.material_direct_purchase.%'
        and (
          app_private.project_has_permission_v2(p_project_id, p_construction_site_id, 'project.material_po.manage', p_user_id)
          or (
            p_permission_code = 'project.material_direct_purchase.view'
            and app_private.project_user_has_room_action(p_user_id, p_project_id, p_construction_site_id, 'material_po', 'view')
          )
          or (
            p_permission_code = 'project.material_direct_purchase.create'
            and app_private.project_user_has_room_action(p_user_id, p_project_id, p_construction_site_id, 'material_po', 'submit')
          )
          or (
            p_permission_code = 'project.material_direct_purchase.edit'
            and app_private.project_user_has_room_action(p_user_id, p_project_id, p_construction_site_id, 'material_po', 'edit')
          )
          or (
            p_permission_code = 'project.material_direct_purchase.delete'
            and app_private.project_user_has_room_action(p_user_id, p_project_id, p_construction_site_id, 'material_po', 'delete')
          )
          or (
            p_permission_code = 'project.material_direct_purchase.record_ap'
            and app_private.project_user_has_room_action(p_user_id, p_project_id, p_construction_site_id, 'material_po', 'confirm')
          )
        )
      )
    )
  end;
$$;

-- Safety policies retain assignee read/edit behavior, but an assignee must at
-- least hold Room view; all unassigned mutation is Room-authoritative.
create or replace function app_private.safety_can_view(
  p_project_id text, p_construction_site_id text, p_assigned_to_user_id text default null
)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.is_admin()
    or app_private.project_actor_has_effective_room_action(
      public.current_app_user_id(), p_project_id, p_construction_site_id, 'safety', 'view'
    ), false
  );
$$;

create or replace function app_private.safety_can_manage(
  p_project_id text, p_construction_site_id text, p_assigned_to_user_id text default null
)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.is_admin()
    or app_private.project_actor_has_effective_room_action(
      public.current_app_user_id(), p_project_id, p_construction_site_id, 'safety', 'edit'
    )
    or (
      p_assigned_to_user_id = public.current_app_user_id()::text
      and app_private.project_actor_has_effective_room_action(
        public.current_app_user_id(), p_project_id, p_construction_site_id, 'safety', 'view'
      )
    ), false
  );
$$;

create or replace function app_private.safety_can_submit(
  p_project_id text, p_construction_site_id text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.is_admin()
    or app_private.project_actor_has_effective_room_action(
      public.current_app_user_id(), p_project_id, p_construction_site_id, 'safety', 'submit'
    ), false
  );
$$;

create or replace function app_private.safety_can_delete(
  p_project_id text, p_construction_site_id text, p_status text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.is_admin()
    or (
      coalesce(p_status, 'new') in ('draft', 'new')
      and app_private.project_actor_has_effective_room_action(
        public.current_app_user_id(), p_project_id, p_construction_site_id, 'safety', 'delete'
      )
    ), false
  );
$$;

create or replace function app_private.authorization_v2_enforce_safety_issue_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_action := case
    when new.status = 'waiting_verification' then 'submit'
    when new.status in ('resolved', 'rejected') then 'verify'
    when new.status = 'closed' then 'confirm'
    else 'edit'
  end;

  perform app_private.assert_project_permission_room_action(
    new.project_id, new.construction_site_id, 'safety', v_action
  );
  return new;
end;
$$;

revoke all on function app_private.authorization_v2_enforce_safety_issue_status() from public, anon, authenticated;
drop trigger if exists authorization_v2_safety_issue_status_guard on public.safety_issues;
create trigger authorization_v2_safety_issue_status_guard
before update of status on public.safety_issues
for each row execute function app_private.authorization_v2_enforce_safety_issue_status();

-- Make create/read/delete policy decisions for the final finance Rooms direct.
drop policy if exists payment_certificates_insert on public.payment_certificates;
create policy payment_certificates_insert on public.payment_certificates for insert to authenticated
with check (public.is_admin() or app_private.project_has_permission_v2(
  project_id, construction_site_id::text, 'project.payment.create', public.current_app_user_id()
));
drop policy if exists payment_certificates_select on public.payment_certificates;
create policy payment_certificates_select on public.payment_certificates for select to authenticated
using (public.is_admin() or app_private.project_has_permission_v2(
  project_id, construction_site_id::text, 'project.payment.view', public.current_app_user_id()
));
drop policy if exists payment_certificates_delete on public.payment_certificates;
create policy payment_certificates_delete on public.payment_certificates for delete to authenticated
using ((coalesce(status, 'draft') = 'draft' and not ever_submitted) and (
  public.is_admin() or app_private.project_has_permission_v2(
    project_id, construction_site_id::text, 'project.payment.delete_own', public.current_app_user_id()
  )
));
drop policy if exists payment_certificates_update on public.payment_certificates;
create policy payment_certificates_update on public.payment_certificates for update to authenticated
using (
  public.is_admin()
  or app_private.project_has_permission_v2(
    project_id, construction_site_id::text, 'project.payment.edit_all', public.current_app_user_id()
  )
  or (
    submitted_to_user_id = public.current_app_user_id()::text
    and app_private.project_has_permission_v2(
      project_id, construction_site_id::text, 'project.payment.view', public.current_app_user_id()
    )
  )
)
with check (
  public.is_admin()
  or app_private.project_has_permission_v2(
    project_id, construction_site_id::text, 'project.payment.edit_all', public.current_app_user_id()
  )
  or (
    submitted_to_user_id = public.current_app_user_id()::text
    and app_private.project_has_permission_v2(
      project_id, construction_site_id::text, 'project.payment.view', public.current_app_user_id()
    )
  )
);

drop policy if exists quantity_acceptances_insert on public.quantity_acceptances;
create policy quantity_acceptances_insert on public.quantity_acceptances for insert to authenticated
with check (public.is_admin() or app_private.project_has_permission_v2(
  project_id, construction_site_id::text, 'project.quantity_acceptance.create', public.current_app_user_id()
));
drop policy if exists quantity_acceptances_select on public.quantity_acceptances;
create policy quantity_acceptances_select on public.quantity_acceptances for select to authenticated
using (public.is_admin() or app_private.project_has_permission_v2(
  project_id, construction_site_id::text, 'project.quantity_acceptance.view', public.current_app_user_id()
));
drop policy if exists quantity_acceptances_delete on public.quantity_acceptances;
create policy quantity_acceptances_delete on public.quantity_acceptances for delete to authenticated
using ((coalesce(status, 'draft') = 'draft' and not ever_submitted) and (
  public.is_admin() or app_private.project_has_permission_v2(
    project_id, construction_site_id::text, 'project.quantity_acceptance.delete', public.current_app_user_id()
  )
));
drop policy if exists quantity_acceptances_update on public.quantity_acceptances;
create policy quantity_acceptances_update on public.quantity_acceptances for update to authenticated
using (
  public.is_admin()
  or app_private.project_has_permission_v2(
    project_id, construction_site_id::text, 'project.quantity_acceptance.create', public.current_app_user_id()
  )
  or (
    submitted_to_user_id = public.current_app_user_id()::text
    and app_private.project_has_permission_v2(
      project_id, construction_site_id::text, 'project.quantity_acceptance.view', public.current_app_user_id()
    )
  )
)
with check (
  public.is_admin()
  or app_private.project_has_permission_v2(
    project_id, construction_site_id::text, 'project.quantity_acceptance.create', public.current_app_user_id()
  )
  or (
    submitted_to_user_id = public.current_app_user_id()::text
    and app_private.project_has_permission_v2(
      project_id, construction_site_id::text, 'project.quantity_acceptance.view', public.current_app_user_id()
    )
  )
);

do $$
begin
  if exists (
    select 1
    from public.project_permission_rooms room
    join app_private.project_permission_room_action_bindings binding
      on binding.room_code = room.code
     and binding.action_code = any(room.allowed_actions)
    where room.is_active
      and (binding.enforcement_status <> 'enforced' or binding.pbac_fallback_enabled)
  ) then
    raise exception 'Authorization V2 active Room bindings are not fully enforced';
  end if;

  if exists (
    select 1
    from public.project_permission_rooms room
    cross join lateral unnest(room.allowed_actions) action(action_code)
    left join app_private.project_permission_room_action_bindings binding
      on binding.room_code = room.code and binding.action_code = action.action_code
    where room.is_active and binding.room_code is null
  ) then
    raise exception 'Authorization V2 active Room action has no disposition';
  end if;

  if exists (
    select 1
    from public.project_permission_room_members member
    join public.project_staff staff on staff.id = member.project_staff_id
    where member.is_active and staff.end_date is not null
  ) then
    raise exception 'Authorization V2 stale Room member remains after inactive_project_staff reconciliation';
  end if;

  if (select count(*) from app_private.authorization_room_retirement_dispositions) <> 4 then
    raise exception 'Authorization V2 requires retirement evidence for four view-only Rooms';
  end if;
end $$;

insert into app_private.permission_hardening_settings (key, value, updated_at)
values ('project_room_pbac_fallback_enabled', 'false'::jsonb, now())
on conflict (key) do update set value = excluded.value, updated_at = now();

do $$
begin
  if app_private.permission_hardening_flag('project_room_pbac_fallback_enabled') then
    raise exception 'Authorization V2 Room PBAC fallback remained enabled';
  end if;
end $$;
