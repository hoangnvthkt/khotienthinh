-- Điều chỉnh tiến độ có duyệt (PR-2, chủ sản phẩm duyệt mockup 15/10/2026).
--
-- Dự án bật "kiểm soát tiến độ" (SMB-2026, DA29):
--   * Ngày kế hoạch, khối lượng, thêm / xóa việc trên Gantt bị khóa. Muốn đổi thì lập phiếu điều chỉnh
--     (bản nháp), hệ thống tự liệt kê việc dời bao nhiêu ngày và ngày về đích; người lập chọn lý do,
--     bên chịu trách nhiệm (CĐT / Công ty / Khách quan) và đính kèm chứng từ.
--   * Tên việc, người phụ trách, ghi chú vẫn lưu thẳng, không cần duyệt.
--   * Room Tiến độ: edit = lập điều chỉnh; approve = Duyệt điều chỉnh (CHT); confirm = Duyệt dời ngày về đích
--     (bước thêm, tùy chọn: khi có người giữ quyền này, phiếu đổi ngày về đích đi tiếp sau CHT). Chỉ tính người
--     được gán đích danh (tài khoản ADMIN không tự có quyền lập / duyệt). Người lập không duyệt phiếu của mình;
--     phiếu do CHT tự lập thì người giữ quyền duyệt còn lại (Admin Hoàng) duyệt thay.
--   * Mỗi lần duyệt tự lưu một phiên bản (project_baselines.version_kind = 'approved'), thay "Chốt baseline"
--     bấm tay. Bản gốc = bảng tiến độ lúc bật (version 0). Hạn hợp đồng chỉ đổi khi phiếu ghi "CĐT chấp thuận
--     gia hạn" được duyệt.
--   * Sau khi duyệt, KH tháng / tuần còn hiệu lực có việc lệch ngày được đánh dấu "cần xem lại" và báo người lập.
-- Dự án chưa bật giữ nguyên cách cũ.

-- 1. Quyền Room Tiến độ.
insert into public.permission_actions (module_code, action, permission_code, label, description, scope_modes,
  legacy_module_key, legacy_route, legacy_admin_only, sort_order, is_active, risk_level, is_business_action,
  is_business_approval, direct_grant_requires_expiry, grant_readiness, access_application_code)
select 'project.gantt', a.action, 'project.gantt.' || a.action, a.label, a.description,
  array['global', 'project', 'construction_site']::text[], 'DA', '/da/tabs/gantt', true, a.sort_order, true,
  'sensitive', true, true, true, 'declared', 'project'
from (values
  ('approve', 'Duyệt điều chỉnh tiến độ', 'Duyệt hoặc trả lại phiếu điều chỉnh tiến độ (CHT).', 100),
  ('confirm', 'Duyệt dời ngày về đích', 'Bước duyệt thêm cho phiếu đổi ngày về đích (TGĐ, tùy chọn).', 110)
) a(action, label, description, sort_order)
on conflict (permission_code) do update set label = excluded.label, description = excluded.description,
  sort_order = excluded.sort_order, risk_level = excluded.risk_level, is_business_approval = excluded.is_business_approval,
  direct_grant_requires_expiry = excluded.direct_grant_requires_expiry, is_active = true, updated_at = now();

update public.project_permission_rooms
set allowed_actions = array['view', 'edit', 'delete', 'approve', 'confirm']::text[],
    description = 'Lập điều chỉnh tiến độ, duyệt điều chỉnh và duyệt dời ngày về đích.', updated_at = now()
where code = 'gantt';

insert into app_private.project_permission_room_action_bindings (room_code, action_code, legacy_permission_codes,
  enforcement_status, relationship_description, pbac_fallback_enabled, prerequisite_action_codes, verified_at,
  verified_source, created_at, updated_at)
select 'gantt', a.action, array['project.gantt.' || a.action]::text[], 'enforced', a.description, false,
  array['view']::text[], now(), 'project_schedule_changes_2026_10_15', now(), now()
from (values
  ('approve', 'CHT duyệt phiếu điều chỉnh tiến độ.'),
  ('confirm', 'Bước duyệt thêm khi phiếu đổi ngày về đích.')
) a(action, description)
on conflict (room_code, action_code) do update set legacy_permission_codes = excluded.legacy_permission_codes,
  enforcement_status = 'enforced', relationship_description = excluded.relationship_description,
  pbac_fallback_enabled = false, prerequisite_action_codes = excluded.prerequisite_action_codes,
  verified_at = now(), verified_source = excluded.verified_source, updated_at = now();

-- 2. Bảng.
create table public.project_schedule_controls (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  construction_site_id text,
  contract_finish_date date,
  enabled_at timestamptz not null default now(),
  enabled_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index project_schedule_controls_scope_uidx
  on public.project_schedule_controls (project_id, coalesce(construction_site_id, ''));

create table public.project_schedule_changes (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  construction_site_id text,
  code text not null unique,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'approved', 'cancelled')),
  step text check (step in ('approve', 'confirm')),
  reason_code text references public.project_plan_change_reasons(code),
  responsible_party text check (responsible_party in ('owner', 'company', 'objective')),
  summary text,
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  is_contract_extension boolean not null default false,
  finish_before date,
  finish_after date,
  approver_ids uuid[] not null default '{}',
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  confirmed_by uuid references public.users(id),
  confirmed_at timestamptz,
  returned_by uuid references public.users(id),
  returned_at timestamptz,
  return_reason text,
  version_id text references public.project_baselines(id) on delete set null,
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1
);
-- Mỗi phạm vi chỉ một phiếu đang mở (nháp / chờ duyệt / bị trả lại).
create unique index project_schedule_changes_open_uidx
  on public.project_schedule_changes (project_id, coalesce(construction_site_id, ''))
  where status in ('draft', 'submitted', 'returned');
create index project_schedule_changes_scope_idx on public.project_schedule_changes (project_id, construction_site_id, created_at desc);

create table public.project_schedule_change_lines (
  id uuid primary key default gen_random_uuid(),
  change_id uuid not null references public.project_schedule_changes(id) on delete cascade,
  task_id text not null,
  action text not null check (action in ('update', 'add', 'delete')),
  parent_id text,
  wbs_code text,
  task_name text not null,
  is_leaf boolean not null default true,
  before_start date,
  before_end date,
  before_qty numeric,
  after_start date,
  after_end date,
  after_qty numeric,
  delta_days integer,
  reason_code text references public.project_plan_change_reasons(code),
  responsible_party text check (responsible_party in ('owner', 'company', 'objective')),
  note text,
  payload jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  unique (change_id, task_id)
);

