-- Phiên bản kế hoạch — đợt 1a (chủ sản phẩm duyệt 06/10/2026: "đồng ý cả 8, chọn a" và "đồng ý cả 6").
--
-- Kế hoạch tháng/tuần đã có bản gốc (bản duyệt đầu tiên của kỳ), bản hiện hành và bản điều chỉnh
-- (revise_project_work_plan_v1). Bổ sung:
--   * Lý do theo danh mục + bên chịu trách nhiệm + văn bản đính kèm cho bản điều chỉnh; mỗi dòng thay đổi
--     (kể cả dòng bị bỏ khỏi kỳ) có lý do riêng, mặc định theo lý do chính của bản.
--   * Không sửa lùi (áp dụng cả Admin): kỳ đã kết thúc không lập/sửa/gửi; việc đã bắt đầu giữ ngày bắt đầu;
--     ngày mới không trước hôm nay; khối lượng không dưới phần đã làm trong kỳ; việc đã làm không bỏ khỏi kỳ.
--   * Người duyệt / trả lại khác người lập và người gửi (KH tháng, KH tuần, KH vật tư).
--   * Duyệt bản điều chỉnh tháng → KH tuần bị ảnh hưởng và KH vật tư cùng kỳ được đánh dấu "cần xem lại",
--     người lập nhận thông báo; "Giữ nguyên" phải ghi lý do.
--   * Xem trước tác động (vật tư kéo theo + tiền, KH tuần bị ảnh hưởng) trước khi gửi / duyệt.
--   * Vá đặt trùng: duyệt bản KH vật tư mới → liên kết đơn mua của bản cũ chuyển sang dòng cùng vật tư của
--     bản mới (trước đây Mua hàng thấy như chưa đặt). Vật tư không còn nhu cầu giữ dòng 0 để truy vết.
-- Bản đã duyệt không bao giờ sửa đè; so sánh = dòng của hai bản (supersedes_plan_id / bản gốc), không lưu bản so sánh.

-- 1. Danh mục lý do (dùng chung với lý do chậm ở Nhật ký về sau).
create table public.project_plan_change_reasons (
  code text primary key,
  label text not null,
  default_party text not null check (default_party in ('owner', 'company', 'vendor', 'objective')),
  needs_document boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.project_plan_change_reasons enable row level security;
create policy project_plan_change_reasons_select on public.project_plan_change_reasons for select to authenticated using (true);
revoke all on public.project_plan_change_reasons from anon;
revoke insert, update, delete on public.project_plan_change_reasons from authenticated;
grant select on public.project_plan_change_reasons to authenticated;
insert into public.project_plan_change_reasons (code, label, default_party, needs_document, sort_order) values
  ('design', 'Thay đổi thiết kế (CĐT)', 'owner', true, 10),
  ('scope', 'Phát sinh khối lượng', 'owner', true, 20),
  ('method', 'Đổi biện pháp thi công', 'company', false, 30),
  ('material', 'Chậm do vật tư', 'vendor', false, 40),
  ('labor', 'Chậm do nhân công, máy', 'company', false, 50),
  ('site', 'Mặt bằng, việc trước chưa bàn giao', 'owner', false, 60),
  ('owner', 'CĐT chậm duyệt, chậm thanh toán', 'owner', true, 70),
  ('weather', 'Thời tiết', 'objective', false, 80),
  ('speedup', 'Đẩy nhanh tiến độ', 'company', false, 90)
on conflict (code) do nothing;

-- 2. Cột mới.
alter table public.project_work_plans
  add column change_reason_code text references public.project_plan_change_reasons(code),
  add column responsible_party text check (responsible_party in ('owner', 'company', 'vendor', 'objective')),
  add column change_summary text,
  add column attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  add column removed_lines jsonb not null default '[]'::jsonb check (jsonb_typeof(removed_lines) = 'array'),
  add column needs_review_at timestamptz,
  add column needs_review_reason text;
alter table public.project_work_plan_lines
  add column change_reason_code text references public.project_plan_change_reasons(code),
  add column responsible_party text check (responsible_party in ('owner', 'company', 'vendor', 'objective')),
  add column change_note text;
alter table public.project_material_plans
  add column needs_review_at timestamptz,
  add column needs_review_reason text;

alter table public.project_work_plan_events drop constraint project_work_plan_events_action_check;
alter table public.project_work_plan_events add constraint project_work_plan_events_action_check
  check (action in ('create', 'save', 'submit', 'withdraw', 'return', 'approve', 'revise', 'supersede', 'flag_review', 'keep'));
alter table public.project_material_plan_events drop constraint project_material_plan_events_action_check;
alter table public.project_material_plan_events add constraint project_material_plan_events_action_check
  check (action in ('create', 'save', 'submit', 'withdraw', 'return', 'approve', 'revise', 'supersede', 'flag_review', 'keep', 'relink'));

-- 3. Văn bản đính kèm: bucket riêng, đường dẫn <projectId>/<siteId|->/<tệp>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work-plan-attachments', 'work-plan-attachments', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy work_plan_attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'work-plan-attachments' and app_private.current_actor_has_effective_room_action(
    (storage.foldername(name))[1], nullif((storage.foldername(name))[2], '-'), 'work_plan', 'view'));
create policy work_plan_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'work-plan-attachments' and app_private.current_actor_has_effective_room_action(
    (storage.foldername(name))[1], nullif((storage.foldername(name))[2], '-'), 'work_plan', 'edit'));

-- 4. Hàm phụ.
create function app_private.work_plan_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date;
$$;

-- Khối lượng đã làm trong kỳ tính đến hôm nay (0 khi chưa ghi nhận).
create function app_private.work_plan_done_in_period(p_task_id text, p_period_start date)
returns numeric language sql stable security definer set search_path = '' as $$
  select greatest(coalesce((select c.quantity_done from app_private.work_plan_task_cumulative(p_task_id, app_private.work_plan_today()) c), 0)
    - coalesce((select c.quantity_done from app_private.work_plan_task_cumulative(p_task_id, p_period_start - 1) c), 0), 0);
$$;

-- Dòng thay đổi của một bản so với bản nó thay thế: thêm / bỏ / đổi khối lượng hoặc ngày.
create function app_private.work_plan_changed_tasks(p_plan_id uuid)
returns table (task_id text, kind text)
language sql stable security definer set search_path = '' as $$
  with p as (select * from public.project_work_plans where id = p_plan_id),
  n as (select l.* from public.project_work_plan_lines l join p on l.plan_id = p.id),
  b as (select l.* from public.project_work_plan_lines l join p on l.plan_id = p.supersedes_plan_id)
  select n.task_id, case when b.task_id is null then 'added' else 'changed' end
  from n cross join p left join b on b.task_id = n.task_id
  where p.supersedes_plan_id is not null and (b.task_id is null
    or round(coalesce(n.planned_qty, -1), 3) <> round(coalesce(b.planned_qty, -1), 3)
    or coalesce(n.planned_start, p.period_start) <> coalesce(b.planned_start, p.period_start)
    or coalesce(n.planned_end, p.period_end) <> coalesce(b.planned_end, p.period_end))
  union all
  select b.task_id, 'removed' from b cross join p
  where p.supersedes_plan_id is not null and not exists (select 1 from n where n.task_id = b.task_id);
$$;

-- Luật không sửa lùi. Kỳ đã kết thúc khóa mọi bản; bản điều chỉnh so với bản nó thay thế.
create function app_private.work_plan_assert_editable(p_plan public.project_work_plans)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := app_private.work_plan_today();
  r record;
