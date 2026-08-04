-- Material PO Room permission pilot.
-- Room is authoritative for six independent actions. Legacy PBAC remains an
-- exact compatibility fallback; project.material_po.manage never implies one
-- of the six actions.

update app_private.project_permission_room_action_bindings
set legacy_permission_codes = case action_code
      when 'view' then array['project.material_po.view']::text[]
      when 'edit' then array['project.material_po.create']::text[]
      when 'delete' then array['project.material_po.delete']::text[]
      when 'submit' then array['project.material_po.create']::text[]
      when 'approve' then array['project.material_po.approve']::text[]
      when 'confirm' then array['project.material_po.receive']::text[]
      else '{}'::text[]
    end,
    enforcement_status = 'pilot',
    relationship_description = case action_code
      when 'view' then 'Xem PO trong đúng project/site.'
      when 'edit' then 'Tạo và sửa PO do chính actor lập ở trạng thái draft/returned.'
      when 'delete' then 'Xóa hoặc lưu trữ PO do chính actor lập.'
      when 'submit' then 'Gửi PO draft/returned do chính actor lập đến recipient Room approve.'
      when 'approve' then 'Duyệt hoặc trả lại PO sent đang được giao cho actor.'
      when 'confirm' then 'Quản lý giao nhận và đóng PO; không thay thế quyền ghi nhận tồn kho WMS.'
      else ''
    end,
    verified_at = now(),
    verified_source = 'material_po_room_pilot_2026_08_04',
    updated_at = now()
where room_code = 'material_po'
  and action_code in ('view', 'edit', 'delete', 'submit', 'approve', 'confirm');