create table public.project_schedule_change_events (
  id uuid primary key default gen_random_uuid(),
  change_id uuid not null references public.project_schedule_changes(id) on delete cascade,
  action text not null check (action in ('create', 'save', 'submit', 'withdraw', 'return', 'approve', 'confirm', 'cancel')),
  actor_id uuid references public.users(id) on delete set null,
  reason text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index project_schedule_change_events_change_idx on public.project_schedule_change_events (change_id, created_at);

alter table public.project_baselines
  add column version_no integer,
  add column version_kind text not null default 'legacy' check (version_kind in ('legacy', 'original', 'approved')),
  add column schedule_change_id uuid references public.project_schedule_changes(id) on delete set null,
  add column finish_date date,
  add column is_contract boolean not null default false;

alter table public.project_schedule_controls enable row level security;
alter table public.project_schedule_changes enable row level security;
alter table public.project_schedule_change_lines enable row level security;
alter table public.project_schedule_change_events enable row level security;
create policy project_schedule_controls_select on public.project_schedule_controls for select to authenticated
  using (app_private.project_gantt_can_view(project_id, construction_site_id));
create policy project_schedule_changes_select on public.project_schedule_changes for select to authenticated
  using (app_private.project_gantt_can_view(project_id, construction_site_id));
create policy project_schedule_change_lines_select on public.project_schedule_change_lines for select to authenticated
  using (exists (select 1 from public.project_schedule_changes c where c.id = change_id
    and app_private.project_gantt_can_view(c.project_id, c.construction_site_id)));
create policy project_schedule_change_events_select on public.project_schedule_change_events for select to authenticated
  using (exists (select 1 from public.project_schedule_changes c where c.id = change_id
    and app_private.project_gantt_can_view(c.project_id, c.construction_site_id)));
revoke all on public.project_schedule_controls, public.project_schedule_changes, public.project_schedule_change_lines,
  public.project_schedule_change_events from anon;
revoke insert, update, delete on public.project_schedule_controls, public.project_schedule_changes,
  public.project_schedule_change_lines, public.project_schedule_change_events from authenticated;
grant select on public.project_schedule_controls, public.project_schedule_changes, public.project_schedule_change_lines,
  public.project_schedule_change_events to authenticated;

-- Chứng từ: bucket riêng, đường dẫn <projectId>/<siteId|->/<tệp>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('schedule-change-attachments', 'schedule-change-attachments', false, 26214400, array['image/jpeg', 'image/png', 'image/webp',
  'application/pdf', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy schedule_change_attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'schedule-change-attachments' and app_private.current_actor_has_effective_room_action(
    (storage.foldername(name))[1], nullif((storage.foldername(name))[2], '-'), 'gantt', 'view'));
create policy schedule_change_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'schedule-change-attachments' and app_private.current_actor_has_effective_room_action(
    (storage.foldername(name))[1], nullif((storage.foldername(name))[2], '-'), 'gantt', 'edit'));

-- 3. Hàm phụ.
create function app_private.schedule_control_of(p_project_id text, p_site_id text)
returns public.project_schedule_controls language sql stable security definer set search_path = '' as $$
  select c.* from public.project_schedule_controls c
  where c.project_id = p_project_id and c.construction_site_id is not distinct from nullif(btrim(coalesce(p_site_id, '')), '');
$$;

-- Người được gán đích danh một quyền Room Tiến độ (ADMIN không tự có).
create function app_private.gantt_room_holders(p_project_id text, p_site_id text, p_action text)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct u.id), '{}'::uuid[])
  from public.project_permission_room_members m
  join public.project_staff s on s.id = m.project_staff_id and s.end_date is null and s.project_id = p_project_id
  join public.users u on u.id::text = s.user_id and u.is_active and u.account_status = 'ACTIVE'
  where m.project_id = p_project_id and m.room_code = 'gantt' and m.is_active
    and (nullif(p_site_id, '') is null or m.construction_site_id is null or m.construction_site_id = p_site_id)
    and exists (select 1 from public.project_permission_room_member_actions a
      where a.room_member_id = m.id and a.action_code = p_action and a.is_active);
$$;

-- Người duyệt một phiếu: người giữ "Duyệt điều chỉnh" trừ người lập; ưu tiên người không phải tài khoản ADMIN (CHT),
-- chỉ khi không còn ai mới tới tài khoản ADMIN (phiếu do CHT tự lập → Admin duyệt thay).
create function app_private.schedule_pick_approvers(p_project_id text, p_site_id text, p_creator uuid)
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare v_holders uuid[]; v_pick uuid[];
begin
  v_holders := array(select h from unnest(app_private.gantt_room_holders(p_project_id, p_site_id, 'approve')) h where h <> p_creator);
  v_pick := array(select h from unnest(v_holders) h join public.users u on u.id = h where u.role <> 'ADMIN');
  if cardinality(v_pick) = 0 then v_pick := v_holders; end if;
  return v_pick;
end;
$$;

create function app_private.schedule_users_json(p_ids uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name), '[]'::jsonb)
  from public.users u where u.id = any(coalesce(p_ids, '{}'::uuid[]));
$$;

create function app_private.schedule_finish(p_project_id text, p_site_id text)
returns date language sql stable security definer set search_path = '' as $$
  select max(nullif(t.end_date, '')::date) from public.project_tasks t
  where t.project_id = p_project_id and t.construction_site_id is not distinct from p_site_id;
$$;

-- Ngày về đích nếu áp các dòng của phiếu.
create function app_private.schedule_change_finish_after(p_change_id uuid)
returns date language sql stable security definer set search_path = '' as $$
  with c as (select * from public.project_schedule_changes where id = p_change_id)
  select max(d) from (
    select coalesce(l.after_end, nullif(t.end_date, '')::date) d
    from c join public.project_tasks t on t.project_id = c.project_id and t.construction_site_id is not distinct from c.construction_site_id
    left join public.project_schedule_change_lines l on l.change_id = c.id and l.task_id = t.id
    where coalesce(l.action, 'update') <> 'delete'
    union all
    select l.after_end from c join public.project_schedule_change_lines l on l.change_id = c.id and l.action = 'add'
  ) x;
$$;

create function app_private.schedule_change_notify(p_change public.project_schedule_changes, p_recipients uuid[], p_actor uuid,
  p_title text, p_message text, p_type text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link,
    source_type, source_id, construction_site_id, priority, push_enabled, metadata, delivery_reason)
  select u.id::text, p_type, 'progress', p_title, p_message, p_message, p_type, '📅',
    '/#/da?' || concat_ws('&', 'projectId=' || p_change.project_id, 'siteId=' || nullif(p_change.construction_site_id, ''), 'tab=gantt'),
    'task_schedule_change', 'schedule_change_' || p_change.id || ':' || p_change.row_version || ':' || u.id,
    nullif(p_change.construction_site_id, ''), 'normal', true,
    jsonb_build_object('projectId', p_change.project_id, 'constructionSiteId', p_change.construction_site_id,
      'scheduleChangeId', p_change.id, 'deliveredBy', 'schedule_change_command'),
    'assigned'
  from (select distinct unnest(p_recipients) id) r
  join public.users u on u.id = r.id and u.is_active and u.account_status = 'ACTIVE'
  where r.id is distinct from p_actor;
end;
$$;

-- Quyền: xem theo Room (ADMIN qua được), lập / duyệt chỉ người được gán đích danh.
create function app_private.schedule_assert(p_project_id text, p_site_id text, p_action text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := app_private.assert_project_gantt_action(p_project_id, p_site_id, 'view');
  if (app_private.schedule_control_of(p_project_id, p_site_id)).id is null then
    raise exception using errcode = '22023', message = 'SCHEDULE_CONTROL_DISABLED';
  end if;
  if p_action <> 'view' and not app_private.project_user_has_room_action(v_actor, p_project_id, p_site_id, 'gantt', p_action) then
    raise exception using errcode = '42501', message = 'GANTT_PERMISSION_DENIED';
  end if;
  return v_actor;
end;
$$;

create function app_private.schedule_change_json(p_change_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'projectId', c.project_id, 'constructionSiteId', c.construction_site_id, 'code', c.code,
    'status', c.status, 'step', c.step, 'reasonCode', c.reason_code, 'responsibleParty', c.responsible_party,
    'summary', c.summary, 'attachments', c.attachments, 'isContractExtension', c.is_contract_extension,
    'finishBefore', c.finish_before, 'finishAfter', c.finish_after,
    'createdBy', c.created_by, 'createdByName', (select u.name from public.users u where u.id = c.created_by),
    'createdAt', c.created_at, 'submittedAt', c.submitted_at,
    'approvers', app_private.schedule_users_json(c.approver_ids),
    'approvedBy', c.approved_by, 'approvedByName', (select u.name from public.users u where u.id = c.approved_by), 'approvedAt', c.approved_at,
    'confirmedBy', c.confirmed_by, 'confirmedByName', (select u.name from public.users u where u.id = c.confirmed_by), 'confirmedAt', c.confirmed_at,
    'returnedBy', c.returned_by, 'returnedByName', (select u.name from public.users u where u.id = c.returned_by),
    'returnedAt', c.returned_at, 'returnReason', c.return_reason, 'versionId', c.version_id,
    'updatedAt', c.updated_at, 'rowVersion', c.row_version,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'taskId', l.task_id, 'action', l.action, 'parentId', l.parent_id, 'wbsCode', l.wbs_code, 'taskName', l.task_name,
        'isLeaf', l.is_leaf, 'beforeStart', l.before_start, 'beforeEnd', l.before_end, 'beforeQty', l.before_qty,
        'afterStart', l.after_start, 'afterEnd', l.after_end, 'afterQty', l.after_qty, 'deltaDays', l.delta_days,
        'reasonCode', l.reason_code, 'responsibleParty', l.responsible_party, 'note', l.note, 'payload', l.payload)
        order by l.sort_order, l.wbs_code, l.task_id) from public.project_schedule_change_lines l where l.change_id = c.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actorId', e.actor_id,
        'actorName', (select u.name from public.users u where u.id = e.actor_id), 'reason', e.reason, 'at', e.created_at)
        order by e.created_at) from public.project_schedule_change_events e where e.change_id = c.id), '[]'::jsonb))
  from public.project_schedule_changes c where c.id = p_change_id;