begin
  if p_plan.period_end < v_today then
    raise exception using errcode = 'PT409', message = 'WORK_PLAN_PERIOD_ENDED'; end if;
  if p_plan.supersedes_plan_id is null then return; end if;
  for r in
    select n.task_name_snapshot nm, n.task_id, n.planned_qty qty,
      coalesce(n.planned_start, p_plan.period_start) ns, coalesce(n.planned_end, p_plan.period_end) ne,
      b.task_id bt, coalesce(b.planned_start, p_plan.period_start) bs, coalesce(b.planned_end, p_plan.period_end) be
    from public.project_work_plan_lines n
    left join public.project_work_plan_lines b on b.plan_id = p_plan.supersedes_plan_id and b.task_id = n.task_id
    where n.plan_id = p_plan.id
  loop
    if r.bt is null then
      if r.ns < v_today then raise exception using errcode = '22023', message = 'WORK_PLAN_NEW_LINE_IN_PAST', detail = r.nm; end if;
    else
      if r.ns <> r.bs and r.bs < v_today then raise exception using errcode = '22023', message = 'WORK_PLAN_START_LOCKED', detail = r.nm; end if;
      if r.ns <> r.bs and r.ns < v_today then raise exception using errcode = '22023', message = 'WORK_PLAN_START_IN_PAST', detail = r.nm; end if;
      if r.ne <> r.be and r.ne < v_today then raise exception using errcode = '22023', message = 'WORK_PLAN_END_IN_PAST', detail = r.nm; end if;
    end if;
    if r.qty is not null and r.qty + 0.0005 < app_private.work_plan_done_in_period(r.task_id, p_plan.period_start) then
      raise exception using errcode = '22023', message = 'WORK_PLAN_QTY_BELOW_DONE', detail = r.nm; end if;
  end loop;
  select b.task_name_snapshot into r from public.project_work_plan_lines b
  where b.plan_id = p_plan.supersedes_plan_id
    and not exists (select 1 from public.project_work_plan_lines n where n.plan_id = p_plan.id and n.task_id = b.task_id)
    and app_private.work_plan_done_in_period(b.task_id, p_plan.period_start) > 0.0005
  limit 1;
  if found then raise exception using errcode = '22023', message = 'WORK_PLAN_REMOVE_DONE_LINE', detail = r.task_name_snapshot; end if;
end;
$$;

-- Dòng bị bỏ khỏi kỳ (so với bản thay thế), giữ lý do người lập đã chọn cho từng việc.
create function app_private.work_plan_removed_lines(p_plan public.project_work_plans, p_given jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('taskId', b.task_id, 'wbsCode', b.wbs_code_snapshot, 'taskName', b.task_name_snapshot,
      'groupName', b.group_name_snapshot, 'unit', b.unit_snapshot, 'plannedQty', b.planned_qty,
      'plannedStart', b.planned_start, 'plannedEnd', b.planned_end, 'crewLabel', b.crew_label,
      'changeReasonCode', g.value->>'changeReasonCode', 'responsibleParty', g.value->>'responsibleParty',
      'changeNote', nullif(btrim(g.value->>'changeNote'), '')) order by b.sort_order), '[]'::jsonb)
  from public.project_work_plan_lines b
  left join lateral (select x.value from jsonb_array_elements(coalesce(p_given, '[]'::jsonb)) x(value)
    where x.value->>'taskId' = b.task_id limit 1) g on true
  where p_plan.supersedes_plan_id is not null and b.plan_id = p_plan.supersedes_plan_id
    and not exists (select 1 from public.project_work_plan_lines n where n.plan_id = p_plan.id and n.task_id = b.task_id);
$$;

-- Tuần bị ảnh hưởng khi bản tháng thay bản trước: tuần chưa kết thúc, giao với tháng, có việc thay đổi.
create function app_private.work_plan_affected_weeks(p_plan_id uuid)
returns table (plan_id uuid, period_start date, status text)
language sql stable security definer set search_path = '' as $$
  select w.id, w.period_start, w.status
  from public.project_work_plans m
  join public.project_work_plans w on w.project_id = m.project_id and w.construction_site_id is not distinct from m.construction_site_id
    and w.period_type = 'week' and w.status in ('approved', 'draft', 'submitted', 'returned')
    and w.period_start <= m.period_end and w.period_end >= m.period_start and w.period_end >= app_private.work_plan_today()
  where m.id = p_plan_id and m.period_type = 'month' and m.supersedes_plan_id is not null
    and exists (select 1 from app_private.work_plan_changed_tasks(m.id) c
      where exists (select 1 from public.project_work_plan_lines wl where wl.plan_id = w.id and wl.task_id = c.task_id)
        or (c.kind = 'added' and exists (select 1 from public.project_work_plan_lines nl where nl.plan_id = m.id and nl.task_id = c.task_id
          and coalesce(nl.planned_start, m.period_start) <= w.period_end and coalesce(nl.planned_end, m.period_end) >= w.period_start)));
$$;

-- Kiểm tra lúc gửi bản điều chỉnh: có thay đổi, có lý do, có văn bản khi lý do cần; điền lý do mặc định cho dòng.
create function app_private.work_plan_prepare_submit(p_plan public.project_work_plans)
returns void language plpgsql security definer set search_path = '' as $$
declare v_default_party text;
begin
  if p_plan.supersedes_plan_id is null then return; end if;
  if p_plan.change_reason_code is null then
    raise exception using errcode = '22023', message = 'WORK_PLAN_CHANGE_REASON_REQUIRED'; end if;
  if length(btrim(coalesce(p_plan.change_summary, ''))) < 10 then
    raise exception using errcode = '22023', message = 'WORK_PLAN_CHANGE_SUMMARY_REQUIRED'; end if;
  if not exists (select 1 from app_private.work_plan_changed_tasks(p_plan.id)) then
    raise exception using errcode = '22023', message = 'WORK_PLAN_NO_CHANGES'; end if;
  select default_party into v_default_party from public.project_plan_change_reasons where code = p_plan.change_reason_code;
  -- Dòng không đổi thì không giữ lý do; dòng đổi lấy lý do riêng hoặc lý do chính.
  update public.project_work_plan_lines l set change_reason_code = null, responsible_party = null
  where l.plan_id = p_plan.id and not exists (select 1 from app_private.work_plan_changed_tasks(p_plan.id) c where c.task_id = l.task_id);
  update public.project_work_plan_lines l set
    change_reason_code = coalesce(l.change_reason_code, p_plan.change_reason_code),
    responsible_party = coalesce(l.responsible_party, (select r.default_party from public.project_plan_change_reasons r
      where r.code = coalesce(l.change_reason_code, p_plan.change_reason_code)))
  where l.plan_id = p_plan.id and exists (select 1 from app_private.work_plan_changed_tasks(p_plan.id) c where c.task_id = l.task_id);
  update public.project_work_plans set
    responsible_party = coalesce(responsible_party, v_default_party),
    removed_lines = coalesce((select jsonb_agg(x.value || jsonb_build_object(
        'changeReasonCode', coalesce(x.value->>'changeReasonCode', p_plan.change_reason_code),
        'responsibleParty', coalesce(x.value->>'responsibleParty', (select r.default_party from public.project_plan_change_reasons r
          where r.code = coalesce(x.value->>'changeReasonCode', p_plan.change_reason_code)))))
      from jsonb_array_elements(app_private.work_plan_removed_lines(p_plan, p_plan.removed_lines)) x(value)), '[]'::jsonb)
  where id = p_plan.id;
  if jsonb_array_length(p_plan.attachments) = 0 and exists (
    select 1 from public.project_plan_change_reasons r
    where r.needs_document and (r.code = p_plan.change_reason_code
      or r.code in (select l.change_reason_code from public.project_work_plan_lines l where l.plan_id = p_plan.id)
      or r.code in (select x.value->>'changeReasonCode' from public.project_work_plans p, jsonb_array_elements(p.removed_lines) x(value) where p.id = p_plan.id))) then
    raise exception using errcode = '22023', message = 'WORK_PLAN_DOCUMENT_REQUIRED'; end if;
end;
$$;