-- Rollback contract: audit_only ignores Room membership while exact mapped
-- PBAC fallback (and System Admin) remains usable when the fallback flag is on.
create or replace function app_private.project_actor_has_effective_room_action(
  p_user_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_room_code text,
  p_action_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with binding as (
    select item.enforcement_status, item.legacy_permission_codes
    from app_private.project_permission_room_action_bindings item
    where item.room_code = p_room_code
      and item.action_code = p_action_code
  ), actor as (
    select user_row.id, user_row.role
    from public.users user_row
    where user_row.id = p_user_id
      and coalesce(user_row.is_active, true)
  ), scoped_actor as (
    select actor.id, actor.role
    from actor
    where actor.role = 'ADMIN'
      or exists (
        select 1
        from public.project_staff staff
        where staff.user_id = actor.id::text
          and staff.project_id = p_project_id
          and staff.end_date is null
          and (
            nullif(p_construction_site_id, '') is null
            or staff.construction_site_id is null
            or staff.construction_site_id = p_construction_site_id
          )
      )
  )
  select exists (
    select 1
    from binding
    cross join scoped_actor
    where scoped_actor.role = 'ADMIN'
      or (
        binding.enforcement_status in ('pilot', 'enforced')
        and app_private.project_user_has_room_action(
          scoped_actor.id,
          p_project_id,
          nullif(p_construction_site_id, ''),
          p_room_code,
          p_action_code
        )
      )
      or (
        app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
        and exists (
          select 1
          from unnest(binding.legacy_permission_codes) legacy(permission_code)
          where app_private.project_has_permission_v2(
            p_project_id,
            nullif(p_construction_site_id, ''),
            legacy.permission_code,
            scoped_actor.id
          )
        )
      )
  );
$$;

revoke all on function app_private.project_actor_has_effective_room_action(uuid, text, text, text, text)
  from public, anon, authenticated;

create or replace function public.get_my_project_room_actions(
  p_project_id text,
  p_construction_site_id text
)
returns table (
  room_code text,
  action_code text,
  authorization_source text,
  enforcement_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (select public.current_app_user_id() as user_id)
  select
    binding.room_code,
    binding.action_code,
    case
      when exists (
        select 1 from public.users user_row
        where user_row.id = actor.user_id
          and coalesce(user_row.is_active, true)
          and user_row.role = 'ADMIN'
      ) then 'admin'
      when binding.enforcement_status in ('pilot', 'enforced')
        and app_private.project_user_has_room_action(
          actor.user_id, p_project_id, nullif(p_construction_site_id, ''),
          binding.room_code, binding.action_code
        ) then 'room'
      else 'pbac_fallback'
    end,
    binding.enforcement_status
  from app_private.project_permission_room_action_bindings binding
  cross join actor
  where app_private.project_actor_has_effective_room_action(
    actor.user_id, p_project_id, nullif(p_construction_site_id, ''),
    binding.room_code, binding.action_code
  )
  order by binding.room_code, binding.action_code;
$$;

revoke all on function public.get_my_project_room_actions(text, text) from public, anon;
grant execute on function public.get_my_project_room_actions(text, text) to authenticated;

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
declare
  v_action_code text := p_action_code;
begin
  if p_user_id is null then
    raise exception 'Không xác định được người dùng đang thao tác.' using errcode = '42501';
  end if;

  if p_room_code = 'material_po'
    and p_action_code = 'submit'
    and current_setting('app.material_po_logistics_context', true) = 'confirm' then
    v_action_code := 'confirm';
  end if;

  if (
    p_room_code = 'material_po'
    and not app_private.project_actor_has_effective_room_action(
      p_user_id, p_project_id, p_construction_site_id, p_room_code, v_action_code
    )
  ) or (
    p_room_code <> 'material_po'
    and not app_private.project_user_has_room_action(
      p_user_id, p_project_id, p_construction_site_id, p_room_code, v_action_code
    )
  ) then
    raise exception 'Bạn chưa có quyền % trong Room % của dự án này.', v_action_code, p_room_code
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.assert_project_permission_room_action(text, text, text, text, uuid)
  from public, anon, authenticated;

create or replace function public.get_my_project_room_pbac_exceptions(
  p_project_id text,
  p_construction_site_id text
)
returns table (room_code text, permission_code text)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select user_row.id as user_id
    from public.users user_row
    where user_row.id = public.current_app_user_id()
      and coalesce(user_row.is_active, true)
      and user_row.role <> 'ADMIN'
  ), exception(room_code, permission_code) as (
    values
      ('daily_log'::text, 'project.daily_log.edit_all'::text),
      ('daily_log'::text, 'project.daily_log.delete_all'::text),
      ('daily_log'::text, 'project.daily_log.return'::text),
      ('daily_log'::text, 'project.daily_log.manage'::text),
      ('daily_log'::text, 'project.daily_log.confirm'::text),
      ('material_po'::text, 'project.material_po.manage'::text)
  )
  select exception.room_code, exception.permission_code
  from actor
  cross join exception
  where app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
    and exists (
      select 1 from public.project_staff staff
      where staff.user_id = actor.user_id::text
        and staff.project_id = p_project_id
        and staff.end_date is null
        and (
          nullif(p_construction_site_id, '') is null
          or staff.construction_site_id is null
          or staff.construction_site_id = p_construction_site_id
        )
    )
    and app_private.project_has_permission_v2(
      p_project_id,
      nullif(p_construction_site_id, ''),
      exception.permission_code,
      actor.user_id
    )
  order by exception.room_code, exception.permission_code;
$$;

revoke all on function public.get_my_project_room_pbac_exceptions(text, text) from public, anon;
grant execute on function public.get_my_project_room_pbac_exceptions(text, text) to authenticated;

-- Overload used by the Drawer so PBAC exceptions are visible even when a
-- scoped staff record has not joined the Room yet.
create or replace function public.list_project_room_staff_candidates(
  p_project_id text,
  p_construction_site_id text,
  p_room_code text
)
returns table (
  project_staff_id uuid,
  user_id uuid,
  user_name text,
  user_avatar text,
  position_name text,
  construction_site_id text,
  legacy_permission_codes text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.assert_project_permission_room_admin();
  select
    staff.id,
    user_row.id,
    user_row.name,
    user_row.avatar,
    position.name,
    staff.construction_site_id,
    coalesce(legacy.codes, '{}'::text[])
  from public.project_staff staff
  join public.users user_row on user_row.id::text = staff.user_id
  left join public.hrm_positions position on position.id = staff.position_id
  left join lateral (
    select array_agg(distinct grant_row.permission_code order by grant_row.permission_code) as codes
    from public.user_permission_grants grant_row
    where grant_row.user_id = user_row.id
      and grant_row.is_active
      and (grant_row.expires_at is null or grant_row.expires_at > now())
      and (
        grant_row.scope_type = 'global'
        or (grant_row.scope_type = 'project' and grant_row.scope_id in ('*', p_project_id))
        or (
          nullif(p_construction_site_id, '') is not null
          and grant_row.scope_type = 'construction_site'
          and grant_row.scope_id in ('*', p_construction_site_id)
        )
      )
      and (
        (p_room_code = 'material_po' and grant_row.permission_code = 'project.material_po.manage')
        or (p_room_code = 'daily_log' and grant_row.permission_code in (
          'project.daily_log.edit_all', 'project.daily_log.delete_all',
          'project.daily_log.return', 'project.daily_log.manage', 'project.daily_log.confirm'
        ))
      )
  ) legacy on true
  where staff.project_id = p_project_id
    and staff.end_date is null
    and coalesce(user_row.is_active, true)
    and (
      nullif(p_construction_site_id, '') is null
      or staff.construction_site_id is null
      or staff.construction_site_id = p_construction_site_id
    )
  order by user_row.name, staff.id;
$$;

revoke all on function public.list_project_room_staff_candidates(text, text, text) from public, anon;
grant execute on function public.list_project_room_staff_candidates(text, text, text) to authenticated;

-- Safe-union backfill: exact project/site grants with one active staff row.
create temporary table material_po_room_backfill_candidates on commit drop as
with permission_mapping(permission_code, action_code) as (
  values
    ('project.material_po.view', 'view'),
    ('project.material_po.create', 'edit'),
    ('project.material_po.create', 'submit'),
    ('project.material_po.delete', 'delete'),
    ('project.material_po.approve', 'approve'),
    ('project.material_po.receive', 'confirm')
), candidates as (
  select
    grant_row.id as grant_id,
    grant_row.user_id,
    grant_row.granted_by,
    staff.id as project_staff_id,
    staff.project_id,
    case when grant_row.scope_type = 'construction_site' then staff.construction_site_id else null end as construction_site_id,
    mapping.action_code,
    count(*) over (partition by grant_row.id, mapping.action_code) as matching_staff_count
  from public.user_permission_grants grant_row
  join permission_mapping mapping on mapping.permission_code = grant_row.permission_code
  join public.users user_row on user_row.id = grant_row.user_id and coalesce(user_row.is_active, true)
  join public.project_staff staff
    on staff.user_id = grant_row.user_id::text
    and staff.end_date is null
    and (
      (grant_row.scope_type = 'project' and grant_row.scope_id = staff.project_id and staff.construction_site_id is null)
      or (grant_row.scope_type = 'construction_site' and grant_row.scope_id = staff.construction_site_id)
    )
  where grant_row.is_active
    and (grant_row.expires_at is null or grant_row.expires_at > now())
    and grant_row.scope_type in ('project', 'construction_site')
    and user_row.role <> 'ADMIN'
)
select distinct user_id, granted_by, project_staff_id, project_id,
  construction_site_id, action_code
from candidates
where matching_staff_count = 1;

insert into public.project_permission_room_members (
  project_id, construction_site_id, room_code, project_staff_id,
  is_active, created_by, updated_at
)
select distinct project_id, construction_site_id, 'material_po', project_staff_id,
  true, granted_by, now()
from material_po_room_backfill_candidates
on conflict (project_id, (coalesce(construction_site_id, '')), room_code, project_staff_id)
do update set is_active = true, updated_at = now();

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, granted_by, granted_at, updated_at
)
select distinct member.id, candidate.action_code, true, candidate.granted_by, now(), now()
from material_po_room_backfill_candidates candidate
join public.project_permission_room_members member
  on member.project_id = candidate.project_id
  and member.construction_site_id is not distinct from candidate.construction_site_id
  and member.room_code = 'material_po'
  and member.project_staff_id = candidate.project_staff_id
on conflict (room_member_id, action_code)
do update set is_active = true, updated_at = now();

insert into public.permission_audit_events (
  actor_user_id, event_type, before_grants, after_grants, metadata
)
select null, 'project_room_pbac_backfill', '[]'::jsonb,
  coalesce(jsonb_agg(jsonb_build_object(
    'user_id', candidate.user_id,
    'project_staff_id', candidate.project_staff_id,
    'project_id', candidate.project_id,
    'construction_site_id', candidate.construction_site_id,
    'room_code', 'material_po',
    'action_code', candidate.action_code
  )), '[]'::jsonb),
  jsonb_build_object(
    'source', 'project_room_pbac_backfill',
    'room_code', 'material_po',
    'row_count', count(*)
  )
from material_po_room_backfill_candidates candidate;

create or replace function app_private.material_has_action(
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
  select case
    when p_permission_code = 'project.material_po.view' then
      app_private.project_actor_has_effective_room_action(
        p_user_id, p_project_id, p_construction_site_id, 'material_po', 'view'
      )
    when p_permission_code = 'project.material_po.create' then
      app_private.project_actor_has_effective_room_action(
        p_user_id, p_project_id, p_construction_site_id, 'material_po', 'edit'
      )
    when p_permission_code = 'project.material_po.delete' then
      app_private.project_actor_has_effective_room_action(
        p_user_id, p_project_id, p_construction_site_id, 'material_po', 'delete'
      )
    when p_permission_code = 'project.material_po.approve' then
      app_private.project_actor_has_effective_room_action(
        p_user_id, p_project_id, p_construction_site_id, 'material_po', 'approve'
      )
    when p_permission_code = 'project.material_po.receive' then
      app_private.project_actor_has_effective_room_action(
        p_user_id, p_project_id, p_construction_site_id, 'material_po', 'confirm'
      )
    when p_permission_code = 'project.material_po.manage' then
      public.is_admin()
      or (
        app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
        and app_private.project_has_permission_v2(
          p_project_id, p_construction_site_id, p_permission_code, p_user_id
        )
      )
    else
      (
        p_permission_code like 'project.material%'
        or p_permission_code like 'project.custom_material.%'
      )
      and (
        public.is_admin()
        or public.is_module_admin('DA')
        or app_private.project_has_permission_v2(
          p_project_id, p_construction_site_id, p_permission_code, p_user_id
        )
      )
  end;
$$;

revoke all on function app_private.material_has_action(text, text, text, uuid) from public, anon;
grant execute on function app_private.material_has_action(text, text, text, uuid) to authenticated;

drop policy if exists purchase_orders_archive_update on public.purchase_orders;
drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select
  on public.purchase_orders
  for select
  to authenticated
  using (
    archived_at is null
    and (
      source_mode = 'company_consolidated' and (
        app_private.company_procurement_can_manage()
        or app_private.company_purchase_order_can_view_from_links(id)
      )
      or source_mode is distinct from 'company_consolidated' and (
        app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_po', 'view')
        or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_po', 'edit')
        or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_po', 'delete')
        or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_po', 'submit')
        or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_po', 'approve')
        or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_po', 'confirm')
        or app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
      )
    )
  );

drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert
  on public.purchase_orders
  for insert
  to authenticated
  with check (
    source_mode = 'company_consolidated' and app_private.company_procurement_can_manage()
    or source_mode is distinct from 'company_consolidated' and (
      app_private.current_actor_has_effective_room_action(
        project_id, construction_site_id, 'material_po', 'edit'
      )
      and nullif(created_by_id, '') = public.current_app_user_id()::text
      and status = 'draft'
    )
  );

drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update
  on public.purchase_orders
  for update
  to authenticated
  using (
    archived_at is null
    and (
      source_mode = 'company_consolidated' and app_private.company_procurement_can_manage()
      or source_mode is distinct from 'company_consolidated' and (
        app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_po', 'edit')
        or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_po', 'approve')
        or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_po', 'confirm')
        or app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
      )
    )
  )
  with check (
    archived_at is null
    and (
      source_mode = 'company_consolidated' and app_private.company_procurement_can_manage()
      or source_mode is distinct from 'company_consolidated' and (
        app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_po', 'edit')
        or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_po', 'approve')
        or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_po', 'confirm')
        or app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
      )
    )
  );

drop policy if exists purchase_orders_delete on public.purchase_orders;
create policy purchase_orders_delete
  on public.purchase_orders
  for delete
  to authenticated
  using (false);

create or replace function app_private.guard_project_purchase_order_room_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_is_admin boolean := public.is_admin();
  v_workflow_changed boolean;
begin
  if v_actor is null and session_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then
    if old.source_mode = 'company_consolidated' or v_is_admin then return old; end if;
    if v_actor is null
      or nullif(old.created_by_id, '') <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, old.project_id, old.construction_site_id, 'material_po', 'delete'
      ) then
      raise exception 'Bạn phải là người tạo PO và có quyền Xóa trong Room Đơn hàng PO.'
        using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.source_mode = 'company_consolidated' then return new; end if;
    if v_is_admin then return new; end if;
    if v_actor is null
      or new.status <> 'draft'
      or nullif(new.created_by_id, '') <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, new.project_id, new.construction_site_id, 'material_po', 'edit'
      ) then
      raise exception 'Bạn cần quyền Sửa và phải là người tạo PO nháp.' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.source_mode = 'company_consolidated' and new.source_mode = 'company_consolidated' then
    return new;
  end if;
  if v_is_admin then return new; end if;
  if v_actor is null then
    raise exception 'Không xác định được người thao tác PO.' using errcode = '42501';
  end if;
  if new.project_id is distinct from old.project_id
    or new.construction_site_id is distinct from old.construction_site_id
    or new.created_by_id is distinct from old.created_by_id
    or new.source_mode is distinct from old.source_mode then
    raise exception 'Không được thay đổi scope, nguồn hoặc người tạo PO.' using errcode = '42501';
  end if;

  if new.archived_at is distinct from old.archived_at then
    if nullif(old.created_by_id, '') <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, old.project_id, old.construction_site_id, 'material_po', 'delete'
      ) then
      raise exception 'Bạn phải là người tạo PO và có quyền Xóa trong Room Đơn hàng PO.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  v_workflow_changed := new.status is distinct from old.status
    or new.submitted_to_user_id is distinct from old.submitted_to_user_id
    or new.submitted_to_name is distinct from old.submitted_to_name
    or new.submitted_to_permission is distinct from old.submitted_to_permission
    or new.submission_note is distinct from old.submission_note
    or new.received_transaction_ids is distinct from old.received_transaction_ids
    or new.actual_delivery_date is distinct from old.actual_delivery_date;

  if old.status in ('draft', 'returned') and new.status = 'sent' then
    if nullif(old.created_by_id, '') <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, old.project_id, old.construction_site_id, 'material_po', 'submit'
      ) then
      raise exception 'Bạn phải là người tạo PO và có quyền Gửi.' using errcode = '42501';
    end if;
    if new.submitted_to_user_id is null
      or not app_private.project_user_has_room_action(
        new.submitted_to_user_id::uuid,
        old.project_id,
        old.construction_site_id,
        'material_po',
        'approve'
      ) then
      raise exception 'Người nhận phải có quyền Duyệt thuần trong Room Đơn hàng PO.' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'sent' and new.status in ('confirmed', 'returned') then
    if old.submitted_to_user_id is null
      or old.submitted_to_user_id::text <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, old.project_id, old.construction_site_id, 'material_po', 'approve'
      ) then
      raise exception 'Bạn cần quyền Duyệt và phải là người được giao xử lý PO.' using errcode = '42501';
    end if;
    if new.status = 'returned' and (
      new.submitted_to_user_id is not null
      or new.submitted_to_name is not null
      or new.submitted_to_permission is not null
    ) then
      raise exception 'PO Trả lại phải xóa assignment duyệt cũ.' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_workflow_changed then
    if new.status = 'cancelled' then
      if not (
        app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(old.target_warehouse_id)
      ) then
        raise exception 'Chỉ System Admin hoặc Thủ kho được hủy PO.' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.status in ('confirmed', 'in_transit', 'partial', 'delivered', 'closed')
      or old.status in ('confirmed', 'in_transit', 'partial', 'delivered') then
      if not (
        app_private.project_actor_has_effective_room_action(
          v_actor, old.project_id, old.construction_site_id, 'material_po', 'confirm'
        )
        or app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(old.target_warehouse_id)
      ) then
        raise exception 'Bạn cần quyền Xác nhận để quản lý giao nhận PO.' using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'Transition PO không hợp lệ.' using errcode = '42501';
  end if;

  if app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(old.target_warehouse_id) then
    return new;
  end if;
  if current_setting('app.material_transition_context', true) = 'on'
    and (
      new.supplemental_approval_status is distinct from old.supplemental_approval_status
      or new.approved_total_amount is distinct from old.approved_total_amount
    )
    and app_private.project_actor_has_effective_room_action(
      v_actor, old.project_id, old.construction_site_id, 'material_po', 'approve'
    ) then
    return new;
  end if;
  if old.status not in ('draft', 'returned')
    or new.status not in ('draft', 'returned')
    or nullif(old.created_by_id, '') <> v_actor::text
    or not app_private.project_actor_has_effective_room_action(
      v_actor, old.project_id, old.construction_site_id, 'material_po', 'edit'
    ) then
    raise exception 'Chỉ người tạo có quyền Sửa mới được sửa PO draft/returned.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_project_purchase_order_room_write()
  from public, anon, authenticated;

