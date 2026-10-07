-- Trung tâm điều hành đợt 0, PR-C: "Hôm nay" — số liệu 6 nhóm widget cho chính người gọi (kế hoạch 07 mục 5).
-- Chỉ đọc. Mỗi số gọi lại RPC / luật quyền sẵn có của module (today board, finance summary, sổ phép, bảng công,
-- room action của dự án, procurement_can, wms_has_action…). Phần không được xem trả state 'denied' thay vì số 0.
-- Dự án mặc định (chủ SP duyệt 07/10): công trường đang được điều động (H2) → dự án có nhiều việc chờ tôi nhất → dự án đầu tiên tôi thuộc.

create function app_private.vcc_uuid(p_text text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_text::uuid end;
$$;
revoke all on function app_private.vcc_uuid(text) from public, anon, authenticated;

create function public.vcc_my_center_v1(p_project_id text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.center_actor_v1();
  v_me text := v_actor::text;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_today_text text := to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD');
  v_employee uuid := app_private.hrm_current_employee_id();
  v_admin boolean := public.is_admin();
  v_hr boolean := app_private.has_hrm_template_permission(v_actor, 'hrm.employee.view_sensitive');
  v_work boolean := app_private.has_permission(v_actor, 'work.module.access', 'global', '*');
  v_mine jsonb;
  v_options jsonb;
  v_site_project text;
  v_source text;
  v_project public.projects%rowtype;
  v_site public.hrm_construction_sites%rowtype;
  v_site_text text;
  v_can_po boolean;
  v_can_mr boolean;
  v_part jsonb;
  v_board jsonb;
  v_project_widget jsonb := null;
  v_hrm jsonb;
  v_work_widget jsonb;
  v_office jsonb;
  v_supply jsonb := null;
  v_finance jsonb := null;
begin
  -- Việc chờ tôi: đếm theo dự án và chọn dự án mặc định.
  v_mine := public.vcc_my_work_items_v1('mine');
  v_site_project := app_private.hrm_site_project_id(app_private.hrm_employee_primary_site_on(v_employee, v_today));

  with mine_projects as (
    select i -> 'ref' ->> 'projectId' as pid, count(*) as n
    from jsonb_array_elements(v_mine -> 'items') i where i -> 'ref' ->> 'projectId' is not null group by 1
  ), member as (
    select coalesce(s.project_id, app_private.hrm_site_project_id(app_private.vcc_uuid(s.construction_site_id))) as pid
    from public.project_staff s where s.user_id = v_me and (s.end_date is null or s.end_date >= v_today)
    union select v_site_project
    union select app_private.hrm_site_project_id(e.construction_site_id) from public.employees e where e.id = v_employee
    union select pid from mine_projects
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'waiting', coalesce(m.n, 0))
      order by (p.status = 'active') desc, p.code), '[]'::jsonb)
  into v_options
  from public.projects p
  left join mine_projects m on m.pid = p.id
  where coalesce(p.status, '') in ('planning', 'active', 'paused')
    and (v_admin or p.id in (select pid from member where pid is not null));

  if nullif(btrim(p_project_id), '') is not null and exists (select 1 from jsonb_array_elements(v_options) o where o ->> 'id' = p_project_id) then
    v_source := 'selected'; select * into v_project from public.projects where id = p_project_id;
  elsif v_site_project is not null and exists (select 1 from jsonb_array_elements(v_options) o where o ->> 'id' = v_site_project) then
    v_source := 'assignment'; select * into v_project from public.projects where id = v_site_project;
  elsif exists (select 1 from jsonb_array_elements(v_options) o where (o ->> 'waiting')::int > 0) then
    v_source := 'most_work';
    select * into v_project from public.projects
    where id = (select o ->> 'id' from jsonb_array_elements(v_options) o order by (o ->> 'waiting')::int desc, o ->> 'code' limit 1);
  elsif jsonb_array_length(v_options) > 0 then
    v_source := 'member'; select * into v_project from public.projects where id = (v_options -> 0 ->> 'id');
  end if;

  if v_project.id is not null then
    select * into v_site from public.hrm_construction_sites where id = v_project.construction_site_id;
    v_site_text := v_site.id::text;
    v_can_po := v_admin or app_private.procurement_can('view')
      or app_private.current_actor_has_effective_room_action(v_project.id, v_site_text, 'material_po', 'view');
    v_can_mr := v_admin or app_private.procurement_can('view')
      or app_private.current_actor_has_effective_room_action(v_project.id, v_site_text, 'material_request', 'view');

    -- Thi công hôm nay: báo cáo ngày (quyền Room nhật ký — chính RPC today board kiểm).
    begin
      v_board := public.get_daily_log_today_board_v1(v_project.id, v_site_text, v_today);
      v_part := jsonb_build_object('state', 'ready',
        'slips', jsonb_array_length(coalesce(v_board -> 'slips', '[]'::jsonb)),
        'fronts', jsonb_array_length(coalesce(v_board -> 'slips', '[]'::jsonb)) + jsonb_array_length(coalesce(v_board -> 'missingFronts', '[]'::jsonb)),
        'people', coalesce((select sum(coalesce((s ->> 'people')::numeric, 0)) from jsonb_array_elements(coalesce(v_board -> 'slips', '[]'::jsonb)) s), 0),
        'summaryStatus', v_board -> 'summary' ->> 'status');
    exception when insufficient_privilege then v_part := jsonb_build_object('state', 'denied');
      when others then v_part := jsonb_build_object('state', 'error', 'code', sqlstate);
    end;
    v_project_widget := jsonb_build_object('construction', v_part);

    -- Vật tư đang về: PO của dự án đang giao.
    if v_can_po then
      select jsonb_build_object('state', 'ready',
          'count', count(*), 'amount', coalesce(sum(o.total_amount), 0),
          'nextPo', (select jsonb_build_object('poId', x.id, 'poNumber', x.po_number, 'expectedDate', app_private.vcc_date(x.expected_delivery_date))
            from public.purchase_orders x where x.project_id = v_project.id and x.archived_at is null and x.status in ('in_transit', 'partial')
            order by app_private.vcc_date(x.expected_delivery_date) nulls last, x.created_at limit 1))
      into v_part
      from public.purchase_orders o where o.project_id = v_project.id and o.archived_at is null and o.status in ('in_transit', 'partial');
    else
      v_part := jsonb_build_object('state', 'denied');
    end if;
    v_project_widget := v_project_widget || jsonb_build_object('supply', v_part);

    -- Tiến độ: cùng công thức màn Dự án (trọng số = chi phí/ngày × thời gian, không có thì thời gian × nguồn lực; chỉ việc lá).
    select jsonb_build_object('state', case when count(*) = 0 then 'empty' else 'ready' end,
        'mode', coalesce(v_project.progress_calculation_mode, 'gantt_weighted'),
        'percent', case when coalesce(v_project.progress_calculation_mode, 'gantt_weighted') = 'manual' then round(coalesce(v_project.manual_progress_percent, 0))
          when coalesce(sum(t.w), 0) > 0 then round(sum(least(100, greatest(0, t.progress)) * t.w) / sum(t.w)) else 0 end,
        'total', count(*),
        'done', count(*) filter (where t.progress >= 100),
        'overdue', count(*) filter (where t.progress < 100 and t.end_day < v_today),
        'inProgress', count(*) filter (where t.progress < 100 and t.progress > 0 and (t.end_day is null or t.end_day >= v_today)),
        'notStarted', count(*) filter (where t.progress <= 0 and (t.end_day is null or t.end_day >= v_today)),
        'endDate', v_project.end_date)
    into v_part
    from (
      select pt.progress, app_private.vcc_date(pt.end_date) as end_day,
        case when coalesce(pt.estimated_cost_per_day, 0) * d.dur > 0 then coalesce(pt.estimated_cost_per_day, 0) * d.dur
          else d.dur * greatest(1, coalesce(pt.resource_count, 1)) end as w
      from public.project_tasks pt
      cross join lateral (select case when pt.is_milestone then 1
        when coalesce(pt.duration, 0) > 0 then pt.duration
        else greatest(1, coalesce(app_private.vcc_date(pt.end_date) - app_private.vcc_date(pt.start_date), 0) + 1) end as dur) d
      where (pt.project_id = v_project.id or (pt.project_id is null and pt.construction_site_id = v_site_text))
        and not exists (select 1 from public.project_tasks c where c.parent_id = pt.id)
    ) t;
    v_project_widget := v_project_widget || jsonb_build_object('progress', v_part,
      'waiting', (select count(*) from jsonb_array_elements(v_mine -> 'items') i where i -> 'ref' ->> 'projectId' = v_project.id));

    -- Mua hàng & Kho của dự án.
    if v_can_mr then
      select jsonb_build_object('state', 'ready',
          'pending', count(*) filter (where r.status = 'PENDING'),
          'supplying', count(*) filter (where r.status in ('APPROVED', 'IN_TRANSIT')),
          'waitingStep', (select r2.workflow_step from public.requests r2 where r2.project_id = v_project.id and r2.status = 'PENDING'
            and r2.workflow_step is not null group by r2.workflow_step order by count(*) desc limit 1))
      into v_part
      from public.requests r where r.project_id = v_project.id and r.status in ('PENDING', 'APPROVED', 'IN_TRANSIT');
    else
      v_part := jsonb_build_object('state', 'denied');
    end if;
    v_supply := jsonb_build_object('requests', v_part);
    if v_can_po then
      select jsonb_build_object('state', 'ready', 'open', count(*), 'openAmount', coalesce(sum(o.total_amount), 0),
          'awaitingApproval', count(*) filter (where o.status = 'sent'))
      into v_part
      from public.purchase_orders o where o.project_id = v_project.id and o.archived_at is null and o.status in ('sent', 'confirmed', 'in_transit', 'partial');
    else
      v_part := jsonb_build_object('state', 'denied');
    end if;
    v_supply := v_supply || jsonb_build_object('orders', v_part);
    select jsonb_build_object('id', w.id, 'name', w.name, 'canView', app_private.wms_has_action('wms.inventory.view', w.id, null, null, null, v_actor))
    into v_part
    from public.warehouses w where not coalesce(w.is_archived, false)
      and (w.project_id = v_project.id or (v_site.id is not null and w.construction_site_id = v_site.id))
    order by w.is_default_for_site desc, w.created_at limit 1;
    v_supply := v_supply || jsonb_build_object('warehouse', v_part);

    -- Tài chính dự án: null khi không được xem → widget ẩn hẳn.
    begin
      v_finance := public.get_finance_project_summary_v1(v_project.id);
    exception when others then v_finance := null;
    end;
  end if;

  -- Nhân sự: của tôi (chấm công hôm nay, phép, công tháng) + đội công trường (CHT / HR).
  if v_employee is null then
    v_hrm := jsonb_build_object('state', 'empty');
  else
    select jsonb_build_object('checkIn', a."checkIn", 'checkOut', a."checkOut", 'locationName', a."locationName", 'status', a.status)
    into v_part from public.hrm_attendance a where a."employeeId" = v_employee and a.date = v_today_text order by a."createdAt" desc limit 1;
    v_hrm := jsonb_build_object('state', 'ready', 'attendance', v_part);
    begin
      v_part := public.get_hrm_leave_ledger(v_employee, extract(year from v_today)::int);
      v_hrm := v_hrm || jsonb_build_object('leave', case when v_part -> 'balance' is null or jsonb_typeof(v_part -> 'balance') = 'null' then null
        else jsonb_build_object('availableDays', v_part -> 'balance' -> 'availableDays', 'pendingDays', v_part -> 'balance' -> 'pendingDays', 'year', extract(year from v_today)::int) end);
    exception when others then v_hrm := v_hrm || jsonb_build_object('leave', null);
    end;
    begin
      v_part := public.get_hrm_timesheet(extract(year from v_today)::int, extract(month from v_today)::int, v_employee);
      v_hrm := v_hrm || jsonb_build_object('timesheet', jsonb_build_object('workDays', v_part -> 'totals' -> 'workDays',
        'month', extract(month from v_today)::int, 'year', extract(year from v_today)::int, 'periodStatus', v_part -> 'period' ->> 'status'));
    exception when others then v_hrm := v_hrm || jsonb_build_object('timesheet', null);
    end;
    if v_site.id is not null and (v_hr or v_admin or app_private.hrm_is_site_leader(v_actor, v_site.id)) then
      select jsonb_build_object('state', 'ready', 'total', count(*),
          'present', count(*) filter (where exists (select 1 from public.hrm_attendance a where a."employeeId" = e.id and a.date = v_today_text and a."checkIn" is not null)),
          'assignments', (select count(*) from public.hrm_site_assignments s where s.site_id = v_site.id and s.status = 'approved'
            and s.start_date <= v_today and (s.end_date is null or s.end_date >= v_today)))
      into v_part
      from public.employees e
      where e.status = 'Đang làm việc'
        and coalesce(app_private.hrm_employee_primary_site_on(e.id, v_today), e.construction_site_id) = v_site.id;
      v_hrm := v_hrm || jsonb_build_object('team', v_part);
    else
      v_hrm := v_hrm || jsonb_build_object('team', jsonb_build_object('state', case when v_site.id is null then 'empty' else 'denied' end));
    end if;
  end if;

  -- Công việc: Work (nếu có quyền), việc đã giao, yêu cầu tôi gửi.
  v_work_widget := jsonb_build_object('workEnabled', v_work,
    'assigned', case when v_work then (select jsonb_build_object('active', count(*),
        'overdue', count(*) filter (where (i ->> 'dueAt')::timestamptz < now()),
        'nearest', (select jsonb_build_object('code', j ->> 'code', 'taskCode', j -> 'ref' ->> 'taskCode', 'dueAt', j ->> 'dueAt')
          from jsonb_array_elements(v_mine -> 'items') j where j ->> 'source' = 'work' and j ->> 'kind' = 'do' and j ->> 'dueAt' is not null
          order by j ->> 'dueAt' limit 1))
      from jsonb_array_elements(v_mine -> 'items') i where i ->> 'source' = 'work' and i ->> 'kind' = 'do') else null end,
    'created', case when v_work then (select jsonb_build_object('open', count(*), 'awaitingReview', count(*) filter (where t.status = 'awaiting_review'))
      from public.work_tasks t where t.created_by = v_actor and t.status not in ('draft', 'completed', 'cancelled')) else null end,
    'requests', (select jsonb_build_object('pending', count(*), 'returned', count(*) filter (where r.status = 'RETURNED'),
        'latest', (select jsonb_build_object('id', x.id, 'code', x.code, 'title', x.title, 'status', x.status,
            'waitingOn', (select string_agg(u.name, ', ') from public.workflow_step_assignments a join public.users u on u.id = a.assignee_user_id
              where a.workflow_subject_id = x.workflow_subject_id and a.status = 'PENDING'))
          from public.request_instances x where x.created_by = v_actor and x.status in ('PENDING', 'RETURNED') order by x.created_at desc limit 1))
      from public.request_instances r where r.created_by = v_actor and r.status in ('PENDING', 'RETURNED')));

  -- Hành chính: văn bản cần xác nhận đã đọc, chuyến xe sắp tới của tôi.
  begin
    select jsonb_build_object('state', 'ready', 'count', count(*),
        'first', (select jsonb_build_object('id', d2.id, 'documentNumber', d2.document_number, 'title', d2.title)
          from app_private.office_filtered('{"view":"unread"}'::jsonb) d2 where d2.require_acknowledgement
          order by d2.due_date nulls last, d2.issued_at desc limit 1))
    into v_part
    from app_private.office_filtered('{"view":"unread"}'::jsonb) d where d.require_acknowledgement;
  exception when insufficient_privilege then v_part := jsonb_build_object('state', 'denied');
    when others then v_part := jsonb_build_object('state', 'error', 'code', sqlstate);
  end;
  v_office := jsonb_build_object('documents', v_part);
  select jsonb_build_object('id', b.id, 'code', b.booking_code, 'status', b.status, 'pickupAt', b.requested_pickup_at, 'destination', b.destination_text,
      'vehicle', (select coalesce(nullif(a.code, ''), a.name) from public.vehicle_booking_assignments x join public.assets a on a.id = x.vehicle_asset_id
        where x.booking_id = b.id and x.is_active and x.released_at is null and x.superseded_at is null order by x.version desc limit 1))
  into v_part
  from public.vehicle_bookings b
  where b.requester_user_id = v_actor and b.status in ('PENDING_APPROVAL', 'WAITING_DISPATCH', 'ASSIGNED', 'IN_PROGRESS')
    and b.expected_return_at >= now() - interval '1 day'
  order by b.requested_pickup_at limit 1;
  v_office := v_office || jsonb_build_object('nextTrip', v_part);

  return jsonb_build_object(
    'generatedAt', now(),
    'today', v_today,
    'project', case when v_project.id is null then null else jsonb_build_object(
      'id', v_project.id, 'code', v_project.code, 'name', v_project.name, 'status', v_project.status, 'endDate', v_project.end_date,
      'source', v_source,
      'site', case when v_site.id is null then null else jsonb_build_object('id', v_site.id, 'name', v_site.name,
        'latitude', v_site.latitude, 'longitude', v_site.longitude) end) end,
    'projectOptions', v_options,
    'widgets', jsonb_build_object(
      'project', v_project_widget,
      'hrm', v_hrm,
      'work', v_work_widget,
      'office', v_office,
      'supply', v_supply,
      'finance', v_finance));
end $$;
revoke all on function public.vcc_my_center_v1(text) from public, anon;
grant execute on function public.vcc_my_center_v1(text) to authenticated, service_role;