-- Sau khi duyệt bản điều chỉnh tháng: đánh dấu KH tuần bị ảnh hưởng và KH vật tư cùng kỳ, báo người lập.
create function app_private.work_plan_after_approve(p_plan public.project_work_plans, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  w public.project_work_plans%rowtype;
  m public.project_material_plans%rowtype;
begin
  if p_plan.supersedes_plan_id is null then return; end if;
  v_reason := case p_plan.period_type when 'month' then 'Kế hoạch tháng ' || to_char(p_plan.period_start, 'MM/YYYY')
    else 'Kế hoạch tuần ' || to_char(p_plan.period_start, 'DD/MM') || '–' || to_char(p_plan.period_end, 'DD/MM') end
    || ' đã đổi sang bản ' || p_plan.revision_no
    || coalesce(' (' || (select r.label from public.project_plan_change_reasons r where r.code = p_plan.change_reason_code) || ')', '') || '.';
  if p_plan.period_type = 'month' then
    for w in select p.* from public.project_work_plans p join app_private.work_plan_affected_weeks(p_plan.id) a on a.plan_id = p.id for update of p
    loop
      update public.project_work_plans set needs_review_at = now(), needs_review_reason = v_reason, updated_at = now(), row_version = row_version + 1
      where id = w.id returning * into w;
      insert into public.project_work_plan_events (plan_id, action, actor_id, reason, detail)
      values (w.id, 'flag_review', p_actor, v_reason, jsonb_build_object('byPlanId', p_plan.id));
      perform app_private.work_plan_notify(w, array[w.created_by, w.submitted_by], p_actor,
        'Kế hoạch tuần ' || to_char(w.period_start, 'DD/MM') || '–' || to_char(w.period_end, 'DD/MM') || ' cần xem lại',
        v_reason || ' Xem lại kế hoạch tuần: điều chỉnh theo gợi ý hoặc giữ nguyên kèm lý do.', 'work_plan_review', 'warning');
    end loop;
  end if;
  for m in select * from public.project_material_plans where project_id = p_plan.project_id
    and construction_site_id is not distinct from p_plan.construction_site_id and period_type = p_plan.period_type
    and period_start = p_plan.period_start and status in ('approved', 'draft', 'submitted', 'returned') for update
  loop
    update public.project_material_plans set needs_review_at = now(), needs_review_reason = v_reason, updated_at = now(), row_version = row_version + 1
    where id = m.id returning * into m;
    insert into public.project_material_plan_events (plan_id, action, actor_id, reason, detail)
    values (m.id, 'flag_review', p_actor, v_reason, jsonb_build_object('byWorkPlanId', p_plan.id));
    perform app_private.material_plan_notify(m, array[m.created_by, m.submitted_by], p_actor,
      'Kế hoạch vật tư ' || case m.period_type when 'month' then 'tháng ' || to_char(m.period_start, 'MM/YYYY')
        else 'tuần ' || to_char(m.period_start, 'DD/MM') end || ' cần tính lại',
      v_reason || ' Tạo bản điều chỉnh vật tư để tính lại nhu cầu.', 'material_plan_review', 'warning');
  end loop;
end;
$$;

-- 5. JSON của một bản (thêm lý do, văn bản, dòng bị bỏ, cờ cần xem lại).
create or replace function app_private.work_plan_json(p_plan_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'projectId', p.project_id, 'constructionSiteId', p.construction_site_id,
    'periodType', p.period_type, 'periodStart', p.period_start, 'periodEnd', p.period_end, 'code', p.code,
    'status', p.status, 'revisionNo', p.revision_no, 'supersedesPlanId', p.supersedes_plan_id, 'note', p.note,
    'rowVersion', p.row_version, 'createdAt', p.created_at, 'updatedAt', p.updated_at,
    'createdBy', p.created_by, 'createdByName', (select u.name from public.users u where u.id = p.created_by),
    'submittedAt', p.submitted_at, 'submittedBy', p.submitted_by, 'submittedByName', (select u.name from public.users u where u.id = p.submitted_by),
    'submittedToUserId', p.submitted_to_user_id,
    'approvedAt', p.approved_at, 'approvedBy', p.approved_by, 'approvedByName', (select u.name from public.users u where u.id = p.approved_by),
    'returnedAt', p.returned_at, 'returnedByName', (select u.name from public.users u where u.id = p.returned_by),
    'returnReason', p.return_reason,
    'changeReasonCode', p.change_reason_code, 'responsibleParty', p.responsible_party, 'changeSummary', p.change_summary,
    'attachments', p.attachments, 'removedLines', p.removed_lines,
    'needsReviewAt', p.needs_review_at, 'needsReviewReason', p.needs_review_reason,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'taskId', l.task_id, 'workBoqItemId', l.work_boq_item_id, 'wbsCode', l.wbs_code_snapshot,
        'taskName', l.task_name_snapshot, 'groupName', l.group_name_snapshot, 'unit', l.unit_snapshot,
        'totalQty', l.total_qty_snapshot, 'doneBeforeQty', l.done_before_qty_snapshot,
        'plannedQty', l.planned_qty, 'plannedStart', l.planned_start, 'plannedEnd', l.planned_end,
        'crewLabel', l.crew_label, 'note', l.note,
        'changeReasonCode', l.change_reason_code, 'responsibleParty', l.responsible_party, 'changeNote', l.change_note,
        -- Actual in the period: cumulative at period end minus cumulative before it.
        -- Null when nothing was recorded up to the period end (unknown, not zero).
        'actualQty', case when f.done_end is null then null
          else greatest(f.done_end - coalesce(f.done_before, 0), 0) end,
        'lastProgressDate', f.last_progress_date
      ) order by l.sort_order, l.wbs_code_snapshot, l.task_name_snapshot)
      from public.project_work_plan_lines l
      left join lateral (
        select (select c.quantity_done from app_private.work_plan_task_cumulative(l.task_id, p.period_start - 1) c) done_before,
          at_end.quantity_done done_end, at_end.progress_date last_progress_date
        from (select 1) one
        left join lateral app_private.work_plan_task_cumulative(l.task_id, p.period_end) at_end on true
      ) f on true
      where l.plan_id = p.id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('action', e.action, 'at', e.created_at, 'reason', e.reason,
        'actorName', (select u.name from public.users u where u.id = e.actor_id)) order by e.created_at)
      from public.project_work_plan_events e where e.plan_id = p.id), '[]'::jsonb)
  )
  from public.project_work_plans p where p.id = p_plan_id;
$$;

-- 6. Bảng kỳ: thêm mọi phiên bản của kỳ, danh mục lý do, hôm nay, kỳ đã kết thúc.
create or replace function public.get_project_work_plan_board_v1(p_project_id text, p_construction_site_id text,
  p_period_type text, p_period_start date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_site text := nullif(p_construction_site_id, '');
  v_start date := case p_period_type when 'month' then date_trunc('month', p_period_start)::date
    else (p_period_start - (extract(isodow from p_period_start)::int - 1))::date end;
  v_end date;
  v_open uuid; v_approved uuid;
begin
  if p_period_type not in ('month', 'week') or p_period_start is null then
    raise exception using errcode = '22023', message = 'WORK_PLAN_PERIOD_INVALID';
  end if;
  if public.current_app_user_id() is null or not app_private.work_plan_can(p_project_id, v_site, 'view') then
    raise exception using errcode = '42501', message = 'WORK_PLAN_VIEW_DENIED';
  end if;
  v_end := app_private.work_plan_period_end(p_period_type, v_start);
  select id into v_open from public.project_work_plans where project_id = p_project_id
    and construction_site_id is not distinct from v_site and period_type = p_period_type and period_start = v_start
    and status in ('draft', 'submitted', 'returned');
  select id into v_approved from public.project_work_plans where project_id = p_project_id
    and construction_site_id is not distinct from v_site and period_type = p_period_type and period_start = v_start
    and status = 'approved';
  return jsonb_build_object(
    'periodType', p_period_type, 'periodStart', v_start, 'periodEnd', v_end,
    'code', app_private.work_plan_code(p_period_type, v_start),
    'today', app_private.work_plan_today(), 'periodEnded', v_end < app_private.work_plan_today(),
    'currentUserId', public.current_app_user_id(),
    'approved', case when v_approved is null then null else app_private.work_plan_json(v_approved) end,
    'open', case when v_open is null then null else app_private.work_plan_json(v_open) end,
    'versions', coalesce((select jsonb_agg(app_private.work_plan_json(v.id) order by v.revision_no)
      from public.project_work_plans v where v.project_id = p_project_id and v.construction_site_id is not distinct from v_site
        and v.period_type = p_period_type and v.period_start = v_start and v.status <> 'cancelled'), '[]'::jsonb),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'label', r.label, 'defaultParty', r.default_party,
        'needsDocument', r.needs_document) order by r.sort_order) from public.project_plan_change_reasons r where r.is_active), '[]'::jsonb),
    'permissions', jsonb_build_object(
      'canEdit', app_private.work_plan_can(p_project_id, v_site, 'edit'),
      'canSubmit', app_private.work_plan_can(p_project_id, v_site, 'submit'),
      'canDelete', app_private.work_plan_can(p_project_id, v_site, 'delete'),
      'canApprove', app_private.work_plan_can(p_project_id, v_site, app_private.work_plan_approve_action(p_period_type))),
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where u.id = any(app_private.work_plan_room_holders(p_project_id, v_site,
        app_private.work_plan_approve_action(p_period_type)))), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'code', h.code, 'periodStart', h.period_start,
        'periodEnd', h.period_end, 'status', h.status, 'revisionNo', h.revision_no,
        'lineCount', (select count(*) from public.project_work_plan_lines l where l.plan_id = h.id),
        'approvedAt', h.approved_at, 'updatedAt', h.updated_at) order by h.period_start desc, h.revision_no desc)
      from (select * from public.project_work_plans where project_id = p_project_id
        and construction_site_id is not distinct from v_site and period_type = p_period_type
        and status <> 'cancelled' order by period_start desc, revision_no desc limit 24) h), '[]'::jsonb)
  );
