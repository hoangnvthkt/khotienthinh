-- Đợt 4a — thành viên dự án giữ được phần việc của mình
--
-- Đợt 4 gỡ quyền Dự án phạm vi toàn công ty của cán bộ công trường và nhân
-- viên cơ bản. Trước khi gỡ, người có tên trong project_staff phải tự thấy
-- được những gì chủ SP đã chốt ở dự án mình, kể cả khi họ không có Room:
--   Tài liệu, Tổ chức, Nhà thầu và 5 mục Vật tư
--   (Tổng hợp, Kế hoạch, Phi tiêu chuẩn, Hao hụt, Dashboard).
-- Điều hành, Hợp đồng, Báo cáo, Tài chính vẫn đi qua công tắc xem nhạy cảm.
--
-- Cách làm: thêm một nhánh hẹp vào app_private.project_has_permission_v2 cho
-- đúng danh sách mã quyền XEM ở trên. Mọi cổng đọc đã đi qua hàm này
-- (project_documents_can, material_has_action, custom_material_request_can_select,
-- get_project_material_boq_reconciliation, RLS project_staff, RPC
-- project_has_permissions_v2 mà client dùng) nên không phải vá từng chỗ.

-- 1) Danh sách mã quyền mà thành viên dự án được hưởng, chỉ quyền XEM.
create or replace function app_private.project_member_view_permission_codes()
returns text[]
language sql
immutable
set search_path to ''
as $$
  select array[
    'project.documents.view',      -- tab Tài liệu
    'project.org.view',            -- tab Tổ chức + ô chọn người phụ trách
    'project.subcontract.view',    -- tab Nhà thầu
    'project.material.view',       -- Vật tư: Tổng hợp + Dashboard
    'project.material_plan.view',  -- Vật tư: Kế hoạch
    'project.custom_material.view',-- Vật tư: Phi tiêu chuẩn
    'project.material_waste.view'  -- Vật tư: Hao hụt
  ]::text[];
$$;

comment on function app_private.project_member_view_permission_codes() is
  'Đợt 4a: các mã quyền XEM mà người có tên trong project_staff được hưởng ở dự án mình.';

-- 2) Thành viên đang làm ở dự án, có xét phạm vi công trường như
--    project_actor_has_effective_room_action: dòng nhân sự của họ hoặc không
--    gắn công trường (phụ trách cả dự án), hoặc đúng công trường đang xem.
create or replace function app_private.project_member_is_active_staff(
  p_project_id text,
  p_construction_site_id text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select p_user_id is not null
    and nullif(p_project_id, '') is not null
    and exists (
      select 1
      from public.project_staff staff
      join public.users u on u.id::text = staff.user_id
      where staff.project_id = p_project_id
        and staff.user_id = p_user_id::text
        and staff.end_date is null
        and coalesce(u.is_active, false)
        and (
          nullif(p_construction_site_id, '') is null
          or staff.construction_site_id is null
          or staff.construction_site_id = p_construction_site_id
        )
    );
$$;

comment on function app_private.project_member_is_active_staff(text, text, uuid) is
  'Đợt 4a: người đang làm ở dự án (project_staff còn hiệu lực), xét cả phạm vi công trường.';

-- 3) Nhánh thành viên dự án trong hàm kiểm quyền gốc.
--    Giữ nguyên mọi nhánh cũ; chỉ thêm một nhánh ở cuối phần "else".
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
set search_path to ''
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
      -- Đợt 4a: người có tên trong dự án tự xem được phần đã chốt.
      or (
        p_permission_code = any (app_private.project_member_view_permission_codes())
        and app_private.project_member_is_active_staff(p_project_id, p_construction_site_id, p_user_id)
      )
    )
  end;
$$;

-- 4) Dòng dự toán vật tư (material_budget_items) nuôi 3 mục Tổng hợp, Hao hụt
--    và Dashboard. Chính sách đọc hiện nay chỉ nhìn Room material_planning
--    (pbac_fallback_enabled = false), nên thành viên không có Room sẽ thấy
--    bảng rỗng. Mở thêm đường đọc cho thành viên dự án; quyền sửa / xóa giữ
--    nguyên theo Room.
drop policy if exists material_budget_items_select on public.material_budget_items;

create policy material_budget_items_select on public.material_budget_items
for select to authenticated
using (
  app_private.rls_scope_key(project_id, construction_site_id)
    = any ((select app_private.material_planning_scope_keys(true))::text[])
  or (
    not (
      app_private.rls_scope_key(project_id, construction_site_id)
        = any ((select app_private.material_planning_scope_keys(false))::text[])
    )
    and (
      app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_planning', 'view')
      or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_planning', 'edit')
      or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_planning', 'delete')
    )
  )
  or app_private.project_member_is_active_staff(project_id, construction_site_id)
);


-- 5) Ảnh quyền của phiên: thêm danh sách dự án người đó đang làm, để màn hình
--    biết mở tab Tài liệu / Tổ chức / Nhà thầu / Vật tư mà không phải hỏi
--    máy chủ từng tab. Phần còn lại giữ nguyên như bản đang chạy.
create or replace function app_private.resolve_authorization_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_actor public.users%rowtype;
  v_flags jsonb := '{}'::jsonb;
  v_sources jsonb := '[]'::jsonb;
  v_room_actions jsonb := '[]'::jsonb;
  v_memberships jsonb := '[]'::jsonb;
