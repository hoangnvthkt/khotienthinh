-- Hiệu năng module Dự án (audit 11/10/2026): RLS kiểm quyền theo từng dòng.
--
-- Policy SELECT của BOQ vật tư, BOQ công tác, công việc Gantt và nhật ký gọi hàm kiểm quyền
-- phòng dự án cho MỖI dòng (≈0,84 ms/lần). Đọc BOQ DA29 (362 dòng) mất 0,65–0,69 s với người
-- dùng thường; đọc công việc mọi công trường mất 0,9–1,5 s. Trong khi đó dữ liệu chỉ có 3–5 cặp
-- (dự án, công trường) khác nhau.
--
-- Sửa: kiểm quyền một lần cho mỗi cặp (dự án, công trường) rồi so khóa, Postgres chạy dưới dạng
-- InitPlan một lần/câu lệnh (cùng mẫu với project_tx_select).
--
-- Giữ đúng nghĩa cũ:
--   * Cặp đã có trong bảng: kết quả là chính hàm cũ với đúng tham số đó (không đổi luật quyền).
--   * Cặp chưa có trong bảng (dòng vừa chèn, INSERT … RETURNING): rơi về biểu thức cũ theo dòng.
-- Policy INSERT/UPDATE/DELETE và chốt RESTRICTIVE active_actor_gate không đổi.

-- Khóa (dự án, công trường) phân biệt NULL với chuỗi rỗng, có tiền tố độ dài nên không trùng.
-- SQL thuần, IMMUTABLE, không SECURITY DEFINER để Postgres inline trong policy.
create or replace function app_private.rls_scope_key(p_project_id text, p_construction_site_id text)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(pg_catalog.length(p_project_id)::text || ':' || p_project_id, '-')
    || '|'
    || coalesce(pg_catalog.length(p_construction_site_id)::text || ':' || p_construction_site_id, '-');
$$;

-- BOQ vật tư + BOQ công tác: phòng material_planning, có view/edit/delete là được xem.
create or replace function app_private.material_planning_scope_keys(p_allowed_only boolean)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with scopes as materialized (
    select item.project_id, item.construction_site_id from public.material_budget_items item
    union
    select item.project_id, item.construction_site_id from public.project_work_boq_items item
  )
  select coalesce(pg_catalog.array_agg(app_private.rls_scope_key(scopes.project_id, scopes.construction_site_id)), '{}'::text[])
  from scopes
  where not p_allowed_only
     or app_private.current_actor_has_effective_room_action(scopes.project_id, scopes.construction_site_id, 'material_planning', 'view')
     or app_private.current_actor_has_effective_room_action(scopes.project_id, scopes.construction_site_id, 'material_planning', 'edit')
     or app_private.current_actor_has_effective_room_action(scopes.project_id, scopes.construction_site_id, 'material_planning', 'delete');
$$;

-- Công việc Gantt: phòng gantt, quyền view.
create or replace function app_private.gantt_view_scope_keys(p_allowed_only boolean)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with scopes as materialized (
    select distinct task.project_id, task.construction_site_id from public.project_tasks task
  )
  select coalesce(pg_catalog.array_agg(app_private.rls_scope_key(scopes.project_id, scopes.construction_site_id)), '{}'::text[])
  from scopes
  where not p_allowed_only
     or app_private.project_gantt_can_view(scopes.project_id, scopes.construction_site_id);
$$;

-- Nhật ký: daily_log_can_select theo người đang đăng nhập.
create or replace function app_private.daily_log_select_scope_keys(p_allowed_only boolean)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with scopes as materialized (
    select distinct log.project_id, log.construction_site_id from public.daily_logs log
  )
  select coalesce(pg_catalog.array_agg(app_private.rls_scope_key(scopes.project_id, scopes.construction_site_id)), '{}'::text[])
  from scopes
  where not p_allowed_only
     or app_private.daily_log_can_select(scopes.project_id, scopes.construction_site_id, public.current_app_user_id());
$$;

revoke all on function app_private.rls_scope_key(text, text) from public, anon;
revoke all on function app_private.material_planning_scope_keys(boolean) from public, anon;
revoke all on function app_private.gantt_view_scope_keys(boolean) from public, anon;
revoke all on function app_private.daily_log_select_scope_keys(boolean) from public, anon;
grant execute on function app_private.rls_scope_key(text, text) to authenticated;
grant execute on function app_private.material_planning_scope_keys(boolean) to authenticated;
grant execute on function app_private.gantt_view_scope_keys(boolean) to authenticated;
grant execute on function app_private.daily_log_select_scope_keys(boolean) to authenticated;

alter policy material_budget_items_select on public.material_budget_items
using (
  app_private.rls_scope_key(project_id, construction_site_id) = any ((select app_private.material_planning_scope_keys(true))::text[])
  or (
    not (app_private.rls_scope_key(project_id, construction_site_id) = any ((select app_private.material_planning_scope_keys(false))::text[]))
    and (
      app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_planning'::text, 'view'::text)
      or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_planning'::text, 'edit'::text)
      or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_planning'::text, 'delete'::text)
    )
  )
);