drop trigger if exists guard_project_purchase_order_room_write on public.purchase_orders;
create trigger guard_project_purchase_order_room_write
  before insert or update or delete on public.purchase_orders
  for each row execute function app_private.guard_project_purchase_order_room_write();

create or replace function public.transition_project_purchase_order_status(
  p_po_id text,
  p_status text,
  p_patch jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_target_status text;
  v_target_user_id uuid;
  v_previous_guard text;
  v_is_wms_actor boolean;
begin
  if v_user_id is null then
    raise exception 'Không xác định được người dùng chuyển trạng thái PO.' using errcode = '42501';
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then raise exception 'Không tìm thấy PO.'; end if;

  v_target_status := coalesce(nullif(p_status, ''), v_po.status);
  v_is_wms_actor := public.is_admin()
    or app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(v_po.target_warehouse_id);

  if coalesce(v_po.source_mode, 'project') = 'company_consolidated' then
    if not (
      public.is_admin()
      or app_private.company_procurement_can_manage()
      or v_is_wms_actor
    ) then
      raise exception 'Bạn không có quyền chuyển trạng thái PO tổng hợp công ty.' using errcode = '42501';
    end if;
  elsif public.is_admin() then
    null;
  elsif v_target_status = 'sent' then
    if v_po.status not in ('draft', 'returned')
      or nullif(v_po.created_by_id, '') <> v_user_id::text
      or not app_private.project_actor_has_effective_room_action(
        v_user_id, v_po.project_id, v_po.construction_site_id, 'material_po', 'submit'
      ) then
      raise exception 'Chỉ người tạo có quyền Gửi mới được gửi PO draft/returned.' using errcode = '42501';
    end if;
    v_target_user_id := nullif(p_patch->>'submitted_to_user_id', '')::uuid;
    if v_target_user_id is null
      or not app_private.project_user_has_room_action(
        v_target_user_id, v_po.project_id, v_po.construction_site_id, 'material_po', 'approve'
      ) then
      raise exception 'Người nhận phải có quyền Duyệt thuần trong Room Đơn hàng PO.' using errcode = '42501';
    end if;
  elsif v_target_status in ('confirmed', 'returned') then
    if v_po.status <> 'sent'
      or v_po.submitted_to_user_id is null
      or v_po.submitted_to_user_id::text <> v_user_id::text
      or not app_private.project_actor_has_effective_room_action(
        v_user_id, v_po.project_id, v_po.construction_site_id, 'material_po', 'approve'
      ) then
      raise exception 'Bạn cần quyền Duyệt và phải là người được giao xử lý PO.' using errcode = '42501';
    end if;
  elsif p_patch ? 'received_transaction_ids' or p_patch ? 'actual_delivery_date' then
    if not v_is_wms_actor then
      raise exception 'Quyền Xác nhận PO không thay thế quyền ghi nhận tồn kho WMS.' using errcode = '42501';
    end if;
  elsif v_target_status in ('in_transit', 'partial', 'delivered', 'closed') then
    if not (
      v_is_wms_actor
      or app_private.project_actor_has_effective_room_action(
        v_user_id, v_po.project_id, v_po.construction_site_id, 'material_po', 'confirm'
      )
    ) then
      raise exception 'Bạn cần quyền Xác nhận để quản lý giao nhận PO.' using errcode = '42501';
    end if;
  elsif v_target_status = 'cancelled' then
    if not v_is_wms_actor then
      raise exception 'Chỉ System Admin hoặc Thủ kho được hủy PO.' using errcode = '42501';
    end if;
  else
    raise exception 'Transition PO từ % sang % không hợp lệ.', v_po.status, v_target_status
      using errcode = '42501';
  end if;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.purchase_orders
  set
    status = v_target_status,
    submitted_to_user_id = case
      when v_target_status = 'returned' then null
      when p_patch ? 'submitted_to_user_id' then nullif(p_patch->>'submitted_to_user_id', '')
      else submitted_to_user_id
    end,
    submitted_to_name = case
      when v_target_status = 'returned' then null
      when p_patch ? 'submitted_to_name' then nullif(p_patch->>'submitted_to_name', '')
      else submitted_to_name
    end,
    submitted_to_permission = case
      when v_target_status = 'returned' then null
      when p_patch ? 'submitted_to_permission' then nullif(p_patch->>'submitted_to_permission', '')
      else submitted_to_permission
    end,
    submission_note = case
      when p_patch ? 'submission_note' then nullif(p_patch->>'submission_note', '')
      else submission_note
    end,
    ever_submitted = case
      when p_patch ? 'ever_submitted' then coalesce((p_patch->>'ever_submitted')::boolean, ever_submitted)
      else ever_submitted
    end,
    last_action_by = v_user_id::text,
    last_action_at = now(),
    received_transaction_ids = case
      when p_patch ? 'received_transaction_ids' then coalesce(p_patch->'received_transaction_ids', '[]'::jsonb)
      else received_transaction_ids
    end,
    actual_delivery_date = case
      when p_patch ? 'actual_delivery_date' then nullif(p_patch->>'actual_delivery_date', '')
      else actual_delivery_date
    end
  where id = p_po_id;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$$;

revoke all on function public.transition_project_purchase_order_status(text, text, jsonb) from public, anon;
grant execute on function public.transition_project_purchase_order_status(text, text, jsonb) to authenticated;

-- Logistics commands used to reuse Room submit. Public wrappers now establish
-- an internal confirm context; private implementations are no longer directly
-- executable by authenticated clients.
revoke execute on function app_private.create_delivery_batch_with_wms_qr_v2(
  text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) from authenticated;

create or replace function public.create_delivery_batch_with_wms_qr_v2(
  p_purchase_order_id text,
  p_idempotency_key uuid,
  p_supplier_id text,
  p_supplier_name text,
  p_fulfillment_mode text,
  p_vat_rate numeric,
  p_target_warehouse_id text,
  p_planned_delivery_date date default null,
  p_note text default null,
  p_actor_user_id uuid default null,
  p_lines jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
  v_previous_context text;
  v_result jsonb;
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  v_previous_context := current_setting('app.material_po_logistics_context', true);
  perform set_config('app.material_po_logistics_context', 'confirm', true);
  v_result := app_private.create_delivery_batch_with_wms_qr_v2(
    p_purchase_order_id, p_idempotency_key, p_supplier_id, p_supplier_name,
    p_fulfillment_mode, p_vat_rate, p_target_warehouse_id,
    p_planned_delivery_date, p_note, v_actor, p_lines
  );
  perform set_config('app.material_po_logistics_context', coalesce(v_previous_context, ''), true);
  return v_result;
exception when others then
  perform set_config('app.material_po_logistics_context', coalesce(v_previous_context, ''), true);
  raise;
end;
$$;

revoke all on function public.create_delivery_batch_with_wms_qr_v2(
  text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) from public, anon;
grant execute on function public.create_delivery_batch_with_wms_qr_v2(
  text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) to authenticated;

revoke execute on function app_private.update_unreceived_delivery_batch_v2(
  uuid, text, text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) from authenticated;

create or replace function public.update_unreceived_delivery_batch_v2(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
  p_purchase_order_id text,
  p_idempotency_key uuid,
  p_supplier_id text,
  p_supplier_name text,
  p_fulfillment_mode text,
  p_vat_rate numeric,
  p_target_warehouse_id text,
  p_planned_delivery_date date default null,
  p_note text default null,
  p_actor_user_id uuid default null,
  p_lines jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
  v_previous_context text;
  v_result jsonb;
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  v_previous_context := current_setting('app.material_po_logistics_context', true);
  perform set_config('app.material_po_logistics_context', 'confirm', true);
  v_result := app_private.update_unreceived_delivery_batch_v2(
    p_delivery_batch_id, p_wms_transaction_id, p_purchase_order_id,
    p_idempotency_key, p_supplier_id, p_supplier_name, p_fulfillment_mode,
    p_vat_rate, p_target_warehouse_id, p_planned_delivery_date, p_note,
    v_actor, p_lines
  );
  perform set_config('app.material_po_logistics_context', coalesce(v_previous_context, ''), true);
  return v_result;
exception when others then
  perform set_config('app.material_po_logistics_context', coalesce(v_previous_context, ''), true);
  raise;
end;
$$;

revoke all on function public.update_unreceived_delivery_batch_v2(
  uuid, text, text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) from public, anon;
grant execute on function public.update_unreceived_delivery_batch_v2(
  uuid, text, text, uuid, text, text, text, numeric, text, date, text, uuid, jsonb
) to authenticated;

revoke execute on function app_private.cancel_unreceived_delivery_batch_v2(uuid, uuid, text)
  from authenticated;

create or replace function public.cancel_unreceived_delivery_batch_v2(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid default null,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
  v_previous_context text;
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  v_previous_context := current_setting('app.material_po_logistics_context', true);
  perform set_config('app.material_po_logistics_context', 'confirm', true);
  perform app_private.cancel_unreceived_delivery_batch_v2(p_delivery_batch_id, v_actor, p_reason);
  perform set_config('app.material_po_logistics_context', coalesce(v_previous_context, ''), true);
exception when others then
  perform set_config('app.material_po_logistics_context', coalesce(v_previous_context, ''), true);
  raise;
end;
$$;

revoke all on function public.cancel_unreceived_delivery_batch_v2(uuid, uuid, text) from public, anon;
grant execute on function public.cancel_unreceived_delivery_batch_v2(uuid, uuid, text) to authenticated;

revoke execute on function app_private.close_purchase_package_short_v2(text, uuid, text, jsonb)
  from authenticated;

create or replace function public.close_purchase_package_short_v2(
  p_purchase_order_id text,
  p_actor_user_id uuid default null,
  p_reason text default null,
  p_lines jsonb default '[]'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
  v_previous_context text;
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  v_previous_context := current_setting('app.material_po_logistics_context', true);
  perform set_config('app.material_po_logistics_context', 'confirm', true);
  perform app_private.close_purchase_package_short_v2(
    p_purchase_order_id, v_actor, p_reason, p_lines
  );
  perform set_config('app.material_po_logistics_context', coalesce(v_previous_context, ''), true);
exception when others then
  perform set_config('app.material_po_logistics_context', coalesce(v_previous_context, ''), true);
  raise;
end;
$$;

revoke all on function public.close_purchase_package_short_v2(text, uuid, text, jsonb) from public, anon;
grant execute on function public.close_purchase_package_short_v2(text, uuid, text, jsonb) to authenticated;

create or replace function app_private.purchase_order_delivery_can_mutate(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and (
          app_private.current_user_is_wms_keeper_for(po.target_warehouse_id)
          or app_private.project_actor_has_effective_room_action(
            public.current_app_user_id(), po.project_id, po.construction_site_id,
            'material_po', 'confirm'
          )
          or (
            po.status in ('draft', 'returned')
            and nullif(po.created_by_id, '') = public.current_app_user_id()::text
            and app_private.project_actor_has_effective_room_action(
              public.current_app_user_id(), po.project_id, po.construction_site_id,
              'material_po', 'edit'
            )
          )
        )
    );
$$;

revoke all on function app_private.purchase_order_delivery_can_mutate(text) from public, anon;
grant execute on function app_private.purchase_order_delivery_can_mutate(text) to authenticated;

create or replace function app_private.guard_purchase_order_delivery_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_app_user_id() is null and session_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  if not app_private.purchase_order_delivery_can_mutate(old.purchase_order_id) then
    raise exception 'Bạn cần quyền Xác nhận để xoá đợt giao của PO đã duyệt.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function app_private.guard_purchase_order_delivery_delete()
  from public, anon, authenticated;

drop trigger if exists guard_purchase_order_delivery_batch_delete
  on public.purchase_order_delivery_batches;
create trigger guard_purchase_order_delivery_batch_delete
  before delete on public.purchase_order_delivery_batches
  for each row execute function app_private.guard_purchase_order_delivery_delete();

drop trigger if exists guard_purchase_order_delivery_group_delete
  on public.purchase_order_delivery_groups;
create trigger guard_purchase_order_delivery_group_delete
  before delete on public.purchase_order_delivery_groups
  for each row execute function app_private.guard_purchase_order_delivery_delete();

create or replace function app_private.purchase_order_can_receive(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and (
          app_private.current_user_is_wms_keeper_for(po.target_warehouse_id)
          or app_private.project_actor_has_effective_room_action(
            public.current_app_user_id(), po.project_id, po.construction_site_id,
            'material_po', 'confirm'
          )
        )
    );
$$;

revoke all on function app_private.purchase_order_can_receive(text) from public, anon;
grant execute on function app_private.purchase_order_can_receive(text) to authenticated;

create or replace function app_private.purchase_order_supplemental_can_create(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
    from public.purchase_orders po
    where po.id = p_purchase_order_id
      and (
        (
          po.status in ('draft', 'returned')
          and nullif(po.created_by_id, '') = public.current_app_user_id()::text
          and app_private.project_actor_has_effective_room_action(
            public.current_app_user_id(), po.project_id, po.construction_site_id,
            'material_po', 'edit'
          )
        )
        or (
          po.status in ('confirmed', 'in_transit', 'partial')
          and app_private.project_actor_has_effective_room_action(
            public.current_app_user_id(), po.project_id, po.construction_site_id,
            'material_po', 'confirm'
          )
        )
      )
  );
$$;

create or replace function app_private.purchase_order_supplemental_can_approve(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
    from public.purchase_orders po
    join public.purchase_order_supplemental_approvals approval
      on approval.purchase_order_id = po.id
    where po.id = p_purchase_order_id
      and approval.status = 'pending'
      and approval.submitted_to_user_id = public.current_app_user_id()::text
      and app_private.project_actor_has_effective_room_action(
        public.current_app_user_id(), po.project_id, po.construction_site_id,
        'material_po', 'approve'
      )
  );
$$;

revoke all on function app_private.purchase_order_supplemental_can_create(text) from public, anon;
revoke all on function app_private.purchase_order_supplemental_can_approve(text) from public, anon;
grant execute on function app_private.purchase_order_supplemental_can_create(text) to authenticated;
grant execute on function app_private.purchase_order_supplemental_can_approve(text) to authenticated;

create or replace function app_private.guard_purchase_order_supplemental_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_actor uuid := public.current_app_user_id();
begin
  if tg_op <> 'UPDATE' or new.status is not distinct from old.status then return new; end if;
  if public.is_admin() then return new; end if;
  select * into v_po from public.purchase_orders where id = old.purchase_order_id;
  if not found
    or old.status <> 'pending'
    or new.status not in ('approved', 'rejected')
    or old.submitted_to_user_id is null
    or old.submitted_to_user_id <> v_actor::text
    or not app_private.project_actor_has_effective_room_action(
      v_actor, v_po.project_id, v_po.construction_site_id, 'material_po', 'approve'
    )
    or (new.status = 'approved' and nullif(new.approved_by, '') <> v_actor::text)
    or (new.status = 'rejected' and nullif(new.rejected_by, '') <> v_actor::text) then
    raise exception 'Bạn cần quyền Duyệt và phải là người được giao duyệt bổ sung PO.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_purchase_order_supplemental_assignment()
  from public, anon, authenticated;

drop trigger if exists guard_purchase_order_supplemental_assignment
  on public.purchase_order_supplemental_approvals;
create trigger guard_purchase_order_supplemental_assignment
  before update on public.purchase_order_supplemental_approvals
  for each row execute function app_private.guard_purchase_order_supplemental_assignment();

notify pgrst, 'reload schema';