end;
$$;

-- 7. Lưu bản nháp / bản bị trả lại (thêm lý do, văn bản, ngày theo dòng; luật không sửa lùi).
create or replace function public.save_project_work_plan_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_work_plans%rowtype;
  v_project text := p_input->>'projectId';
  v_site text := nullif(p_input->>'constructionSiteId', '');
  v_type text := p_input->>'periodType';
  v_start date := (p_input->>'periodStart')::date;
  v_end date;
  v_sort integer := 0;
  v_party text := nullif(p_input->>'responsibleParty', '');
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'WORK_PLAN_EDIT_DENIED'; end if;
  if jsonb_typeof(p_input->'lines') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'WORK_PLAN_LINES_REQUIRED'; end if;
  if v_party is not null and v_party not in ('owner', 'company', 'vendor', 'objective') then
    raise exception using errcode = '22023', message = 'WORK_PLAN_PARTY_INVALID'; end if;
  if p_input ? 'attachments' and jsonb_typeof(p_input->'attachments') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'WORK_PLAN_ATTACHMENTS_INVALID'; end if;
  if p_input->>'planId' is not null then
    select * into v_plan from public.project_work_plans where id = (p_input->>'planId')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'WORK_PLAN_NOT_FOUND'; end if;
    v_project := v_plan.project_id; v_site := v_plan.construction_site_id; v_type := v_plan.period_type;
    v_start := v_plan.period_start; v_end := v_plan.period_end;
    if not app_private.work_plan_can(v_project, v_site, 'edit') then
      raise exception using errcode = '42501', message = 'WORK_PLAN_EDIT_DENIED'; end if;
    if v_plan.status not in ('draft', 'returned') then
      raise exception using errcode = 'PT409', message = 'WORK_PLAN_NOT_EDITABLE'; end if;
    if v_plan.row_version <> coalesce((p_input->>'expectedRowVersion')::bigint, -1) then
      raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_plan.period_end < app_private.work_plan_today() then
      raise exception using errcode = 'PT409', message = 'WORK_PLAN_PERIOD_ENDED'; end if;
  else
    if v_type not in ('month', 'week') or v_start is null then
      raise exception using errcode = '22023', message = 'WORK_PLAN_PERIOD_INVALID'; end if;
    if not app_private.work_plan_can(v_project, v_site, 'edit') then
      raise exception using errcode = '42501', message = 'WORK_PLAN_EDIT_DENIED'; end if;
    if (v_type = 'month' and v_start <> date_trunc('month', v_start)::date)
      or (v_type = 'week' and extract(isodow from v_start) <> 1) then
      raise exception using errcode = '22023', message = 'WORK_PLAN_PERIOD_INVALID'; end if;
    -- A project-wide grant does not prove an arbitrary site belongs to the project.
    begin
      perform app_private.assert_project_progress_scope_period(v_project, v_site, 'daily', v_start);
    exception when check_violation then
      raise exception using errcode = '42501', message = 'WORK_PLAN_SCOPE_DENIED';
    end;
    v_end := app_private.work_plan_period_end(v_type, v_start);
    if v_end < app_private.work_plan_today() then
      raise exception using errcode = 'PT409', message = 'WORK_PLAN_PERIOD_ENDED'; end if;
    perform pg_advisory_xact_lock(hashtextextended('work_plan:' || v_project || ':' || coalesce(v_site, '') || ':' || v_type || ':' || v_start, 0));
    if exists (select 1 from public.project_work_plans where project_id = v_project
      and construction_site_id is not distinct from v_site and period_type = v_type and period_start = v_start
      and status in ('draft', 'submitted', 'returned')) then
      raise exception using errcode = '23505', message = 'WORK_PLAN_ALREADY_OPEN'; end if;
    if exists (select 1 from public.project_work_plans where project_id = v_project
      and construction_site_id is not distinct from v_site and period_type = v_type and period_start = v_start
      and status = 'approved') then
      raise exception using errcode = '23505', message = 'WORK_PLAN_ALREADY_APPROVED'; end if;
    insert into public.project_work_plans (project_id, construction_site_id, period_type, period_start, period_end,
      code, created_by, updated_by)
    values (v_project, v_site, v_type, v_start, v_end, app_private.work_plan_code(v_type, v_start), v_actor, v_actor)
    returning * into v_plan;
    insert into public.project_work_plan_events (plan_id, action, actor_id) values (v_plan.id, 'create', v_actor);
  end if;

  delete from public.project_work_plan_lines where plan_id = v_plan.id;
  create temp table work_plan_input on commit drop as
    select (x.ord)::integer ord, x.value->>'taskId' task_id,
      nullif(x.value->>'plannedQty', '')::numeric planned_qty,
      nullif(x.value->>'plannedStart', '')::date planned_start, nullif(x.value->>'plannedEnd', '')::date planned_end,
      nullif(btrim(x.value->>'crewLabel'), '') crew_label, nullif(btrim(x.value->>'note'), '') note,
      nullif(x.value->>'changeReasonCode', '') change_reason_code, nullif(x.value->>'responsibleParty', '') responsible_party,
      nullif(btrim(x.value->>'changeNote'), '') change_note
    from jsonb_array_elements(p_input->'lines') with ordinality x(value, ord);
  if exists (select 1 from work_plan_input where planned_qty < 0) then
    raise exception using errcode = '22023', message = 'WORK_PLAN_QTY_INVALID'; end if;
  if exists (select 1 from work_plan_input where planned_start not between v_start and v_end
      or planned_end not between v_start and v_end or planned_end < planned_start) then
    raise exception using errcode = '22023', message = 'WORK_PLAN_DATES_OUTSIDE_PERIOD'; end if;
  if exists (select 1 from work_plan_input where responsible_party not in ('owner', 'company', 'vendor', 'objective')) then
    raise exception using errcode = '22023', message = 'WORK_PLAN_PARTY_INVALID'; end if;
  if exists (select 1 from work_plan_input i where i.change_reason_code is not null
      and not exists (select 1 from public.project_plan_change_reasons r where r.code = i.change_reason_code)) then
    raise exception using errcode = '22023', message = 'WORK_PLAN_REASON_INVALID'; end if;
  create temp table work_plan_facts on commit drop as
    select * from app_private.work_plan_task_facts(v_project, v_site, v_start, v_end);
  if exists (select 1 from work_plan_input i where not exists (select 1 from work_plan_facts f where f.task_id = i.task_id)) then
    raise exception using errcode = '22023', message = 'WORK_PLAN_TASK_INVALID'; end if;
  insert into public.project_work_plan_lines (plan_id, task_id, work_boq_item_id, wbs_code_snapshot, task_name_snapshot,
    group_name_snapshot, unit_snapshot, total_qty_snapshot, done_before_qty_snapshot, planned_qty, planned_start,
    planned_end, crew_label, note, sort_order, change_reason_code, responsible_party, change_note)
  select distinct on (i.task_id) v_plan.id, f.task_id, f.work_boq_item_id, f.wbs_code, f.task_name, f.group_name,
    f.unit, f.total_qty, f.done_before, i.planned_qty, i.planned_start, i.planned_end, i.crew_label, i.note, i.ord,
    i.change_reason_code, i.responsible_party, i.change_note
  from work_plan_input i join work_plan_facts f on f.task_id = i.task_id
  order by i.task_id, i.ord;
  select count(*) into v_sort from public.project_work_plan_lines where plan_id = v_plan.id;
  drop table work_plan_input; drop table work_plan_facts;

  update public.project_work_plans set note = nullif(btrim(p_input->>'note'), ''), updated_by = v_actor,
    updated_at = now(), row_version = row_version + 1,
    change_reason_code = case when p_input ? 'changeReasonCode' then nullif(p_input->>'changeReasonCode', '') else change_reason_code end,
    responsible_party = case when p_input ? 'responsibleParty' then v_party else responsible_party end,
    change_summary = case when p_input ? 'changeSummary' then nullif(btrim(p_input->>'changeSummary'), '') else change_summary end,
    attachments = case when p_input ? 'attachments' then p_input->'attachments' else attachments end
  where id = v_plan.id returning * into v_plan;
  if v_plan.change_reason_code is not null and not exists (select 1 from public.project_plan_change_reasons r where r.code = v_plan.change_reason_code) then
    raise exception using errcode = '22023', message = 'WORK_PLAN_REASON_INVALID'; end if;
  update public.project_work_plans set removed_lines = app_private.work_plan_removed_lines(v_plan,
    case when p_input ? 'removedLines' then p_input->'removedLines' else v_plan.removed_lines end)
  where id = v_plan.id returning * into v_plan;
  perform app_private.work_plan_assert_editable(v_plan);
  insert into public.project_work_plan_events (plan_id, action, actor_id, detail)
  values (v_plan.id, 'save', v_actor, jsonb_build_object('lines', v_sort));
  return jsonb_build_object('planId', v_plan.id, 'rowVersion', v_plan.row_version, 'status', v_plan.status);