alter policy project_work_boq_items_select on public.project_work_boq_items
using (
  app_private.rls_scope_key(project_id, construction_site_id) = any ((select app_private.material_planning_scope_keys(true))::text[])
  or (
    not (app_private.rls_scope_key(project_id, construction_site_id) = any ((select app_private.material_planning_scope_keys(false))::text[]))
    and (
      app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_planning'::text, 'view'::text)
      or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_planning'::text, 'edit'::text)
      or app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_planning'::text, 'delete'::text)
    )
  )
);

alter policy project_tasks_gantt_view on public.project_tasks
using (
  app_private.rls_scope_key(project_id, construction_site_id) = any ((select app_private.gantt_view_scope_keys(true))::text[])
  or (
    not (app_private.rls_scope_key(project_id, construction_site_id) = any ((select app_private.gantt_view_scope_keys(false))::text[]))
    and app_private.project_gantt_can_view(project_id, construction_site_id)
  )
);

alter policy daily_logs_select on public.daily_logs
using (
  app_private.rls_scope_key(project_id, construction_site_id) = any ((select app_private.daily_log_select_scope_keys(true))::text[])
  or (
    not (app_private.rls_scope_key(project_id, construction_site_id) = any ((select app_private.daily_log_select_scope_keys(false))::text[]))
    and app_private.daily_log_can_select(project_id, construction_site_id, current_app_user_id())
  )
);

-- Nhân công / máy của nhật ký: nhánh theo daily_logs dùng cùng khóa thay cho gọi hàm theo dòng.
alter policy daily_log_labor_select on public.daily_log_labor
using (
  (
    contribution_id is not null
    and exists (
      select 1 from public.daily_log_contributions contribution
      where contribution.id = daily_log_labor.contribution_id
        and app_private.daily_log_contribution_can_view(contribution.project_id, contribution.construction_site_id, contribution.author_user_id, contribution.submitted_to_user_id)
    )
  )
  or (
    daily_log_id is not null
    and exists (
      select 1 from public.daily_logs log
      where log.id = daily_log_labor.daily_log_id
        and (
          app_private.rls_scope_key(log.project_id, log.construction_site_id) = any ((select app_private.daily_log_select_scope_keys(true))::text[])
          or (
            not (app_private.rls_scope_key(log.project_id, log.construction_site_id) = any ((select app_private.daily_log_select_scope_keys(false))::text[]))
            and app_private.daily_log_can_select(log.project_id, log.construction_site_id, current_app_user_id())
          )
        )
        and (
          daily_log_labor.resource_semantics_version = 1
          or log.status <> 'verified'::text
          or app_private.current_actor_has_effective_room_action(log.project_id, log.construction_site_id, 'payment'::text, 'view_resource_evidence'::text)
        )
    )
  )
);

alter policy daily_log_machines_select on public.daily_log_machines
using (
  (
    contribution_id is not null
    and exists (
      select 1 from public.daily_log_contributions contribution
      where contribution.id = daily_log_machines.contribution_id
        and app_private.daily_log_contribution_can_view(contribution.project_id, contribution.construction_site_id, contribution.author_user_id, contribution.submitted_to_user_id)
    )
  )
  or (
    daily_log_id is not null
    and exists (
      select 1 from public.daily_logs log
      where log.id = daily_log_machines.daily_log_id
        and (
          app_private.rls_scope_key(log.project_id, log.construction_site_id) = any ((select app_private.daily_log_select_scope_keys(true))::text[])
          or (
            not (app_private.rls_scope_key(log.project_id, log.construction_site_id) = any ((select app_private.daily_log_select_scope_keys(false))::text[]))
            and app_private.daily_log_can_select(log.project_id, log.construction_site_id, current_app_user_id())
          )
        )
        and (
          daily_log_machines.resource_semantics_version = 1
          or log.status <> 'verified'::text
          or app_private.current_actor_has_effective_room_action(log.project_id, log.construction_site_id, 'payment'::text, 'view_resource_evidence'::text)
        )
    )
  )
);

-- Tab Vật tư kiểm ~10 quyền project.* bằng 10 lần gọi project_has_permission_v2 (1.428 lần/3,5 ngày).
-- Bản theo lô: cùng luật, cùng tham số, trả về danh sách mã được phép.
create or replace function public.project_has_permissions_v2(
  p_project_id text,
  p_construction_site_id text,
  p_permission_codes text[],
  p_user_id uuid default public.current_app_user_id()
)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(codes.code order by codes.code), '{}'::text[])
  from (select distinct pg_catalog.unnest(p_permission_codes) as code) codes
  where codes.code is not null
    and app_private.project_has_permission_v2(p_project_id, p_construction_site_id, codes.code, p_user_id);
$$;

revoke all on function public.project_has_permissions_v2(text, text, text[], uuid) from public, anon;
grant execute on function public.project_has_permissions_v2(text, text, text[], uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