begin
  select user_row.*
    into v_actor
  from public.users user_row
  where user_row.id = p_user_id
    and user_row.is_active
    and user_row.account_status = 'ACTIVE';

  if v_actor.id is null then
    raise exception 'Active application account required'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(setting_row.key, setting_row.value), '{}'::jsonb)
    into v_flags
  from app_private.permission_hardening_settings setting_row;

  with source_rows as (
    select source_row.*
    from app_private.resolve_effective_permission_sources(
      p_user_id,
      null,
      null,
      null,
      now()
    ) source_row
    where not (
        source_row.permission_code like 'hrm.%'
        and source_row.source_type = 'LEGACY'
      )
      and (
        not app_private.is_hrm_template_only_permission(source_row.permission_code)
        or (
          source_row.source_type = 'ROLE'
          and source_row.source_code in ('HR', 'HR_MANAGE')
        )
        or (
          source_row.source_type = 'ROLE'
          and source_row.source_code = 'HR_VIEWER'
          and app_private.is_hrm_viewer_permission(source_row.permission_code)
        )
      )
    union all
    select manager_source.*
    from app_private.resolve_manager_derived_permission_sources(p_user_id) manager_source
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'permissionCode', source_row.permission_code,
    'sourceType', source_row.source_type,
    'sourceId', source_row.source_id,
    'sourceCode', source_row.source_code,
    'sourceLabel', source_row.source_label,
    'scopeType', source_row.scope_type,
    'scopeId', source_row.scope_id,
    'startsAt', source_row.starts_at,
    'expiresAt', source_row.expires_at,
    'riskLevel', source_row.risk_level,
    'isBusinessApproval', source_row.is_business_approval,
    'metadata', coalesce(source_row.metadata, '{}'::jsonb)
  ) order by
    source_row.permission_code,
    source_row.scope_type,
    source_row.scope_id,
    source_row.source_type,
    source_row.source_id), '[]'::jsonb)
    into v_sources
  from source_rows source_row;

  with candidate_scopes as (
    select distinct
      staff_row.project_id,
      staff_row.construction_site_id
    from public.project_staff staff_row
    where staff_row.user_id = p_user_id::text
      and staff_row.end_date is null
      and staff_row.project_id is not null

    union

    select distinct
      member_row.project_id,
      member_row.construction_site_id
    from public.project_permission_room_members member_row
    join public.project_staff staff_row on staff_row.id = member_row.project_staff_id
    where staff_row.user_id = p_user_id::text
      and staff_row.end_date is null
      and member_row.is_active

    union

    select project_row.id, project_row.construction_site_id::text
    from public.projects project_row
    where v_actor.role = 'ADMIN'

    union

    select project_row.id, null::text
    from public.projects project_row
    where v_actor.role = 'ADMIN'
  ), room_rows as (
    select
      scope_row.project_id,
      scope_row.construction_site_id,
      binding.room_code,
      binding.action_code,
      case
        when v_actor.role = 'ADMIN' then 'admin'
        when binding.enforcement_status in ('pilot', 'enforced')
          and app_private.project_user_has_room_action(
            p_user_id,
            scope_row.project_id,
            scope_row.construction_site_id,
            binding.room_code,
            binding.action_code
          ) then 'room'
        else 'pbac_fallback'
      end as authorization_source,
      binding.enforcement_status,
      binding.pbac_fallback_enabled
    from candidate_scopes scope_row
    cross join app_private.project_permission_room_action_bindings binding
    where app_private.project_actor_has_effective_room_action(
      p_user_id,
      scope_row.project_id,
      scope_row.construction_site_id,
      binding.room_code,
      binding.action_code
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'projectId', room_row.project_id,
    'constructionSiteId', room_row.construction_site_id,
    'roomCode', room_row.room_code,
    'actionCode', room_row.action_code,
    'source', room_row.authorization_source,
    'enforcement', room_row.enforcement_status,
    'fallback', room_row.pbac_fallback_enabled
  ) order by
    room_row.project_id,
    room_row.construction_site_id nulls first,
    room_row.room_code,
    room_row.action_code), '[]'::jsonb)
    into v_room_actions
  from room_rows room_row;

  -- Đợt 4a: dự án người đó đang làm (project_staff còn hiệu lực).
  select coalesce(jsonb_agg(membership_row.entry), '[]'::jsonb)
    into v_memberships
  from (
    select distinct jsonb_build_object(
      'projectId', staff_row.project_id,
      'constructionSiteId', staff_row.construction_site_id
    ) as entry
    from public.project_staff staff_row
    where staff_row.user_id = p_user_id::text
      and staff_row.end_date is null
      and staff_row.project_id is not null
  ) membership_row;

  return jsonb_build_object(
    'generatedAt', now(),
    'flags', v_flags,
    'sources', v_sources,
    'roomActions', v_room_actions,
    'projectMemberships', v_memberships
  );
end;
$$;