end;
$$;

-- 8. Chuyển trạng thái: gửi (kiểm luật + lý do), duyệt / trả lại (khác người lập, người gửi), giữ nguyên khi cần xem lại.
create or replace function public.transition_project_work_plan_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_work_plans%rowtype;
  v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_to uuid := nullif(p_input->>'recipientUserId', '')::uuid;
  v_label text; v_period text;
begin
  select * into v_plan from public.project_work_plans where id = (p_input->>'planId')::uuid for update;
  if v_actor is null or not found then raise exception using errcode = '42501', message = 'WORK_PLAN_ACTION_DENIED'; end if;
  if v_plan.row_version <> coalesce((p_input->>'expectedRowVersion')::bigint, -1) then
    raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
  v_label := case v_plan.period_type when 'month' then 'Kế hoạch tháng ' || to_char(v_plan.period_start, 'MM/YYYY')
    else 'Kế hoạch tuần ' || to_char(v_plan.period_start, 'DD/MM') || '–' || to_char(v_plan.period_end, 'DD/MM/YYYY') end;

  if v_action = 'submit' then
    if not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'submit') then
      raise exception using errcode = '42501', message = 'WORK_PLAN_SUBMIT_DENIED'; end if;
    if v_plan.status not in ('draft', 'returned') then raise exception using errcode = 'PT409', message = 'WORK_PLAN_NOT_EDITABLE'; end if;
    if not exists (select 1 from public.project_work_plan_lines where plan_id = v_plan.id) then
      raise exception using errcode = '22023', message = 'WORK_PLAN_EMPTY'; end if;
    if v_to is not null and (v_to = v_actor or v_to = v_plan.created_by or not app_private.project_actor_has_effective_room_action(v_to, v_plan.project_id,
      v_plan.construction_site_id, 'work_plan', app_private.work_plan_approve_action(v_plan.period_type))) then
      raise exception using errcode = '22023', message = 'WORK_PLAN_APPROVER_INVALID'; end if;
    perform app_private.work_plan_assert_editable(v_plan);
    perform app_private.work_plan_prepare_submit(v_plan);
    update public.project_work_plans set status = 'submitted', submitted_by = v_actor, submitted_at = now(),
      submitted_to_user_id = v_to, updated_by = v_actor, updated_at = now(), row_version = row_version + 1
    where id = v_plan.id returning * into v_plan;
    perform app_private.work_plan_notify(v_plan, case when v_to is not null then array[v_to]
      else app_private.work_plan_room_holders(v_plan.project_id, v_plan.construction_site_id,
        app_private.work_plan_approve_action(v_plan.period_type)) end, v_actor,
      v_label || case when v_plan.supersedes_plan_id is not null then ' · bản điều chỉnh ' || v_plan.revision_no else '' end || ' chờ duyệt',
      coalesce((select name from public.users where id = v_actor), 'Người lập') || ' gửi ' || lower(left(v_label, 1)) || substr(v_label, 2) || ' để duyệt.'
        || coalesce(' Lý do: ' || left(v_plan.change_summary, 200), ''),
      'work_plan_submitted', 'info');
  elsif v_action = 'withdraw' then
    if v_plan.status <> 'submitted' or v_plan.submitted_by is distinct from v_actor then
      raise exception using errcode = '42501', message = 'WORK_PLAN_WITHDRAW_DENIED'; end if;
    update public.project_work_plans set status = 'draft', updated_by = v_actor, updated_at = now(), row_version = row_version + 1
    where id = v_plan.id returning * into v_plan;
  elsif v_action in ('approve', 'return') then
    if not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, app_private.work_plan_approve_action(v_plan.period_type)) then
      raise exception using errcode = '42501', message = 'WORK_PLAN_APPROVE_DENIED'; end if;
    if v_plan.status <> 'submitted' then raise exception using errcode = 'PT409', message = 'WORK_PLAN_NOT_SUBMITTED'; end if;
    if v_actor = v_plan.created_by or v_actor = v_plan.submitted_by then
      raise exception using errcode = '42501', message = 'WORK_PLAN_SELF_APPROVAL_DENIED'; end if;
    if v_action = 'return' then
      if v_reason is null then raise exception using errcode = '22023', message = 'WORK_PLAN_RETURN_REASON_REQUIRED'; end if;
      update public.project_work_plans set status = 'returned', returned_by = v_actor, returned_at = now(),
        return_reason = v_reason, updated_by = v_actor, updated_at = now(), row_version = row_version + 1
      where id = v_plan.id returning * into v_plan;
      perform app_private.work_plan_notify(v_plan, array[v_plan.created_by, v_plan.submitted_by], v_actor,
        v_label || ' bị trả lại', 'Lý do: ' || left(v_reason, 300), 'work_plan_returned', 'warning');
    else
      if v_plan.period_end < app_private.work_plan_today() then
        raise exception using errcode = 'PT409', message = 'WORK_PLAN_PERIOD_ENDED'; end if;
      -- The approved revision replaces the one it corrects.
      update public.project_work_plans set status = 'superseded', updated_at = now(), row_version = row_version + 1
      where project_id = v_plan.project_id and construction_site_id is not distinct from v_plan.construction_site_id
        and period_type = v_plan.period_type and period_start = v_plan.period_start and status = 'approved';
      if v_plan.supersedes_plan_id is not null then
        insert into public.project_work_plan_events (plan_id, action, actor_id, detail)
        values (v_plan.supersedes_plan_id, 'supersede', v_actor, jsonb_build_object('byPlanId', v_plan.id));
      end if;
      update public.project_work_plans set status = 'approved', approved_by = v_actor, approved_at = now(),
        needs_review_at = null, needs_review_reason = null,
        updated_by = v_actor, updated_at = now(), row_version = row_version + 1
      where id = v_plan.id returning * into v_plan;
      perform app_private.work_plan_notify(v_plan, array[v_plan.created_by, v_plan.submitted_by], v_actor,
        v_label || ' đã được duyệt', coalesce((select name from public.users where id = v_actor), 'Người duyệt') || ' đã duyệt.',
        'work_plan_approved', 'success');
      perform app_private.work_plan_after_approve(v_plan, v_actor);
    end if;
  elsif v_action = 'keep' then
    if not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'edit') then
      raise exception using errcode = '42501', message = 'WORK_PLAN_EDIT_DENIED'; end if;
    if v_plan.needs_review_at is null then raise exception using errcode = 'PT409', message = 'WORK_PLAN_NOT_FLAGGED'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'WORK_PLAN_KEEP_REASON_REQUIRED'; end if;
    update public.project_work_plans set needs_review_at = null, needs_review_reason = null, updated_by = v_actor,
      updated_at = now(), row_version = row_version + 1
    where id = v_plan.id returning * into v_plan;
  elsif v_action = 'delete' then
    if v_plan.status <> 'draft' or v_plan.submitted_at is not null
      or not (v_plan.created_by = v_actor or app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'delete')) then
      raise exception using errcode = '42501', message = 'WORK_PLAN_DELETE_DENIED'; end if;
    delete from public.project_work_plans where id = v_plan.id;
    return jsonb_build_object('planId', v_plan.id, 'deleted', true);
  else
    raise exception using errcode = '22023', message = 'WORK_PLAN_ACTION_INVALID';
  end if;
  insert into public.project_work_plan_events (plan_id, action, actor_id, reason) values (v_plan.id, v_action, v_actor, v_reason);
  return jsonb_build_object('planId', v_plan.id, 'rowVersion', v_plan.row_version, 'status', v_plan.status);