$$;

-- 4. Đọc trạng thái kiểm soát của một phạm vi.
create function public.get_project_schedule_control_v1(p_project_id text, p_construction_site_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_site text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_actor uuid := app_private.assert_project_gantt_action(p_project_id, v_site, 'view');
  v_ctl public.project_schedule_controls;
  v_open uuid;
begin
  v_ctl := app_private.schedule_control_of(p_project_id, v_site);
  if v_ctl.id is null then return jsonb_build_object('controlled', false, 'currentUserId', v_actor); end if;
  select c.id into v_open from public.project_schedule_changes c
  where c.project_id = p_project_id and c.construction_site_id is not distinct from v_site
    and c.status in ('draft', 'submitted', 'returned');
  return jsonb_build_object(
    'controlled', true,
    'currentUserId', v_actor,
    'enabledAt', v_ctl.enabled_at,
    'contractFinishDate', v_ctl.contract_finish_date,
    'currentFinish', app_private.schedule_finish(p_project_id, v_site),
    'canPropose', app_private.project_user_has_room_action(v_actor, p_project_id, v_site, 'gantt', 'edit'),
    'canApprove', app_private.project_user_has_room_action(v_actor, p_project_id, v_site, 'gantt', 'approve'),
    'canConfirm', app_private.project_user_has_room_action(v_actor, p_project_id, v_site, 'gantt', 'confirm'),
    'proposers', app_private.schedule_users_json(app_private.gantt_room_holders(p_project_id, v_site, 'edit')),
    'approvers', app_private.schedule_users_json(app_private.gantt_room_holders(p_project_id, v_site, 'approve')),
    'confirmers', app_private.schedule_users_json(app_private.gantt_room_holders(p_project_id, v_site, 'confirm')),
    'myApprovers', app_private.schedule_users_json(app_private.schedule_pick_approvers(p_project_id, v_site, v_actor)),
    'openChange', case when v_open is null then null else app_private.schedule_change_json(v_open) end,
    'recentChanges', coalesce((select jsonb_agg(x.j order by x.at desc) from (
        select jsonb_build_object('id', c.id, 'code', c.code, 'status', c.status, 'finishBefore', c.finish_before,
          'finishAfter', c.finish_after, 'createdByName', (select u.name from public.users u where u.id = c.created_by),
          'approvedAt', c.approved_at, 'confirmedAt', c.confirmed_at, 'reasonCode', c.reason_code, 'responsibleParty', c.responsible_party,
          'lineCount', (select count(*) from public.project_schedule_change_lines l where l.change_id = c.id)) j, c.updated_at at
        from public.project_schedule_changes c
        where c.project_id = p_project_id and c.construction_site_id is not distinct from v_site and c.status = 'approved'
        order by c.updated_at desc limit 20) x), '[]'::jsonb),
    'reviewPlans', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'periodType', p.period_type,
        'periodStart', p.period_start, 'periodEnd', p.period_end, 'status', p.status, 'reason', p.needs_review_reason,
        'flaggedAt', p.needs_review_at) order by p.period_start)
      from public.project_work_plans p
      where p.project_id = p_project_id and p.construction_site_id is not distinct from v_site
        and p.needs_review_at is not null and p.status in ('approved', 'draft', 'submitted', 'returned')
        and p.period_end >= app_private.work_plan_today()), '[]'::jsonb));
end;
$$;

