-- Công trường 3D trong Trung tâm điều hành (17/10/2026). Thiết kế: docs/command-center/08-dong-chay-cong-viec-2026-10-13.md mục 16.
-- Chủ SP: "Đưa 3D vào chế độ trình chiếu trong Trung tâm điều hành. Admin quyết định ai được xem."
--   1. Quyền center.site3d.view (toàn công ty). Không đưa vào mẫu nào: Admin cấp từng người ở màn Phân quyền. Admin luôn xem được.
--   2. Kho site-models (riêng tư): mô hình thiết kế (SketchUp → GLB) và kết cấu thép (Tekla → GLB) theo dự án,
--      đường dẫn <project_id>/architecture.glb | <project_id>/structure.glb. Người có quyền xem tải về (link ký 1 giờ); chỉ Admin tải lên / thay.
--   3. RPC public.vcc_site3d_v1(p_project_code): số liệu sống cho mô hình — đầu việc (WBS, %, ngày kế hoạch / thực tế, khối lượng BOQ),
--      % theo ngày (chỉ điểm đổi), nhật ký (một bản / ngày: đã duyệt > đã gửi > nháp; người, tổ, máy), tồn kho công trường.
--      Không truyền mã dự án → chỉ kiểm quyền + danh sách dự án đang hoạt động (giao diện chỉ hiện công trường đã dựng cấu hình 3D).
-- Rollback: supabase/tests/center_site3d_v1_rollback.sql · Smoke: supabase/tests/center_site3d_v1_smoke.sql

-- ── 1. Quyền ────────────────────────────────────────────────────────────────────────────────
insert into public.permission_modules(application_code,code,name,routes,sort_order,is_active)
values ('center','center.site3d','Công trường 3D',array['/center'],40,true)
on conflict(code) do update set name=excluded.name,routes=excluded.routes,is_active=true;

insert into public.permission_actions(module_code,action,permission_code,label,scope_modes,sort_order,is_active,risk_level,is_business_action,is_business_approval,grant_readiness,access_application_code)
values ('center.site3d','view','center.site3d.view','Xem công trường 3D (trình chiếu tiến độ, mô hình thiết kế)',array['global'],1,true,'normal',false,false,'enforced','center')
on conflict(permission_code) do update set label=excluded.label,scope_modes=excluded.scope_modes,grant_readiness='enforced',is_active=true;