end;
$$;

-- 9. Tạo bản điều chỉnh: lý do chọn khi gửi; kỳ đã kết thúc thì không tạo.
create or replace function public.revise_project_work_plan_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_work_plans%rowtype;
  v_new public.project_work_plans%rowtype;
  v_reason text := nullif(btrim(p_input->>'reason'), '');
begin
  select * into v_plan from public.project_work_plans where id = (p_input->>'planId')::uuid for update;
  if v_actor is null or not found or not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'edit') then
    raise exception using errcode = '42501', message = 'WORK_PLAN_EDIT_DENIED'; end if;
  if v_plan.status <> 'approved' then raise exception using errcode = 'PT409', message = 'WORK_PLAN_NOT_APPROVED'; end if;
  if v_plan.period_end < app_private.work_plan_today() then
    raise exception using errcode = 'PT409', message = 'WORK_PLAN_PERIOD_ENDED'; end if;
  if exists (select 1 from public.project_work_plans where project_id = v_plan.project_id
    and construction_site_id is not distinct from v_plan.construction_site_id and period_type = v_plan.period_type
    and period_start = v_plan.period_start and status in ('draft', 'submitted', 'returned')) then
    raise exception using errcode = '23505', message = 'WORK_PLAN_ALREADY_OPEN'; end if;
  insert into public.project_work_plans (project_id, construction_site_id, period_type, period_start, period_end, code,
    revision_no, supersedes_plan_id, note, created_by, updated_by, change_summary)
  values (v_plan.project_id, v_plan.construction_site_id, v_plan.period_type, v_plan.period_start, v_plan.period_end,
    v_plan.code, (select max(revision_no) + 1 from public.project_work_plans where project_id = v_plan.project_id
      and construction_site_id is not distinct from v_plan.construction_site_id and period_type = v_plan.period_type
      and period_start = v_plan.period_start), v_plan.id, v_plan.note, v_actor, v_actor, v_reason)
  returning * into v_new;
  insert into public.project_work_plan_lines (plan_id, task_id, work_boq_item_id, wbs_code_snapshot, task_name_snapshot,
    group_name_snapshot, unit_snapshot, total_qty_snapshot, done_before_qty_snapshot, planned_qty, planned_start,
    planned_end, crew_label, note, sort_order)
  select v_new.id, task_id, work_boq_item_id, wbs_code_snapshot, task_name_snapshot, group_name_snapshot, unit_snapshot,
    total_qty_snapshot, done_before_qty_snapshot, planned_qty, planned_start, planned_end, crew_label, note, sort_order
  from public.project_work_plan_lines where plan_id = v_plan.id;
  insert into public.project_work_plan_events (plan_id, action, actor_id, reason, detail)
  values (v_new.id, 'revise', v_actor, v_reason, jsonb_build_object('fromPlanId', v_plan.id));
  return jsonb_build_object('planId', v_new.id, 'rowVersion', v_new.row_version, 'status', v_new.status);
end;
$$;

-- 10. Xem trước tác động của một bản so với bản nó thay thế: vật tư kéo theo (kèm tiền) và KH tuần bị ảnh hưởng.
create function public.preview_project_work_plan_impact_v1(p_plan_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_plan public.project_work_plans%rowtype;
begin
  select * into v_plan from public.project_work_plans where id = p_plan_id;
  if public.current_app_user_id() is null or not found
    or not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'view') then
    raise exception using errcode = '42501', message = 'WORK_PLAN_VIEW_DENIED'; end if;
  return jsonb_build_object(
    'materials', coalesce((
      with cur as (select d.item_id, d.unit, max(d.item_name) item_name, sum(d.derived_qty) qty
          from app_private.material_plan_derive(v_plan.id) d group by 1, 2),
        base as (select d.item_id, d.unit, max(d.item_name) item_name, sum(d.derived_qty) qty
          from app_private.material_plan_derive(v_plan.supersedes_plan_id) d where v_plan.supersedes_plan_id is not null group by 1, 2),
        j as (select coalesce(c.item_id, b.item_id) item_id, coalesce(c.unit, b.unit) unit, coalesce(c.item_name, b.item_name) item_name,
            coalesce(b.qty, 0) base_qty, coalesce(c.qty, 0) cur_qty
          from cur c full join base b on b.item_id = c.item_id and b.unit = c.unit),
        priced as (select j.*,
            (select max(m.budget_unit_price) from public.material_budget_items m where m.project_id = v_plan.project_id
              and m.inventory_item_id = j.item_id and m.unit = j.unit and m.budget_unit_price > 0) budget_price,
            (select (x.value->>'unitPrice')::numeric from public.purchase_orders o, jsonb_array_elements(o.items) x(value)
              where x.value->>'itemId' = j.item_id and lower(coalesce(x.value->>'unit', '')) = lower(j.unit)
                and coalesce(x.value->>'unitPrice', '') ~ '^[0-9]+(\.[0-9]+)?$' and (x.value->>'unitPrice')::numeric > 0
                and o.status not in ('cancelled', 'returned') and o.archived_at is null
              order by o.created_at desc limit 1) po_price
          from j where round(j.cur_qty - j.base_qty, 3) <> 0)
      select jsonb_agg(jsonb_build_object('itemId', item_id, 'itemName', item_name, 'unit', unit,
          'baseQty', round(base_qty, 3), 'newQty', round(cur_qty, 3), 'deltaQty', round(cur_qty - base_qty, 3),
          'unitPrice', coalesce(budget_price, po_price),
          'priceSource', case when budget_price is not null then 'budget' when po_price is not null then 'last_po' end)
        order by abs(cur_qty - base_qty) * coalesce(budget_price, po_price, 0) desc, item_name)
      from priced), '[]'::jsonb),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('planId', a.plan_id, 'periodStart', a.period_start, 'status', a.status,
        'createdByName', (select u.name from public.users u join public.project_work_plans w on w.created_by = u.id where w.id = a.plan_id))
        order by a.period_start)
      from app_private.work_plan_affected_weeks(v_plan.id) a), '[]'::jsonb),
    'materialPlans', coalesce((select jsonb_agg(jsonb_build_object('planId', m.id, 'status', m.status, 'revisionNo', m.revision_no))
      from public.project_material_plans m where m.project_id = v_plan.project_id and m.construction_site_id is not distinct from v_plan.construction_site_id
        and m.period_type = v_plan.period_type and m.period_start = v_plan.period_start and m.status in ('approved', 'draft', 'submitted', 'returned')), '[]'::jsonb)
  );
end;
$$;

-- 11. KH vật tư: người duyệt khác người lập, người gửi; duyệt bản mới chuyển liên kết đơn mua sang dòng mới (vá đặt trùng).
create or replace function public.transition_project_material_plan_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_material_plans%rowtype;
  v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_to uuid := nullif(p_input->>'recipientUserId', '')::uuid;
  v_label text; v_missing text;
  v_old uuid; v_moved integer := 0; v_kept integer := 0;