-- 5. Lưu nháp: thay toàn bộ dòng. Máy chủ tự lấy số "trước" từ bảng tiến độ.
-- p_lines: [{taskId, action, afterStart, afterEnd, afterQty, reasonCode, responsibleParty, note,
--            name, parentId, wbsCode, unit, assignee, assigneeUserId, sortOrder, isMilestone (dòng thêm)}]
create function public.save_project_schedule_change_v1(p_project_id text, p_construction_site_id text, p_change_id uuid,
  p_expected_row_version bigint, p_header jsonb, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_site text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_actor uuid := app_private.schedule_assert(p_project_id, v_site, 'edit');
  v_change public.project_schedule_changes;
  v_seq integer;
  v_code text;
  v_party text;
begin
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_header, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'SCHEDULE_INVALID_PAYLOAD';
  end if;
  v_party := nullif(p_header->>'responsibleParty', '');

  if p_change_id is null then
    if exists (select 1 from public.project_schedule_changes c where c.project_id = p_project_id
      and c.construction_site_id is not distinct from v_site and c.status in ('draft', 'submitted', 'returned')) then
      raise exception using errcode = 'PT409', message = 'SCHEDULE_CHANGE_ALREADY_OPEN';
    end if;
    perform pg_advisory_xact_lock(hashtext('schedule_change_code:' || p_project_id));
    select count(*) + 1 into v_seq from public.project_schedule_changes c where c.project_id = p_project_id;
    select 'ĐC-' || coalesce(nullif(btrim(p.code), ''), left(p.id, 8)) || '-' || lpad(v_seq::text, 2, '0') into v_code
    from public.projects p where p.id = p_project_id;
    insert into public.project_schedule_changes (project_id, construction_site_id, code, created_by)
    values (p_project_id, v_site, v_code, v_actor) returning * into v_change;
    insert into public.project_schedule_change_events (change_id, action, actor_id) values (v_change.id, 'create', v_actor);
  else
    select * into v_change from public.project_schedule_changes where id = p_change_id for update;
    if v_change.id is null or v_change.project_id <> p_project_id or v_change.construction_site_id is distinct from v_site then
      raise exception using errcode = 'P0002', message = 'SCHEDULE_CHANGE_NOT_FOUND';
    end if;
    if v_change.created_by <> v_actor then raise exception using errcode = '42501', message = 'SCHEDULE_NOT_CREATOR'; end if;
    if v_change.status not in ('draft', 'returned') then raise exception using errcode = '22023', message = 'SCHEDULE_CHANGE_NOT_EDITABLE'; end if;
    if v_change.row_version <> coalesce(p_expected_row_version, -1) then raise exception using errcode = 'PT409', message = 'SCHEDULE_STALE_VERSION'; end if;
  end if;

  if v_party is not null and v_party not in ('owner', 'company', 'objective') then
    raise exception using errcode = '22023', message = 'SCHEDULE_INVALID_PAYLOAD';
  end if;
  update public.project_schedule_changes set
    reason_code = nullif(p_header->>'reasonCode', ''),
    responsible_party = v_party,
    summary = nullif(btrim(coalesce(p_header->>'summary', '')), ''),
    attachments = case when jsonb_typeof(p_header->'attachments') = 'array' then p_header->'attachments' else '[]'::jsonb end,
    is_contract_extension = coalesce((p_header->>'isContractExtension')::boolean, false),
    updated_at = now(), row_version = row_version + 1
  where id = v_change.id returning * into v_change;

  delete from public.project_schedule_change_lines where change_id = v_change.id;
  insert into public.project_schedule_change_lines (change_id, task_id, action, parent_id, wbs_code, task_name, is_leaf,
    before_start, before_end, before_qty, after_start, after_end, after_qty, delta_days, reason_code, responsible_party, note,
    payload, sort_order)
  select v_change.id, x.task_id, x.action,
    case when x.action = 'add' then nullif(x.j->>'parentId', '') else t.parent_id end,
    case when x.action = 'add' then nullif(btrim(coalesce(x.j->>'wbsCode', '')), '') else t.wbs_code end,
    coalesce(case when x.action = 'add' then nullif(btrim(coalesce(x.j->>'name', '')), '') else t.name end, '—'),
    not exists (select 1 from public.project_tasks c where c.parent_id = x.task_id),
    nullif(t.start_date, '')::date, nullif(t.end_date, '')::date, t.provisional_quantity,
    case when x.action = 'delete' then null else coalesce(nullif(x.j->>'afterStart', '')::date, nullif(t.start_date, '')::date) end,
    case when x.action = 'delete' then null else coalesce(nullif(x.j->>'afterEnd', '')::date, nullif(t.end_date, '')::date) end,
    case when x.action = 'delete' then null else coalesce(nullif(x.j->>'afterQty', '')::numeric, t.provisional_quantity) end,
    case when x.action = 'update' then coalesce(nullif(x.j->>'afterEnd', '')::date, nullif(t.end_date, '')::date) - nullif(t.end_date, '')::date end,
    nullif(x.j->>'reasonCode', ''), nullif(x.j->>'responsibleParty', ''), nullif(btrim(coalesce(x.j->>'note', '')), ''),
    case when x.action = 'add' then jsonb_strip_nulls(jsonb_build_object('unit', nullif(btrim(coalesce(x.j->>'unit', '')), ''),
      'assignee', nullif(btrim(coalesce(x.j->>'assignee', '')), ''), 'assigneeUserId', nullif(x.j->>'assigneeUserId', ''),
      'sortOrder', (x.j->>'sortOrder')::integer, 'isMilestone', coalesce((x.j->>'isMilestone')::boolean, false))) else '{}'::jsonb end,
    x.ord::integer
  from (select item.j, item.ord, item.j->>'taskId' task_id, coalesce(item.j->>'action', 'update') action
        from jsonb_array_elements(p_lines) with ordinality item(j, ord)) x
  left join public.project_tasks t on t.id = x.task_id and t.project_id = p_project_id and t.construction_site_id is not distinct from v_site;

  -- Kiểm tra dòng: việc phải thuộc phạm vi (trừ dòng thêm), ngày hợp lệ, lý do / bên hợp lệ.
  if exists (select 1 from public.project_schedule_change_lines l
      left join public.project_tasks t on t.id = l.task_id
      where l.change_id = v_change.id and (
        nullif(btrim(l.task_id), '') is null
        or l.action not in ('update', 'add', 'delete')
        or (l.action = 'add' and t.id is not null)
        or (l.action <> 'add' and (t.id is null or t.project_id <> p_project_id or t.construction_site_id is distinct from v_site))
        or (l.action <> 'delete' and (l.after_start is null or l.after_end is null or l.after_start > l.after_end or coalesce(l.after_qty, 0) < 0))
        or (l.responsible_party is not null and l.responsible_party not in ('owner', 'company', 'objective'))
        or (l.reason_code is not null and not exists (select 1 from public.project_plan_change_reasons r where r.code = l.reason_code and r.is_active))
        or (l.action = 'add' and l.task_name = '—'))) then
    raise exception using errcode = '22023', message = 'SCHEDULE_INVALID_LINE';
  end if;
  -- Dòng "sửa" không đổi gì thì bỏ.
  delete from public.project_schedule_change_lines l using public.project_tasks t
  where l.change_id = v_change.id and l.action = 'update' and t.id = l.task_id
    and l.after_start is not distinct from nullif(t.start_date, '')::date and l.after_end is not distinct from nullif(t.end_date, '')::date
    and l.after_qty is not distinct from t.provisional_quantity;

  update public.project_schedule_changes set finish_before = app_private.schedule_finish(p_project_id, v_site),
    finish_after = app_private.schedule_change_finish_after(v_change.id)
  where id = v_change.id returning * into v_change;
  return app_private.schedule_change_json(v_change.id);
end;
$$;

-- 6. Kiểm tra trước khi gửi / duyệt: việc chưa bị đổi từ lúc lập, không sửa lùi, xóa được.
create function app_private.schedule_change_validate(p_change public.project_schedule_changes)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := app_private.work_plan_today();
  v_bad text;
begin
  if not exists (select 1 from public.project_schedule_change_lines where change_id = p_change.id) then
    raise exception using errcode = '22023', message = 'SCHEDULE_NO_CHANGES';
  end if;
  -- Bảng tiến độ đã đổi sau khi lập phiếu.
  select coalesce(l.wbs_code || ' ', '') || l.task_name into v_bad
  from public.project_schedule_change_lines l left join public.project_tasks t on t.id = l.task_id
  where l.change_id = p_change.id and l.action <> 'add' and (t.id is null
    or nullif(t.start_date, '')::date is distinct from l.before_start or nullif(t.end_date, '')::date is distinct from l.before_end
    or t.provisional_quantity is distinct from l.before_qty)
  limit 1;
  if v_bad is not null then raise exception using errcode = 'PT409', message = 'SCHEDULE_CHANGE_STALE', detail = v_bad; end if;
  -- Không sửa lùi: việc đã làm giữ ngày bắt đầu; việc đã xong không đổi ngày; ngày kết thúc mới của việc chưa xong không trước hôm nay.
  select coalesce(l.wbs_code || ' ', '') || l.task_name into v_bad
  from public.project_schedule_change_lines l join public.project_tasks t on t.id = l.task_id
  where l.change_id = p_change.id and l.action = 'update' and l.is_leaf and (
    (t.progress >= 100 and (l.after_start is distinct from l.before_start or l.after_end is distinct from l.before_end))
    or ((t.progress > 0 or t.actual_start_date is not null) and l.after_start is distinct from l.before_start)
    or (t.progress < 100 and l.after_end is distinct from l.before_end and l.after_end < v_today))
  limit 1;
  if v_bad is not null then raise exception using errcode = '22023', message = 'SCHEDULE_BACKDATE', detail = v_bad; end if;
  select coalesce(l.wbs_code || ' ', '') || l.task_name into v_bad
  from public.project_schedule_change_lines l
  where l.change_id = p_change.id and l.action = 'add' and l.after_start < v_today limit 1;
  if v_bad is not null then raise exception using errcode = '22023', message = 'SCHEDULE_BACKDATE', detail = v_bad; end if;
  -- Xóa: cả nhánh con phải cùng xóa; việc đã có số liệu thực tế thì không xóa.
  select coalesce(l.wbs_code || ' ', '') || l.task_name into v_bad
  from public.project_schedule_change_lines l
  where l.change_id = p_change.id and l.action = 'delete' and (
    exists (select 1 from public.project_tasks c where c.parent_id = l.task_id
      and not exists (select 1 from public.project_schedule_change_lines d where d.change_id = p_change.id and d.task_id = c.id and d.action = 'delete'))
    or exists (select 1 from public.project_daily_task_progress x where x.task_id = l.task_id)
    or exists (select 1 from public.project_weekly_task_progress x where x.task_id = l.task_id)
    or exists (select 1 from public.daily_log_volumes x where x.task_id = l.task_id)
    or exists (select 1 from public.project_task_completion_requests x where x.task_id = l.task_id)
    or exists (select 1 from public.quantity_acceptance_items x where x.task_id = l.task_id)
    or exists (select 1 from public.project_delay_events x where x.task_id = l.task_id)
    or exists (select 1 from public.project_work_plan_lines x where x.task_id = l.task_id))
  limit 1;
  if v_bad is not null then raise exception using errcode = '23514', message = 'SCHEDULE_DELETE_BLOCKED', detail = v_bad; end if;
  -- Dòng thêm: việc cha phải có sẵn hoặc cùng được thêm; mã WBS không trùng.
  select l.task_name into v_bad from public.project_schedule_change_lines l
  where l.change_id = p_change.id and l.action = 'add' and l.parent_id is not null
    and not exists (select 1 from public.project_tasks p where p.id = l.parent_id and p.project_id = p_change.project_id
      and p.construction_site_id is not distinct from p_change.construction_site_id)
    and not exists (select 1 from public.project_schedule_change_lines a where a.change_id = p_change.id and a.action = 'add' and a.task_id = l.parent_id)
  limit 1;
  if v_bad is not null then raise exception using errcode = '23514', message = 'GANTT_HIERARCHY_INVALID', detail = v_bad; end if;
  select l.wbs_code into v_bad from public.project_schedule_change_lines l
  where l.change_id = p_change.id and l.action = 'add' and l.wbs_code is not null and (
    exists (select 1 from public.project_tasks t where t.project_id = p_change.project_id
      and t.construction_site_id is not distinct from p_change.construction_site_id and lower(btrim(t.wbs_code)) = lower(l.wbs_code)
      and not exists (select 1 from public.project_schedule_change_lines d where d.change_id = p_change.id and d.task_id = t.id and d.action = 'delete'))
    or (select count(*) from public.project_schedule_change_lines o where o.change_id = p_change.id and o.action = 'add'
      and lower(o.wbs_code) = lower(l.wbs_code)) > 1)
  limit 1;
  if v_bad is not null then raise exception using errcode = '23505', message = 'GANTT_DUPLICATE_WBS', detail = v_bad; end if;
end;
$$;

-- 7. Gửi duyệt.
create function public.submit_project_schedule_change_v1(p_change_id uuid, p_expected_row_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_change public.project_schedule_changes;
  v_actor uuid;
  v_ctl public.project_schedule_controls;
  v_approvers uuid[];
begin
  select * into v_change from public.project_schedule_changes where id = p_change_id for update;
  if v_change.id is null then raise exception using errcode = 'P0002', message = 'SCHEDULE_CHANGE_NOT_FOUND'; end if;
  v_actor := app_private.schedule_assert(v_change.project_id, v_change.construction_site_id, 'edit');
  if v_change.created_by <> v_actor then raise exception using errcode = '42501', message = 'SCHEDULE_NOT_CREATOR'; end if;
  if v_change.status not in ('draft', 'returned') then raise exception using errcode = '22023', message = 'SCHEDULE_CHANGE_NOT_EDITABLE'; end if;
  if v_change.row_version <> coalesce(p_expected_row_version, -1) then raise exception using errcode = 'PT409', message = 'SCHEDULE_STALE_VERSION'; end if;
  if v_change.reason_code is null or v_change.responsible_party is null then
    raise exception using errcode = '22023', message = 'SCHEDULE_REASON_REQUIRED';
  end if;
  if length(btrim(coalesce(v_change.summary, ''))) < 10 then
    raise exception using errcode = '22023', message = 'SCHEDULE_SUMMARY_REQUIRED';
  end if;
  perform app_private.schedule_change_validate(v_change);
  -- Lý do dòng mặc định theo lý do chính.
  update public.project_schedule_change_lines l set
    reason_code = coalesce(l.reason_code, v_change.reason_code),
    responsible_party = coalesce(l.responsible_party, v_change.responsible_party)
  where l.change_id = v_change.id;
  if jsonb_array_length(v_change.attachments) = 0 and (v_change.is_contract_extension or exists (
      select 1 from public.project_schedule_change_lines l
      left join public.project_plan_change_reasons r on r.code = l.reason_code
      where l.change_id = v_change.id and (l.responsible_party = 'owner' or r.needs_document))) then
    raise exception using errcode = '22023', message = 'SCHEDULE_DOCUMENT_REQUIRED';
  end if;
  v_ctl := app_private.schedule_control_of(v_change.project_id, v_change.construction_site_id);
  v_change.finish_before := app_private.schedule_finish(v_change.project_id, v_change.construction_site_id);
  v_change.finish_after := app_private.schedule_change_finish_after(v_change.id);
  if v_change.is_contract_extension and (v_change.responsible_party <> 'owner'
    or v_change.finish_after is null or v_change.finish_after <= coalesce(v_ctl.contract_finish_date, v_change.finish_after - 1)) then
    raise exception using errcode = '22023', message = 'SCHEDULE_EXTENSION_INVALID';
  end if;

  v_approvers := app_private.schedule_pick_approvers(v_change.project_id, v_change.construction_site_id, v_change.created_by);
  if cardinality(v_approvers) = 0 then raise exception using errcode = '22023', message = 'SCHEDULE_NO_APPROVER'; end if;

  update public.project_schedule_changes set status = 'submitted', step = 'approve', approver_ids = v_approvers,
    finish_before = v_change.finish_before, finish_after = v_change.finish_after, submitted_at = now(),
    returned_by = null, returned_at = null, return_reason = null, updated_at = now(), row_version = row_version + 1
  where id = v_change.id returning * into v_change;
  insert into public.project_schedule_change_events (change_id, action, actor_id, detail)
  values (v_change.id, 'submit', v_actor, jsonb_build_object('finishBefore', v_change.finish_before, 'finishAfter', v_change.finish_after,
    'lines', (select count(*) from public.project_schedule_change_lines l where l.change_id = v_change.id)));
  perform app_private.schedule_change_notify(v_change, v_approvers, v_actor,
    'Chờ bạn duyệt điều chỉnh tiến độ ' || v_change.code,
    (select u.name from public.users u where u.id = v_actor) || ' gửi điều chỉnh '
      || (select count(*) from public.project_schedule_change_lines l where l.change_id = v_change.id) || ' việc'
      || case when v_change.finish_after is distinct from v_change.finish_before
        then ', về đích ' || to_char(v_change.finish_before, 'DD/MM/YYYY') || ' → ' || to_char(v_change.finish_after, 'DD/MM/YYYY') else '' end || '.',
    'approval_request');
  return app_private.schedule_change_json(v_change.id);
end;
$$;

-- 8. Rút lại (chờ duyệt → nháp) và bỏ phiếu.
create function public.withdraw_project_schedule_change_v1(p_change_id uuid, p_expected_row_version bigint, p_cancel boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_change public.project_schedule_changes;
  v_actor uuid;
begin
  select * into v_change from public.project_schedule_changes where id = p_change_id for update;
  if v_change.id is null then raise exception using errcode = 'P0002', message = 'SCHEDULE_CHANGE_NOT_FOUND'; end if;
  v_actor := app_private.schedule_assert(v_change.project_id, v_change.construction_site_id, 'edit');
  if v_change.created_by <> v_actor then raise exception using errcode = '42501', message = 'SCHEDULE_NOT_CREATOR'; end if;
  if v_change.row_version <> coalesce(p_expected_row_version, -1) then raise exception using errcode = 'PT409', message = 'SCHEDULE_STALE_VERSION'; end if;
  if coalesce(p_cancel, false) then
    if v_change.status not in ('draft', 'returned', 'submitted') then raise exception using errcode = '22023', message = 'SCHEDULE_CHANGE_NOT_EDITABLE'; end if;
    update public.project_schedule_changes set status = 'cancelled', step = null, updated_at = now(), row_version = row_version + 1
    where id = v_change.id returning * into v_change;
    insert into public.project_schedule_change_events (change_id, action, actor_id) values (v_change.id, 'cancel', v_actor);
  else
    if v_change.status <> 'submitted' or v_change.step <> 'approve' then raise exception using errcode = '22023', message = 'SCHEDULE_CHANGE_NOT_EDITABLE'; end if;
    update public.project_schedule_changes set status = 'draft', step = null, approver_ids = '{}', updated_at = now(), row_version = row_version + 1
    where id = v_change.id returning * into v_change;
    insert into public.project_schedule_change_events (change_id, action, actor_id) values (v_change.id, 'withdraw', v_actor);
  end if;
  return app_private.schedule_change_json(v_change.id);
end;
$$;

-- 9. Áp phiếu đã duyệt vào bảng tiến độ, lưu phiên bản, đánh dấu KH tháng/tuần lệch.
create function app_private.schedule_change_apply(p_change public.project_schedule_changes, p_actor uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_mode text;
  v_version_id text := gen_random_uuid()::text;
  v_version_no integer;
  v_ids text[];
  v_reason text;
  w public.project_work_plans%rowtype;
begin
  perform app_private.schedule_change_validate(p_change);
  perform t.id from public.project_tasks t
  where t.project_id = p_change.project_id and t.construction_site_id is not distinct from p_change.construction_site_id
  order by t.id for update;

  update public.project_tasks t set start_date = l.after_start::text, end_date = l.after_end::text,
    duration = l.after_end - l.after_start, provisional_quantity = coalesce(l.after_qty, t.provisional_quantity)
  from public.project_schedule_change_lines l
  where l.change_id = p_change.id and l.action = 'update' and t.id = l.task_id;

  select r.mode into v_mode from app_private.daily_log_wbs_rollout_scopes r
  where (r.project_id is null or r.project_id = p_change.project_id)
    and (r.construction_site_id is null or r.construction_site_id = p_change.construction_site_id)
  order by (r.project_id is not null) desc, (r.construction_site_id is not null) desc, r.updated_at desc limit 1;
  insert into public.project_tasks (id, project_id, construction_site_id, parent_id, name, start_date, end_date, duration,
    progress, progress_mode, assignee, assignee_user_id, dependencies, is_milestone, sort_order, wbs_code, fallback_unit,
    provisional_quantity, watchers)
  select l.task_id, p_change.project_id, p_change.construction_site_id, null, l.task_name, l.after_start::text, l.after_end::text,
    l.after_end - l.after_start, 0, case when v_mode = 'enforced' then 'weekly_report' else 'manual' end,
    l.payload->>'assignee', l.payload->>'assigneeUserId', '[]'::jsonb, coalesce((l.payload->>'isMilestone')::boolean, false),
    coalesce((l.payload->>'sortOrder')::integer, 0), l.wbs_code, l.payload->>'unit', coalesce(l.after_qty, 0), '{}'::text[]
  from public.project_schedule_change_lines l where l.change_id = p_change.id and l.action = 'add';
  update public.project_tasks t set parent_id = l.parent_id
  from public.project_schedule_change_lines l
  where l.change_id = p_change.id and l.action = 'add' and t.id = l.task_id and l.parent_id is not null;

  select array_agg(l.task_id) into v_ids from public.project_schedule_change_lines l where l.change_id = p_change.id and l.action = 'delete';
  if v_ids is not null then
    update public.project_tasks task set dependencies = coalesce((
        select jsonb_agg(dependency) from jsonb_array_elements(coalesce(task.dependencies, '[]'::jsonb)) dependency
        where not (dependency ->> 'taskId' = any(v_ids)) and not (dependency ->> 'task_id' = any(v_ids))), '[]'::jsonb)
    where task.project_id = p_change.project_id and task.construction_site_id is not distinct from p_change.construction_site_id
      and not task.id = any(v_ids)
      and exists (select 1 from jsonb_array_elements(coalesce(task.dependencies, '[]'::jsonb)) dependency
        where dependency ->> 'taskId' = any(v_ids) or dependency ->> 'task_id' = any(v_ids));
    delete from public.task_contract_items link where link.task_id = any(v_ids);
    delete from public.project_tasks task where task.id = any(v_ids);
  end if;

  select coalesce(max(b.version_no), 0) + 1 into v_version_no from public.project_baselines b
  where b.project_id = p_change.project_id and b.construction_site_id is not distinct from p_change.construction_site_id
    and b.version_kind <> 'legacy';
  insert into public.project_baselines (id, project_id, construction_site_id, name, locked_at, locked_by, tasks_snapshot,
    version_no, version_kind, schedule_change_id, finish_date, is_contract)
  select v_version_id, p_change.project_id, p_change.construction_site_id, 'Phiên bản ' || v_version_no || ' — ' || p_change.code,
    now(), p_actor::text, coalesce(jsonb_agg(to_jsonb(task) order by task.sort_order, task.id), '[]'::jsonb),
    v_version_no, 'approved', p_change.id, max(nullif(task.end_date, '')::date), p_change.is_contract_extension
  from public.project_tasks task
  where task.project_id = p_change.project_id and task.construction_site_id is not distinct from p_change.construction_site_id;
  if p_change.is_contract_extension then
    update public.project_schedule_controls c set contract_finish_date = p_change.finish_after, updated_at = now()
    where c.project_id = p_change.project_id and c.construction_site_id is not distinct from p_change.construction_site_id;
  end if;

  -- KH tháng / tuần còn hiệu lực có việc mà phần ngày nằm trong kỳ thay đổi, hoặc việc thêm mới rơi vào kỳ.
  v_reason := 'Tiến độ đổi theo ' || p_change.code || ' (Phiên bản ' || v_version_no || ').';
  for w in
    select p.* from public.project_work_plans p
    where p.project_id = p_change.project_id and p.construction_site_id is not distinct from p_change.construction_site_id
      and p.status in ('approved', 'draft', 'submitted', 'returned') and p.period_end >= app_private.work_plan_today()
      and exists (select 1 from public.project_schedule_change_lines l where l.change_id = p_change.id and l.is_leaf and (
        (l.action in ('update', 'delete') and exists (select 1 from public.project_work_plan_lines pl where pl.plan_id = p.id and pl.task_id = l.task_id)
          and (l.action = 'delete'
            or greatest(l.before_start, p.period_start) is distinct from greatest(l.after_start, p.period_start)
            or least(l.before_end, p.period_end) is distinct from least(l.after_end, p.period_end)
            or l.before_qty is distinct from l.after_qty))
        or (l.action in ('update', 'add') and l.after_start <= p.period_end and l.after_end >= p.period_start
          and not exists (select 1 from public.project_work_plan_lines pl where pl.plan_id = p.id and pl.task_id = l.task_id))))
    for update of p
  loop
    update public.project_work_plans set needs_review_at = now(), needs_review_reason = v_reason, updated_at = now(), row_version = row_version + 1
    where id = w.id returning * into w;
    insert into public.project_work_plan_events (plan_id, action, actor_id, reason, detail)
    values (w.id, 'flag_review', p_actor, v_reason, jsonb_build_object('byScheduleChangeId', p_change.id));
    perform app_private.work_plan_notify(w, array[w.created_by, w.submitted_by], p_actor,
      case w.period_type when 'month' then 'Kế hoạch tháng ' || to_char(w.period_start, 'MM/YYYY')
        else 'Kế hoạch tuần ' || to_char(w.period_start, 'DD/MM') || '–' || to_char(w.period_end, 'DD/MM') end || ' lệch tiến độ mới',
      v_reason || ' Lập bản điều chỉnh theo gợi ý hoặc giữ nguyên kèm lý do.', 'work_plan_review', 'warning');
  end loop;
  return v_version_id;
end;
$$;

-- 10. Duyệt / trả lại.
create function public.decide_project_schedule_change_v1(p_change_id uuid, p_expected_row_version bigint, p_decision text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_change public.project_schedule_changes;
  v_actor uuid;
  v_confirmers uuid[];
  v_version text;
  v_actor_name text;
begin
  select * into v_change from public.project_schedule_changes where id = p_change_id for update;
  if v_change.id is null then raise exception using errcode = 'P0002', message = 'SCHEDULE_CHANGE_NOT_FOUND'; end if;
  v_actor := app_private.schedule_assert(v_change.project_id, v_change.construction_site_id, 'view');
  if v_change.status <> 'submitted' then raise exception using errcode = '22023', message = 'SCHEDULE_CHANGE_NOT_PENDING'; end if;
  if v_change.row_version <> coalesce(p_expected_row_version, -1) then raise exception using errcode = 'PT409', message = 'SCHEDULE_STALE_VERSION'; end if;
  if v_actor = v_change.created_by then raise exception using errcode = '42501', message = 'SCHEDULE_SELF_APPROVAL'; end if;
  if v_change.step = 'approve' then
    if not (v_actor = any(v_change.approver_ids))
      or not app_private.project_user_has_room_action(v_actor, v_change.project_id, v_change.construction_site_id, 'gantt', 'approve') then
      raise exception using errcode = '42501', message = 'GANTT_PERMISSION_DENIED';
    end if;
  elsif not app_private.project_user_has_room_action(v_actor, v_change.project_id, v_change.construction_site_id, 'gantt', 'confirm')
    or v_actor = v_change.approved_by then
    raise exception using errcode = '42501', message = 'GANTT_PERMISSION_DENIED';
  end if;
  v_actor_name := (select u.name from public.users u where u.id = v_actor);

  if p_decision = 'return' then
    if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception using errcode = '22023', message = 'SCHEDULE_RETURN_REASON_REQUIRED'; end if;
    update public.project_schedule_changes set status = 'returned', step = null, returned_by = v_actor, returned_at = now(),
      return_reason = btrim(p_reason), approved_by = null, approved_at = null, updated_at = now(), row_version = row_version + 1
    where id = v_change.id returning * into v_change;
    insert into public.project_schedule_change_events (change_id, action, actor_id, reason) values (v_change.id, 'return', v_actor, btrim(p_reason));
    perform app_private.schedule_change_notify(v_change, array[v_change.created_by], v_actor,
      'Điều chỉnh tiến độ ' || v_change.code || ' bị trả lại', v_actor_name || ': ' || btrim(p_reason), 'warning');
    return app_private.schedule_change_json(v_change.id);
  elsif p_decision <> 'approve' then
    raise exception using errcode = '22023', message = 'SCHEDULE_INVALID_PAYLOAD';
  end if;

  if v_change.step = 'approve' then
    update public.project_schedule_changes set approved_by = v_actor, approved_at = now(), updated_at = now()
    where id = v_change.id returning * into v_change;
    insert into public.project_schedule_change_events (change_id, action, actor_id, reason) values (v_change.id, 'approve', v_actor, nullif(btrim(coalesce(p_reason, '')), ''));
    -- Đổi ngày về đích và dự án có người giữ "Duyệt dời về đích" → thêm bước.
    v_confirmers := array(select h from unnest(app_private.gantt_room_holders(v_change.project_id, v_change.construction_site_id, 'confirm')) h
      where h <> v_change.created_by and h <> v_actor);
    if v_change.finish_after is distinct from v_change.finish_before and cardinality(v_confirmers) > 0 then
      update public.project_schedule_changes set step = 'confirm', approver_ids = v_confirmers, row_version = row_version + 1
      where id = v_change.id returning * into v_change;
      perform app_private.schedule_change_notify(v_change, v_confirmers, v_actor,
        'Chờ bạn duyệt dời ngày về đích ' || v_change.code,
        v_actor_name || ' đã duyệt. Về đích ' || to_char(v_change.finish_before, 'DD/MM/YYYY') || ' → ' || to_char(v_change.finish_after, 'DD/MM/YYYY') || '.',
        'approval_request');
      return app_private.schedule_change_json(v_change.id);
    end if;
  else
    update public.project_schedule_changes set confirmed_by = v_actor, confirmed_at = now(), updated_at = now()
    where id = v_change.id returning * into v_change;
    insert into public.project_schedule_change_events (change_id, action, actor_id, reason) values (v_change.id, 'confirm', v_actor, nullif(btrim(coalesce(p_reason, '')), ''));
  end if;

  v_version := app_private.schedule_change_apply(v_change, v_actor);
  update public.project_schedule_changes set status = 'approved', step = null, version_id = v_version, updated_at = now(), row_version = row_version + 1
  where id = v_change.id returning * into v_change;
  perform app_private.schedule_change_notify(v_change, array[v_change.created_by, v_change.approved_by], v_actor,
    'Điều chỉnh tiến độ ' || v_change.code || ' đã được duyệt', 'Đã lưu thành phiên bản mới trên Gantt.', 'success');
  return app_private.schedule_change_json(v_change.id);
end;
$$;

create function public.get_project_schedule_change_v1(p_change_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_change public.project_schedule_changes;
begin
  select * into v_change from public.project_schedule_changes where id = p_change_id;
  if v_change.id is null then raise exception using errcode = 'P0002', message = 'SCHEDULE_CHANGE_NOT_FOUND'; end if;
  perform app_private.assert_project_gantt_action(v_change.project_id, v_change.construction_site_id, 'view');
  return app_private.schedule_change_json(v_change.id);
end;
$$;

-- 11. Khóa đường sửa thẳng ở phạm vi đã bật (bọc hàm bằng cách đổi tên).
alter function app_private.save_project_gantt_tasks_impl(uuid, text, text, jsonb) rename to save_project_gantt_tasks_schedule_base_v1;
revoke all on function app_private.save_project_gantt_tasks_schedule_base_v1(uuid, text, text, jsonb) from public, anon, authenticated;
create function app_private.save_project_gantt_tasks_impl(p_request_id uuid, p_project_id text, p_construction_site_id text, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_site text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_changes jsonb := p_changes;
  v_actor uuid;
begin
  if (app_private.schedule_control_of(p_project_id, v_site)).id is not null and jsonb_typeof(coalesce(p_changes, 'null'::jsonb)) = 'array' then
    v_actor := app_private.assert_project_gantt_action(p_project_id, v_site, 'edit');
    if not app_private.project_user_has_room_action(v_actor, p_project_id, v_site, 'gantt', 'edit') then
      raise exception using errcode = '42501', message = 'GANTT_PERMISSION_DENIED';
    end if;
    if exists (select 1 from jsonb_array_elements(p_changes) item(change)
        left join public.project_tasks task on jsonb_typeof(item.change) = 'object' and task.id = item.change->>'id'
        where jsonb_typeof(item.change) = 'object' and (task.id is null
          or (item.change ? 'start_date' and item.change->>'start_date' is distinct from task.start_date)
          or (item.change ? 'end_date' and item.change->>'end_date' is distinct from task.end_date)
          or (item.change ? 'provisional_quantity'
            and greatest(coalesce(nullif(item.change->>'provisional_quantity', '')::numeric, 0), 0) is distinct from coalesce(task.provisional_quantity, 0)))) then
      raise exception using errcode = '22023', message = 'SCHEDULE_CHANGE_REQUIRED';
    end if;
    -- Thời lượng và cột baseline theo bảng hiện tại.
    select coalesce(jsonb_agg(case when jsonb_typeof(item.change) <> 'object' then item.change
        else item.change || jsonb_build_object('duration', task.duration, 'baseline_start', task.baseline_start,
          'baseline_end', task.baseline_end, 'baseline_locked', task.baseline_locked, 'baseline_version', task.baseline_version,
          'baseline_change_reason', task.baseline_change_reason) end order by item.ord), '[]'::jsonb)
    into v_changes
    from jsonb_array_elements(p_changes) with ordinality item(change, ord)
    left join public.project_tasks task on jsonb_typeof(item.change) = 'object' and task.id = item.change->>'id';
  end if;
  return app_private.save_project_gantt_tasks_schedule_base_v1(p_request_id, p_project_id, p_construction_site_id, v_changes);
end;
$$;
revoke all on function app_private.save_project_gantt_tasks_impl(uuid, text, text, jsonb) from public, anon;
grant execute on function app_private.save_project_gantt_tasks_impl(uuid, text, text, jsonb) to authenticated;

alter function app_private.delete_project_gantt_task_tree_impl(uuid, text, text, text, bigint) rename to delete_project_gantt_task_tree_schedule_base_v1;
revoke all on function app_private.delete_project_gantt_task_tree_schedule_base_v1(uuid, text, text, text, bigint) from public, anon, authenticated;
create function app_private.delete_project_gantt_task_tree_impl(p_request_id uuid, p_project_id text, p_construction_site_id text,
  p_task_id text, p_expected_row_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (app_private.schedule_control_of(p_project_id, p_construction_site_id)).id is not null then
    raise exception using errcode = '22023', message = 'SCHEDULE_CHANGE_REQUIRED';
  end if;
  return app_private.delete_project_gantt_task_tree_schedule_base_v1(p_request_id, p_project_id, p_construction_site_id, p_task_id, p_expected_row_version);
end;
$$;
revoke all on function app_private.delete_project_gantt_task_tree_impl(uuid, text, text, text, bigint) from public, anon;
grant execute on function app_private.delete_project_gantt_task_tree_impl(uuid, text, text, text, bigint) to authenticated;

alter function app_private.apply_project_gantt_forecast_impl(uuid, text, text, jsonb, jsonb, jsonb) rename to apply_project_gantt_forecast_schedule_base_v1;
revoke all on function app_private.apply_project_gantt_forecast_schedule_base_v1(uuid, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
create function app_private.apply_project_gantt_forecast_impl(p_request_id uuid, p_project_id text, p_construction_site_id text,
  p_revision jsonb, p_revision_tasks jsonb, p_task_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (app_private.schedule_control_of(p_project_id, p_construction_site_id)).id is not null then
    raise exception using errcode = '22023', message = 'SCHEDULE_CHANGE_REQUIRED';
  end if;
  return app_private.apply_project_gantt_forecast_schedule_base_v1(p_request_id, p_project_id, p_construction_site_id,
    p_revision, p_revision_tasks, p_task_changes);
end;
$$;
revoke all on function app_private.apply_project_gantt_forecast_impl(uuid, text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function app_private.apply_project_gantt_forecast_impl(uuid, text, text, jsonb, jsonb, jsonb) to authenticated;

alter function app_private.create_project_gantt_baseline_impl(uuid, text, text, text) rename to create_project_gantt_baseline_schedule_base_v1;
revoke all on function app_private.create_project_gantt_baseline_schedule_base_v1(uuid, text, text, text) from public, anon, authenticated;
create function app_private.create_project_gantt_baseline_impl(p_request_id uuid, p_project_id text, p_construction_site_id text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (app_private.schedule_control_of(p_project_id, p_construction_site_id)).id is not null then
    raise exception using errcode = '22023', message = 'SCHEDULE_VERSION_AUTOMATIC';
  end if;
  return app_private.create_project_gantt_baseline_schedule_base_v1(p_request_id, p_project_id, p_construction_site_id, p_name);
end;
$$;
revoke all on function app_private.create_project_gantt_baseline_impl(uuid, text, text, text) from public, anon;
grant execute on function app_private.create_project_gantt_baseline_impl(uuid, text, text, text) to authenticated;

revoke all on function public.get_project_schedule_control_v1(text, text) from public, anon;
revoke all on function public.save_project_schedule_change_v1(text, text, uuid, bigint, jsonb, jsonb) from public, anon;
revoke all on function public.submit_project_schedule_change_v1(uuid, bigint) from public, anon;
revoke all on function public.withdraw_project_schedule_change_v1(uuid, bigint, boolean) from public, anon;
revoke all on function public.decide_project_schedule_change_v1(uuid, bigint, text, text) from public, anon;
revoke all on function public.get_project_schedule_change_v1(uuid) from public, anon;
grant execute on function public.get_project_schedule_control_v1(text, text) to authenticated;
grant execute on function public.save_project_schedule_change_v1(text, text, uuid, bigint, jsonb, jsonb) to authenticated;
grant execute on function public.submit_project_schedule_change_v1(uuid, bigint) to authenticated;
grant execute on function public.withdraw_project_schedule_change_v1(uuid, bigint, boolean) to authenticated;
grant execute on function public.decide_project_schedule_change_v1(uuid, bigint, text, text) to authenticated;
grant execute on function public.get_project_schedule_change_v1(uuid) to authenticated;

-- 12. Bật cho SMB-2026 và DA29 (chủ sản phẩm 06/10 + 15/10): bản gốc = bảng tiến độ hiện tại.
do $$
declare
  p record;
  v_admin uuid := '928d3473-49a2-4427-a319-19729689a084'; -- Admin Hoàng
  v_before jsonb;
  v_after jsonb;
begin
  for p in
    select pr.id, pr.code, pr.construction_site_id::text site, pr.end_date,
      case pr.code
        when 'SMB-2026' then array['d0a300a0-1586-4748-b6e7-71773addc004', '81fbdde9-4bf1-42c2-be4f-23c9c823ac1f',
          'f16b6505-83d8-438e-b680-5f469f734b91', 'dfc81157-ecde-4ad1-b9fc-f2938c14e859']::uuid[] -- Sơn, Việt, Thành, Khôi
        else array['98f1dc6f-cf5c-41d3-8559-1461dfd2524a', '7cc8e2f9-c2c8-4c7e-a3a1-4f0af46f676a',
          '248cd764-f22c-4b1b-ad10-e059692abc35']::uuid[] end proposers, -- Năm, Dương, Danh
      case pr.code when 'SMB-2026' then 'd0a300a0-1586-4748-b6e7-71773addc004'::uuid
        else '98f1dc6f-cf5c-41d3-8559-1461dfd2524a'::uuid end cht -- CHT Sơn / CHT Năm
    from public.projects pr where pr.code in ('SMB-2026', 'DA29')
  loop
    insert into public.project_schedule_controls (project_id, construction_site_id, contract_finish_date, enabled_by)
    values (p.id, p.site, p.end_date, v_admin) on conflict do nothing;

    if not exists (select 1 from public.project_baselines b where b.project_id = p.id and b.version_kind = 'original') then
      insert into public.project_baselines (id, project_id, construction_site_id, name, locked_at, locked_by, tasks_snapshot,
        version_no, version_kind, finish_date)
      select gen_random_uuid()::text, p.id, p.site, 'Bản gốc — ' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY'),
        now(), v_admin::text, coalesce(jsonb_agg(to_jsonb(task) order by task.sort_order, task.id), '[]'::jsonb),
        0, 'original', max(nullif(task.end_date, '')::date)
      from public.project_tasks task where task.project_id = p.id and task.construction_site_id is not distinct from p.site;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'action_code', a.action_code) order by s.user_id, a.action_code), '[]'::jsonb)
    into v_before
    from public.project_permission_room_members m
    join public.project_staff s on s.id = m.project_staff_id
    join public.project_permission_room_member_actions a on a.room_member_id = m.id and a.is_active
    where m.project_id = p.id and m.room_code = 'gantt' and m.is_active;

    -- Sửa / xóa chỉ còn người lập; xóa việc đi qua phiếu nên không ai giữ "Xóa".
    update public.project_permission_room_member_actions a set is_active = false, updated_at = now(), granted_by = v_admin
    from public.project_permission_room_members m join public.project_staff s on s.id = m.project_staff_id
    where a.room_member_id = m.id and m.project_id = p.id and m.room_code = 'gantt' and a.is_active
      and (a.action_code = 'delete' or (a.action_code = 'edit' and not (s.user_id = any(p.proposers::text[]))));
    insert into public.project_permission_room_member_actions (room_member_id, action_code, is_active, granted_by)
    select m.id, x.action_code, true, v_admin
    from public.project_permission_room_members m join public.project_staff s on s.id = m.project_staff_id and s.end_date is null
    cross join lateral (values ('view'), ('edit')) x(action_code)
    where m.project_id = p.id and m.room_code = 'gantt' and m.is_active and s.user_id = any(p.proposers::text[])
    on conflict (room_member_id, action_code) do update set is_active = true, updated_at = now(), granted_by = excluded.granted_by;
    -- Duyệt điều chỉnh: CHT; Admin Hoàng duyệt thay khi CHT tự lập.
    insert into public.project_permission_room_member_actions (room_member_id, action_code, is_active, granted_by)
    select m.id, x.action_code, true, v_admin
    from public.project_permission_room_members m join public.project_staff s on s.id = m.project_staff_id and s.end_date is null
    cross join lateral (values ('view'), ('approve')) x(action_code)
    where m.project_id = p.id and m.room_code = 'gantt' and m.is_active and s.user_id in (p.cht::text, v_admin::text)
    on conflict (room_member_id, action_code) do update set is_active = true, updated_at = now(), granted_by = excluded.granted_by;

    select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'action_code', a.action_code) order by s.user_id, a.action_code), '[]'::jsonb)
    into v_after
    from public.project_permission_room_members m
    join public.project_staff s on s.id = m.project_staff_id
    join public.project_permission_room_member_actions a on a.room_member_id = m.id and a.is_active
    where m.project_id = p.id and m.room_code = 'gantt' and m.is_active;
    insert into public.permission_audit_events (actor_user_id, event_type, before_grants, after_grants, metadata)
    values (v_admin, 'replace_project_permission_room_members', v_before, v_after,
      jsonb_build_object('project_id', p.id, 'construction_site_id', p.site, 'room_code', 'gantt',
        'source', 'project_schedule_changes_2026_10_15'));
  end loop;
end;
$$;