-- Admin hoặc người được cấp center.site3d.view.
create function app_private.site3d_can_view_v1(p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_actor is not null and (coalesce(public.is_admin(), false) or app_private.has_permission(p_actor, 'center.site3d.view', 'global', '*'));
$$;
revoke all on function app_private.site3d_can_view_v1(uuid) from public, anon;
grant execute on function app_private.site3d_can_view_v1(uuid) to authenticated;

-- ── 2. Kho mô hình (riêng tư) ──────────────────────────────────────────────────────────────
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('site-models', 'site-models', false, 62914560, array['model/gltf-binary', 'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy site_models_read on storage.objects
  for select to authenticated
  using (bucket_id = 'site-models' and app_private.site3d_can_view_v1(public.current_app_user_id()));
create policy site_models_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-models' and (select public.is_admin()));
create policy site_models_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'site-models' and (select public.is_admin()))
  with check (bucket_id = 'site-models' and (select public.is_admin()));
create policy site_models_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-models' and (select public.is_admin()));

-- ── 3. RPC ──────────────────────────────────────────────────────────────────────────────────
create function public.vcc_site3d_v1(p_project_code text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_project public.projects%rowtype;
  v_tasks jsonb; v_series jsonb; v_logs jsonb; v_stock jsonb;
begin
  begin
    v_actor := app_private.center_actor_v1();
  exception when insufficient_privilege then
    return jsonb_build_object('access', false, 'reason', 'no_center');
  end;
  if not app_private.site3d_can_view_v1(v_actor) then
    return jsonb_build_object('access', false, 'reason', 'no_permission');
  end if;

  if p_project_code is null then
    return jsonb_build_object('access', true, 'canManage', coalesce(public.is_admin(), false),
      'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) order by p.code)
        from public.projects p where p.status = 'active' and p.code is not null), '[]'::jsonb));
  end if;

  select * into v_project from public.projects p where p.code = p_project_code limit 1;
  if not found then
    return jsonb_build_object('access', true, 'reason', 'not_found');
  end if;

  -- Đầu việc: [wbs, wbs cha, tên, %, KH bắt đầu, KH kết thúc, TT bắt đầu, TT kết thúc, khối lượng BOQ, đơn vị].
  select coalesce(jsonb_agg(jsonb_build_array(t.wbs_code, par.wbs_code, btrim(t.name), coalesce(t.progress, 0),
      nullif(left(t.start_date, 10), ''), nullif(left(t.end_date, 10), ''), t.actual_start_date, t.actual_end_date,
      round(b.planned_qty::numeric, 1), nullif(nullif(b.unit, '–'), ''))
    order by t.sort_order nulls last, t.wbs_code), '[]'::jsonb)
  into v_tasks
  from public.project_tasks t
  left join public.project_tasks par on par.id = t.parent_id
  left join lateral (select bi.planned_qty, bi.unit from public.project_work_boq_items bi where bi.source_task_id = t.id limit 1) b on true
  where t.project_id = v_project.id and t.wbs_code is not null;

  -- % theo ngày: chỉ giữ ngày % đổi so với ngày trước, theo từng đầu việc → { wbs: [[ngày, %], ...] }.
  with d as (
    select t.wbs_code, x.progress_date, round(x.progress_percent::numeric, 1) as p,
      lag(round(x.progress_percent::numeric, 1)) over (partition by x.task_id order by x.progress_date) as prev
    from public.project_daily_task_progress x join public.project_tasks t on t.id = x.task_id
    where x.project_id = v_project.id and t.wbs_code is not null
  ), c as (
    select wbs_code, jsonb_agg(jsonb_build_array(progress_date, p) order by progress_date) as pts
    from d where prev is null or prev is distinct from p group by wbs_code
  )
  select coalesce(jsonb_object_agg(wbs_code, pts), '{}'::jsonb) into v_series from c;

  -- Nhật ký: một bản mỗi ngày (bỏ bản bị thay / bị từ chối) — [ngày, số người, trạng thái, máy [[tên, loại, số]], tổ [[việc, số người]]].
  with l as (
    select distinct on (dl.date) dl.*
    from public.daily_logs dl
    where dl.project_id = v_project.id and dl.superseded_by_daily_log_id is null and coalesce(dl.status, '') <> 'rejected'
    order by dl.date, case dl.status when 'verified' then 0 when 'submitted' then 1 else 2 end, dl.last_action_at desc nulls last, dl.created_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_array(left(l.date, 10), coalesce(l.worker_count, 0), l.status,
      coalesce((select jsonb_agg(jsonb_build_array(btrim(coalesce(m.catalog_name, m.machine_name, '')), coalesce(m.machine_type, ''), coalesce(m.machine_count, 1)))
        from public.daily_log_machines m where m.daily_log_id = l.id), '[]'::jsonb),
      coalesce((select jsonb_agg(jsonb_build_array(btrim(coalesce(x.task_name, x.partner_name, x.manual_provider_name, x.catalog_name, x.labor_type, '')), coalesce(x.people_count, x.count, 0)))
        from public.daily_log_labor x where x.daily_log_id = l.id), '[]'::jsonb))
    order by l.date), '[]'::jsonb)
  into v_logs from l;

  -- Tồn kho công trường (kho SITE gắn dự án), bỏ dòng chi phí.
  select coalesce(jsonb_agg(jsonb_build_array(btrim(i.name), i.unit, round(b.on_hand_qty::numeric, 1)) order by b.total_value desc nulls last), '[]'::jsonb)
  into v_stock
  from public.inventory_balances b
  join public.items i on i.id = b.material_id
  join public.warehouses w on w.id = b.warehouse_id
  where w.project_id = v_project.id and w.type = 'SITE' and b.on_hand_qty > 0 and i.name not ilike 'Chi phí%';

  return jsonb_build_object('access', true, 'canManage', coalesce(public.is_admin(), false),
    'project', jsonb_build_object('id', v_project.id, 'code', v_project.code, 'name', v_project.name),
    'today', (statement_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date,
    'tasks', v_tasks, 'series', v_series, 'logs', v_logs, 'stock', v_stock);
end $$;
revoke all on function public.vcc_site3d_v1(text) from public, anon;
grant execute on function public.vcc_site3d_v1(text) to authenticated;