begin
  select * into v_plan from public.project_material_plans where id = (p_input->>'planId')::uuid for update;
  if v_actor is null or not found then raise exception using errcode = '42501', message = 'MATERIAL_PLAN_ACTION_DENIED'; end if;
  if v_plan.row_version <> coalesce((p_input->>'expectedRowVersion')::bigint, -1) then
    raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
  v_label := 'Kế hoạch vật tư ' || case v_plan.period_type when 'month' then 'tháng ' || to_char(v_plan.period_start, 'MM/YYYY')
    else 'tuần ' || to_char(v_plan.period_start, 'DD/MM') || '–' || to_char(v_plan.period_end, 'DD/MM/YYYY') end;

  if v_action = 'submit' then
    if not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'submit') then
      raise exception using errcode = '42501', message = 'MATERIAL_PLAN_SUBMIT_DENIED'; end if;
    if v_plan.status not in ('draft', 'returned') then raise exception using errcode = 'PT409', message = 'MATERIAL_PLAN_NOT_EDITABLE'; end if;
    if not exists (select 1 from public.project_material_plan_lines where plan_id = v_plan.id and requested_qty > 0) then
      raise exception using errcode = '22023', message = 'MATERIAL_PLAN_EMPTY'; end if;
    select string_agg(o.item_name, ', ') into v_missing
      from app_private.material_plan_over_boq_lines(v_plan) o where nullif(btrim(o.over_reason), '') is null;
    if v_missing is not null then
      raise exception using errcode = '22023', message = 'MATERIAL_PLAN_OVER_BOQ_REASON_REQUIRED', detail = v_missing; end if;
    if v_to is not null and (v_to = v_actor or v_to = v_plan.created_by or not app_private.project_actor_has_effective_room_action(v_to, v_plan.project_id,
      v_plan.construction_site_id, 'work_plan', 'verify')) then
      raise exception using errcode = '22023', message = 'MATERIAL_PLAN_APPROVER_INVALID'; end if;
    update public.project_material_plans set status = 'submitted', submitted_by = v_actor, submitted_at = now(),
      submitted_to_user_id = v_to, updated_by = v_actor, updated_at = now(), row_version = row_version + 1
    where id = v_plan.id returning * into v_plan;
    perform app_private.material_plan_notify(v_plan,
      case when v_to is not null then array[v_to]
        else app_private.work_plan_room_holders(v_plan.project_id, v_plan.construction_site_id, 'verify') end,
      v_actor, v_label || ' chờ duyệt', coalesce((select name from public.users where id = v_actor), 'Người lập') || ' gửi ' || lower(left(v_label, 1)) || substr(v_label, 2) || ' để duyệt.',
      'material_plan_submitted', 'info');
  elsif v_action = 'withdraw' then
    if v_plan.status <> 'submitted' or v_plan.submitted_by is distinct from v_actor then
      raise exception using errcode = '42501', message = 'MATERIAL_PLAN_WITHDRAW_DENIED'; end if;
    update public.project_material_plans set status = 'draft', updated_by = v_actor, updated_at = now(), row_version = row_version + 1
    where id = v_plan.id returning * into v_plan;
  elsif v_action in ('approve', 'return') then
    if not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'verify') then
      raise exception using errcode = '42501', message = 'MATERIAL_PLAN_APPROVE_DENIED'; end if;
    if v_plan.status <> 'submitted' then raise exception using errcode = 'PT409', message = 'MATERIAL_PLAN_NOT_SUBMITTED'; end if;
    if v_actor = v_plan.created_by or v_actor = v_plan.submitted_by then
      raise exception using errcode = '42501', message = 'MATERIAL_PLAN_SELF_APPROVAL_DENIED'; end if;
    if v_action = 'return' then
      if v_reason is null then raise exception using errcode = '22023', message = 'MATERIAL_PLAN_RETURN_REASON_REQUIRED'; end if;
      update public.project_material_plans set status = 'returned', returned_by = v_actor, returned_at = now(), return_reason = v_reason,
        updated_by = v_actor, updated_at = now(), row_version = row_version + 1
      where id = v_plan.id returning * into v_plan;
      perform app_private.material_plan_notify(v_plan,
        array[v_plan.created_by, v_plan.submitted_by], v_actor, v_label || ' bị trả lại', 'Lý do: ' || left(v_reason, 300),
        'material_plan_returned', 'warning');
    else
      select id into v_old from public.project_material_plans
      where project_id = v_plan.project_id and construction_site_id is not distinct from v_plan.construction_site_id
        and period_type = v_plan.period_type and period_start = v_plan.period_start and status = 'approved';
      update public.project_material_plans set status = 'superseded', updated_at = now(), row_version = row_version + 1
      where id = v_old;
      if v_plan.supersedes_plan_id is not null then
        insert into public.project_material_plan_events (plan_id, action, actor_id, detail)
        values (v_plan.supersedes_plan_id, 'supersede', v_actor, jsonb_build_object('byPlanId', v_plan.id));
      end if;
      update public.project_material_plans set status = 'approved', approved_by = v_actor, approved_at = now(),
        needs_review_at = null, needs_review_reason = null,
        updated_by = v_actor, updated_at = now(), row_version = row_version + 1
      where id = v_plan.id returning * into v_plan;
      if v_old is not null then
        -- Vật tư đã đặt nhưng không còn trong bản mới: giữ dòng nhu cầu 0 để đơn mua vẫn gắn được và truy vết.
        insert into public.project_material_plan_lines (plan_id, item_id, sku_snapshot, item_name_snapshot, unit, category,
          need_qty, requested_qty, note, sort_order)
        select v_plan.id, ol.item_id, ol.sku_snapshot, ol.item_name_snapshot, ol.unit, ol.category, 0, 0,
          'Không còn nhu cầu theo bản ' || v_plan.revision_no || ' — đã đặt ở bản trước', 9999
        from public.project_material_plan_lines ol
        where ol.plan_id = v_old
          and exists (select 1 from public.procurement_po_plan_links k where k.material_plan_line_id = ol.id)
          and not exists (select 1 from public.project_material_plan_lines nl where nl.plan_id = v_plan.id and nl.item_id = ol.item_id and nl.unit = ol.unit);
        get diagnostics v_kept = row_count;
        update public.procurement_po_plan_links k set material_plan_id = v_plan.id, material_plan_line_id = nl.id
        from public.project_material_plan_lines ol
        join public.project_material_plan_lines nl on nl.plan_id = v_plan.id and nl.item_id = ol.item_id and nl.unit = ol.unit
        where ol.plan_id = v_old and k.material_plan_line_id = ol.id;
        get diagnostics v_moved = row_count;
        if v_moved > 0 then
          insert into public.project_material_plan_events (plan_id, action, actor_id, detail)
          values (v_plan.id, 'relink', v_actor, jsonb_build_object('fromPlanId', v_old, 'links', v_moved, 'zeroNeedLines', v_kept));
        end if;
      end if;
      perform app_private.material_plan_notify(v_plan,
        array[v_plan.created_by, v_plan.submitted_by], v_actor, v_label || ' đã được duyệt',
        coalesce((select name from public.users where id = v_actor), 'Người duyệt') || ' đã duyệt.', 'material_plan_approved', 'success');
    end if;
  elsif v_action = 'keep' then
    if not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'edit') then
      raise exception using errcode = '42501', message = 'MATERIAL_PLAN_EDIT_DENIED'; end if;
    if v_plan.needs_review_at is null then raise exception using errcode = 'PT409', message = 'MATERIAL_PLAN_NOT_FLAGGED'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'MATERIAL_PLAN_KEEP_REASON_REQUIRED'; end if;
    update public.project_material_plans set needs_review_at = null, needs_review_reason = null, updated_by = v_actor,
      updated_at = now(), row_version = row_version + 1
    where id = v_plan.id returning * into v_plan;
  elsif v_action = 'delete' then
    if v_plan.status <> 'draft' or v_plan.submitted_at is not null
      or not (v_plan.created_by = v_actor or app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'delete')) then
      raise exception using errcode = '42501', message = 'MATERIAL_PLAN_DELETE_DENIED'; end if;
    delete from public.project_material_plans where id = v_plan.id;
    return jsonb_build_object('planId', v_plan.id, 'deleted', true);
  else
    raise exception using errcode = '22023', message = 'MATERIAL_PLAN_ACTION_INVALID';
  end if;
  insert into public.project_material_plan_events (plan_id, action, actor_id, reason) values (v_plan.id, v_action, v_actor, v_reason);
  return jsonb_build_object('planId', v_plan.id, 'rowVersion', v_plan.row_version, 'status', v_plan.status);
end;
$$;

-- 12. Cờ "cần tính lại" của KH vật tư hiện trên bảng vật tư.
create or replace function app_private.material_plan_json(p_plan_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'workPlanId', p.work_plan_id, 'projectId', p.project_id, 'constructionSiteId', p.construction_site_id,
    'periodType', p.period_type, 'periodStart', p.period_start, 'periodEnd', p.period_end, 'code', p.code,
    'status', p.status, 'revisionNo', p.revision_no, 'note', p.note, 'neededDate', p.needed_date,
    'destinationWarehouseId', p.destination_warehouse_id,
    'destinationWarehouseName', (select w.name from public.warehouses w where w.id = p.destination_warehouse_id),
    'rowVersion', p.row_version, 'createdAt', p.created_at, 'updatedAt', p.updated_at,
    'createdByName', (select u.name from public.users u where u.id = p.created_by),
    'submittedAt', p.submitted_at, 'submittedByName', (select u.name from public.users u where u.id = p.submitted_by),
    'approvedAt', p.approved_at, 'approvedByName', (select u.name from public.users u where u.id = p.approved_by),
    'returnedAt', p.returned_at, 'returnedByName', (select u.name from public.users u where u.id = p.returned_by),
    'returnReason', p.return_reason,
    'createdBy', p.created_by, 'submittedBy', p.submitted_by,
    'needsReviewAt', p.needs_review_at, 'needsReviewReason', p.needs_review_reason,
    'workPlanRevisionNo', (select w.revision_no from public.project_work_plans w where w.id = p.work_plan_id),
    'workPlanStatus', (select w.status from public.project_work_plans w where w.id = p.work_plan_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'itemId', l.item_id, 'sku', l.sku_snapshot, 'itemName', l.item_name_snapshot, 'unit', l.unit,
        'category', l.category, 'needQty', l.need_qty, 'requestedQty', l.requested_qty, 'neededDate', l.needed_date,
        'overReason', l.over_reason, 'note', l.note,
        'stockQtySnapshot', l.stock_qty_snapshot, 'boqQtySnapshot', l.boq_qty_snapshot, 'issuedBeforeSnapshot', l.issued_before_snapshot,
        'boqQty', pos.boq_qty, 'issuedQty', pos.issued_qty, 'stockQty', pos.stock_qty, 'stockKnown', pos.stock_known,
        'sources', coalesce((select jsonb_agg(jsonb_build_object('taskId', s.task_id, 'wbsCode', s.wbs_code_snapshot,
            'taskName', s.task_name_snapshot, 'plannedWorkQty', s.planned_work_qty, 'workTotalQty', s.work_total_qty,
            'workUnit', s.work_unit, 'budgetQty', s.budget_qty, 'derivedQty', s.derived_qty) order by s.wbs_code_snapshot)
          from public.project_material_plan_sources s where s.line_id = l.id), '[]'::jsonb)
      ) order by l.sort_order, l.item_name_snapshot)
      from public.project_material_plan_lines l
      left join lateral app_private.material_plan_item_position(p.project_id, p.construction_site_id, l.item_id, l.unit) pos on true
      where l.plan_id = p.id), '[]'::jsonb),
    'gaps', app_private.material_plan_gaps(p.work_plan_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'at', e.created_at, 'reason', e.reason,
        'actorName', (select u.name from public.users u where u.id = e.actor_id)) order by e.created_at)
      from public.project_material_plan_events e where e.plan_id = p.id), '[]'::jsonb)
  )
  from public.project_material_plans p where p.id = p_plan_id;
$$;

-- 13. Bảng vật tư: thêm người đang xem để ẩn nút duyệt với người lập / người gửi.
create or replace function public.get_project_material_plan_board_v1(p_project_id text, p_construction_site_id text,
  p_period_type text, p_period_start date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_site text := nullif(p_construction_site_id, '');
  v_start date := case p_period_type when 'month' then date_trunc('month', p_period_start)::date
    else (p_period_start - (extract(isodow from p_period_start)::int - 1))::date end;
  v_work uuid; v_open uuid; v_approved uuid;
begin
  if p_period_type not in ('month', 'week') or p_period_start is null then
    raise exception using errcode = '22023', message = 'WORK_PLAN_PERIOD_INVALID'; end if;
  if public.current_app_user_id() is null or not app_private.work_plan_can(p_project_id, v_site, 'view') then
    raise exception using errcode = '42501', message = 'WORK_PLAN_VIEW_DENIED'; end if;
  select id into v_work from public.project_work_plans where project_id = p_project_id
    and construction_site_id is not distinct from v_site and period_type = p_period_type and period_start = v_start and status = 'approved';
  select id into v_open from public.project_material_plans where project_id = p_project_id
    and construction_site_id is not distinct from v_site and period_type = p_period_type and period_start = v_start
    and status in ('draft', 'submitted', 'returned');
  select id into v_approved from public.project_material_plans where project_id = p_project_id
    and construction_site_id is not distinct from v_site and period_type = p_period_type and period_start = v_start
    and status = 'approved';
  return jsonb_build_object(
    'periodType', p_period_type, 'periodStart', v_start, 'periodEnd', app_private.work_plan_period_end(p_period_type, v_start),
    'currentUserId', public.current_app_user_id(),
    'workPlan', case when v_work is null then null else (select jsonb_build_object('id', w.id, 'code', w.code,
      'revisionNo', w.revision_no, 'approvedAt', w.approved_at,
      'lineCount', (select count(*) from public.project_work_plan_lines l where l.plan_id = w.id))
      from public.project_work_plans w where w.id = v_work) end,
    'workPlanPending', exists (select 1 from public.project_work_plans where project_id = p_project_id
      and construction_site_id is not distinct from v_site and period_type = p_period_type and period_start = v_start
      and status in ('draft', 'submitted', 'returned')),
    'approved', case when v_approved is null then null else app_private.material_plan_json(v_approved) end,
    'open', case when v_open is null then null else app_private.material_plan_json(v_open) end,
    'permissions', jsonb_build_object(
      'canEdit', app_private.work_plan_can(p_project_id, v_site, 'edit'),
      'canSubmit', app_private.work_plan_can(p_project_id, v_site, 'submit'),
      'canDelete', app_private.work_plan_can(p_project_id, v_site, 'delete'),
      'canApprove', app_private.work_plan_can(p_project_id, v_site, 'verify')),
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where u.id = any(app_private.work_plan_room_holders(p_project_id, v_site, 'verify'))), '[]'::jsonb),
    'warehouses', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'isDefault', coalesce(w.is_default_for_site, false))
        order by w.is_default_for_site desc nulls last, w.name)
      from public.warehouses w where w.project_id = p_project_id and not coalesce(w.is_archived, false)
        and (v_site is null or w.construction_site_id::text = v_site)), '[]'::jsonb)
  );
end;
$$;

revoke all on function app_private.work_plan_today(), app_private.work_plan_done_in_period(text, date),
  app_private.work_plan_changed_tasks(uuid), app_private.work_plan_assert_editable(public.project_work_plans),
  app_private.work_plan_removed_lines(public.project_work_plans, jsonb), app_private.work_plan_affected_weeks(uuid),
  app_private.work_plan_prepare_submit(public.project_work_plans), app_private.work_plan_after_approve(public.project_work_plans, uuid)
  from public, anon, authenticated;
revoke all on function public.preview_project_work_plan_impact_v1(uuid) from public, anon;
grant execute on function public.preview_project_work_plan_impact_v1(uuid) to authenticated;

notify pgrst, 'reload schema';
