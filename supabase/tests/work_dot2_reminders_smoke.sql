-- Vioo Work Đợt 2 PR-8: nhắc chốt kỳ + nhắc chưa nhận việc / chờ duyệt lâu lúc 08:00. Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261024120000_work_dot2_reminders.sql \
--   --smoke supabase/tests/work_dot2_reminders_smoke.sql
-- Vai (tên giả): head = Văn Thị Diệu (trưởng U1) · staff = Ông Đình Khải (U1) · head2 = Lâm Bảo Trâm (trưởng U2) · staff3 = Mạc Văn Hưng (U2)
--   · head5 = Đàm Quốc Thái (trưởng U5, đơn vị không có việc) · bld = Giáp Thị Oanh (U3, xem toàn công ty) · outsider = Vi Văn Lộc (U3).
-- Kỳ thử: công ty tuần, chốt thứ 7 17:00 ⇒ tuần 36 (31/08 – 06/09/2026) chốt 05/09 17:00. U1 lịch riêng tháng, chốt thứ 6 cuối tháng 16:00.
-- Nhắc gọi thẳng app_private.work_send_close_reminders(p_now) / work_enqueue_stale_reminders(), không phụ thuộc cron. Mọi dữ liệu hoàn tác.
create temporary table wt_people(name text primary key, full_name text, id uuid default gen_random_uuid(),
  email text default ('work-dot2r-'||gen_random_uuid()||'@invalid.local'), employee_id uuid default gen_random_uuid());
insert into wt_people(name, full_name) values ('head', 'Văn Thị Diệu'), ('staff', 'Ông Đình Khải'), ('head2', 'Lâm Bảo Trâm'),
  ('staff3', 'Mạc Văn Hưng'), ('head5', 'Đàm Quốc Thái'), ('bld', 'Giáp Thị Oanh'), ('outsider', 'Vi Văn Lộc');
insert into public.users(id,name,username,email,role)
  select id,full_name,'work-dot2r-'||id,email,'EMPLOYEE'::public.user_role from wt_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select p.id, g.code, g.scope, '*', 'Work dot2 reminders rollback test' from wt_people p
  cross join (values ('work.module.access','global'),('work.task.create','own'),('work.task.view_related','own'),('work.task.view_related','assigned')) g(code,scope);
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason,expires_at)
  select id,'work.task.view_scope','global','*','Work dot2 reminders rollback test',null from wt_people where name = 'bld';
grant select on wt_people to authenticated, anon;

create function pg_temp.p(p_name text) returns uuid language sql as $$ select id from wt_people where name = p_name $$;
create function pg_temp.ok(cond boolean, message text) returns void language plpgsql as $$ begin
  if cond is distinct from true then raise exception 'Work dot2 reminders test failed: %', message; end if;
end $$;

-- ── Sơ đồ tổ chức giả ──────────────────────────────────────────────────────────────────────────────────
create temporary table wt_refs as select gen_random_uuid() as u1, gen_random_uuid() as u2, gen_random_uuid() as u3, gen_random_uuid() as u5,
  gen_random_uuid() as slot1, gen_random_uuid() as slot2, gen_random_uuid() as slot5;
grant select on wt_refs to authenticated, anon;
create function pg_temp.u(p_name text) returns uuid language sql as $$
  select case p_name when 'u1' then u1 when 'u2' then u2 when 'u3' then u3 when 'u5' then u5 end from wt_refs $$;
set local session_replication_role = 'replica';
insert into public.org_units(id, name, type, code)
  select u1, 'Work dot2r U1', 'department', 'WD2R-U1' from wt_refs union all select u2, 'Work dot2r U2', 'department', 'WD2R-U2' from wt_refs
  union all select u3, 'Work dot2r U3', 'department', 'WD2R-U3' from wt_refs union all select u5, 'Work dot2r U5', 'department', 'WD2R-U5' from wt_refs;
insert into public.hrm_org_position_slots(id, code, org_unit_id, position_id)
  select slot1, 'WD2R-HEAD1', u1, gen_random_uuid() from wt_refs union all select slot2, 'WD2R-HEAD2', u2, gen_random_uuid() from wt_refs
  union all select slot5, 'WD2R-HEAD5', u5, gen_random_uuid() from wt_refs;
update public.org_units o set manager_slot_id = s.slot from (
    select u1 as unit, slot1 as slot from wt_refs union all select u2, slot2 from wt_refs union all select u5, slot5 from wt_refs) s
  where o.id = s.unit;
insert into public.employees(id, full_name, user_id, org_unit_id, status)
  select employee_id, full_name, id, pg_temp.u(case name when 'head' then 'u1' when 'staff' then 'u1' when 'head2' then 'u2'
      when 'staff3' then 'u2' when 'head5' then 'u5' else 'u3' end), 'Đang làm việc'
  from wt_people;
insert into public.hrm_employee_slot_assignments(employee_id, slot_id, assignment_type, status, effective_from)
  select (select employee_id from wt_people where name = 'head'), slot1, 'PRIMARY', 'ACTIVE', date '2026-01-01' from wt_refs
  union all select (select employee_id from wt_people where name = 'head2'), slot2, 'PRIMARY', 'ACTIVE', date '2026-01-01' from wt_refs
  union all select (select employee_id from wt_people where name = 'head5'), slot5, 'ACTING', 'ACTIVE', date '2026-01-01' from wt_refs;

-- ── Việc thử (chèn thẳng, mã VW-2099-…) ───────────────────────────────────────────────────────────────
--   c1..c3: số kỳ (tuần 36 / tháng 9). a1..a3: chờ nhận. r1..r3: chờ duyệt.
create temporary table wt_tasks(name text primary key, id uuid default gen_random_uuid(), assignee text, status text,
  deadline timestamptz, done_at timestamptz, assigned_ago interval default interval '2 days', ack_due timestamptz,
  reviewer text, submitted_ago interval);
grant select on wt_tasks to authenticated, anon;
insert into wt_tasks(name, assignee, status, deadline, done_at, assigned_ago, ack_due, reviewer, submitted_ago) values
  ('c1', 'staff', 'completed', '2026-09-02 10:00+07', '2026-09-01 10:00+07', interval '60 days', null, null, null),   -- U1 đúng hạn
  ('c2', 'staff', 'in_progress', '2026-09-04 10:00+07', null, interval '60 days', null, null, null),                  -- U1 quá hạn
  ('c3', 'staff3', 'in_progress', '2026-09-03 10:00+07', null, interval '60 days', null, null, null),                 -- U2 quá hạn
  ('a1', 'staff', 'pending_acknowledgement', null, null, interval '25 hours', null, null, null),                      -- giao 25 giờ, không hạn ⇒ nhắc
  ('a2', 'staff', 'pending_acknowledgement', null, null, interval '25 hours', now() + interval '1 hour', null, null),   -- có hạn ⇒ không nhắc kiểu mới
  ('a3', 'staff', 'pending_acknowledgement', null, null, interval '23 hours', null, null, null),                      -- chưa đủ 24 giờ
  ('r1', 'staff', 'awaiting_review', null, null, interval '3 days', null, 'head', interval '30 hours'),               -- chờ duyệt 30 giờ ⇒ nhắc
  ('r2', 'staff', 'awaiting_review', null, null, interval '3 days', null, 'head', interval '2 hours'),                -- mới nộp
  ('r3', 'staff', 'awaiting_review', null, null, interval '3 days', null, null, interval '30 hours');                 -- không có người duyệt
insert into public.work_tasks(id, task_code, title, scope_type, status, priority, privacy, deadline_at, created_by, completed_at, reviewer_user_id)
  select w.id, 'VW-2099-' || lpad((row_number() over (order by w.name) + floor(random() * 90000000)::int)::text, 9, '0'),
    'PR8: ' || w.name, 'direct', w.status, 'normal', 'standard', w.deadline, pg_temp.p('bld'),
    case when w.status = 'completed' then w.done_at end, pg_temp.p(w.reviewer)
  from wt_tasks w;
insert into public.work_task_assignments(task_id, user_id, state, assigned_by, assigned_at, acknowledgement_due_at, acknowledged_at, completed_at, ended_at)
  select w.id, pg_temp.p(w.assignee),
    case w.status when 'completed' then 'completed' else w.status end,
    pg_temp.p('bld'), now() - w.assigned_ago, w.ack_due,
    case when w.status <> 'pending_acknowledgement' then now() - w.assigned_ago + interval '1 hour' end,
    case when w.status = 'completed' then w.done_at end, case when w.status = 'completed' then w.done_at end
  from wt_tasks w;
insert into public.work_task_submissions(task_id, iteration, submitted_by, status, submitted_at)
  select w.id, 1, pg_temp.p(w.assignee), 'pending_review', now() - w.submitted_ago from wt_tasks w where w.submitted_ago is not null;
-- Mục tiêu U1 tháng 9: chưa đạt (5/10), chưa ghi giải pháp.
insert into public.work_goals(org_unit_id, period_kind, period_start, title, target_value, unit, actual_value, solution, created_by)
  select u1, 'month', date '2026-09-01', 'Hoàn thành việc tháng 9', 10, 'việc', 5, null, pg_temp.p('head') from wt_refs;
set local session_replication_role = 'origin';
create function pg_temp.t(p_name text) returns uuid language sql as $$ select id from wt_tasks where name = p_name $$;

-- ── 1. Giờ chốt: work_close_due ───────────────────────────────────────────────────────────────────────
create function pg_temp.due(p_cadence text, p_dow int, p_time time, p_now timestamptz) returns jsonb language sql as $$
  select to_jsonb(x) from app_private.work_close_due(
    row(gen_random_uuid(), null, p_cadence, p_dow, p_time, 1, '08:00'::time, null, now())::public.work_period_settings, p_now) x $$;
create function pg_temp.due_ok(r jsonb, p_due timestamptz, p_from date, p_to date, p_label text, message text) returns void language plpgsql as $$ begin
  perform pg_temp.ok((r->>'due_at')::timestamptz = p_due and (r->>'period_from')::date = p_from and (r->>'period_to')::date = p_to and r->>'label' = p_label,
    message || ': ' || coalesce(r::text, 'null'));
end $$;
do $$ begin
  perform pg_temp.due_ok(pg_temp.due('week', 6, '17:00', '2026-10-24 17:00+07'), '2026-10-24 17:00+07', '2026-10-19', '2026-10-25', 'Tuần 43 · 19–25/10',
    'tuần: đúng giờ chốt thứ 7 ⇒ kỳ tuần đang chạy');
  perform pg_temp.due_ok(pg_temp.due('week', 6, '17:00', '2026-10-24 16:59:59+07'), '2026-10-17 17:00+07', '2026-10-12', '2026-10-18', 'Tuần 42 · 12–18/10',
    'tuần: trước giờ chốt 1 giây ⇒ lần trước');
  perform pg_temp.due_ok(pg_temp.due('week', 6, '17:00', '2026-10-21 12:00+07'), '2026-10-17 17:00+07', '2026-10-12', '2026-10-18', 'Tuần 42 · 12–18/10',
    'tuần: giữa tuần ⇒ thứ 7 tuần trước');
  perform pg_temp.due_ok(pg_temp.due('week', 0, '18:00', '2026-10-25 19:00+07'), '2026-10-25 18:00+07', '2026-10-19', '2026-10-25', 'Tuần 43 · 19–25/10',
    'tuần: chốt chủ nhật ⇒ chủ nhật cuối tuần ISO');
  perform pg_temp.due_ok(pg_temp.due('week', 0, '18:00', '2026-10-25 17:00+07'), '2026-10-18 18:00+07', '2026-10-12', '2026-10-18', 'Tuần 42 · 12–18/10',
    'tuần: chủ nhật trước giờ chốt');
  perform pg_temp.due_ok(pg_temp.due('week', 6, '00:30', '2026-10-24 00:45+07'), '2026-10-24 00:30+07', '2026-10-19', '2026-10-25', 'Tuần 43 · 19–25/10',
    'tuần: ngày theo giờ VN (UTC còn thứ 6)');
  perform pg_temp.due_ok(pg_temp.due('week', 1, '09:00', '2026-11-02 09:00+07'), '2026-11-02 09:00+07', '2026-11-02', '2026-11-08', 'Tuần 45 · 02–08/11',
    'tuần: chốt thứ 2 ⇒ kỳ là tuần chứa thứ 2 đó');
end $$;
do $$ begin
  perform pg_temp.due_ok(pg_temp.due('2weeks', 6, '17:00', '2026-10-21 12:00+07'), '2026-10-17 17:00+07', '2026-10-05', '2026-10-18', '05/10 – 18/10',
    '2 tuần: tuần 43 lẻ ⇒ lần chốt tuần 42 (kỳ tuần 41 + 42)');
  perform pg_temp.due_ok(pg_temp.due('2weeks', 6, '17:00', '2026-10-24 18:00+07'), '2026-10-17 17:00+07', '2026-10-05', '2026-10-18', '05/10 – 18/10',
    '2 tuần: thứ 7 tuần lẻ không chốt');
  perform pg_temp.due_ok(pg_temp.due('2weeks', 6, '17:00', '2026-10-31 17:00+07'), '2026-10-31 17:00+07', '2026-10-19', '2026-11-01', '19/10 – 01/11',
    '2 tuần: đúng giờ ở tuần chẵn 44');
  perform pg_temp.due_ok(pg_temp.due('2weeks', 6, '17:00', '2027-01-06 12:00+07'), '2026-12-26 17:00+07', '2026-12-14', '2026-12-27', '14/12 – 27/12',
    '2 tuần qua năm 53 tuần: tuần 53 lẻ ⇒ tuần 52');
  perform pg_temp.due_ok(pg_temp.due('month', 6, '17:00', '2026-10-31 17:00+07'), '2026-10-31 17:00+07', '2026-10-01', '2026-10-31', 'Tháng 10/2026',
    'tháng: thứ 7 cuối cùng của tháng (31/10)');
  perform pg_temp.due_ok(pg_temp.due('month', 6, '17:00', '2026-10-31 16:59+07'), '2026-09-26 17:00+07', '2026-09-01', '2026-09-30', 'Tháng 9/2026',
    'tháng: trước giờ ⇒ lần của tháng trước');
  perform pg_temp.due_ok(pg_temp.due('month', 5, '16:00', '2026-10-01 09:00+07'), '2026-09-25 16:00+07', '2026-09-01', '2026-09-30', 'Tháng 9/2026',
    'tháng: thứ 6 cuối tháng 9 là 25/09');
  perform pg_temp.due_ok(pg_temp.due('month', 4, '17:00', '2027-01-05 12:00+07'), '2026-12-31 17:00+07', '2026-12-01', '2026-12-31', 'Tháng 12/2026',
    'tháng: qua năm, ngày cuối tháng đúng thứ chốt');
end $$;

-- ── 2. Nhắc chốt kỳ: work_send_close_reminders(p_now) ──────────────────────────────────────────────────
insert into public.work_period_settings(org_unit_id, cadence, close_dow, close_time) values (null, 'week', 6, '17:00')
  on conflict ((coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update
  set cadence = excluded.cadence, close_dow = excluded.close_dow, close_time = excluded.close_time;
insert into public.work_period_settings(org_unit_id, cadence, close_dow, close_time) select u1, 'month', 5, '16:00' from wt_refs;
create function pg_temp.rem(p_name text) returns table(n bigint, source_id text, title text, message text, link text, kind text, severity text, ok boolean)
language sql as $$
  select count(*) over (), n.source_id, n.title, n.message, n.link, n.metadata->>'kind', n.severity,
    n.action_url = '/#' || n.link and n.push_enabled and n.delivery_reason = 'system' and n.delivery_mode = 'instant'
      and n.module = 'work' and n.category = 'work' and n.entity_type = 'work_close_reminder' and n.work_delivery_id is null and not n.is_read
      and n.message = n.body and n.metadata->>'eventType' = 'work.period_close_reminder'
  from public.notifications n where n.user_id = pg_temp.p(p_name)::text and n.source_type = 'work_close_reminder'
  order by n.created_at, n.title $$;
create function pg_temp.fake_rems() returns bigint language sql as $$
  select count(*) from public.notifications n where n.source_type = 'work_close_reminder' and n.user_id in (select id::text from wt_people) $$;
create function pg_temp.fake_sends() returns bigint language sql as $$
  select count(*) from app_private.work_close_reminder_sends s
  where s.scope_key = 'company' or s.scope_key in (select x::text from wt_refs, unnest(array[u1, u2, u3, u5]) x) $$;

do $$ declare v integer; begin
  update app_private.work_notification_settings set enabled = false where singleton;
  v := app_private.work_send_close_reminders('2026-09-05 17:00+07');
  perform pg_temp.ok(v = 0 and pg_temp.fake_sends() = 0 and pg_temp.fake_rems() = 0, 'tắt thông báo ⇒ không nhắc: '||v);
  update app_private.work_notification_settings set enabled = true where singleton;
  -- Trước giờ chốt 1 giây: lần gần nhất là 29/08 17:00 (đã quá 2 ngày) ⇒ không gửi bù.
  perform app_private.work_send_close_reminders('2026-09-05 16:59:59+07');
  perform pg_temp.ok(pg_temp.fake_sends() = 0 and pg_temp.fake_rems() = 0, 'trước giờ chốt ⇒ không gửi bù kỳ cũ');
end $$;

do $$ declare v integer; r record; v_u2 uuid := pg_temp.u('u2'); begin
  v := app_private.work_send_close_reminders('2026-09-05 17:00+07');
  perform pg_temp.ok(v >= 2, 'đúng giờ chốt ⇒ nhắc: '||v);
  select * into r from pg_temp.rem('bld');
  perform pg_temp.ok(r.n = 1 and r.ok and r.kind = 'due' and r.severity = 'info' and r.source_id = 'company:2026-08-31:2026-09-06:due'
    and r.title = 'Đến giờ chốt Tuần 36 · 31–06/09 · Toàn công ty'
    and r.link = '/work/my?space=company&from=2026-08-31&to=2026-09-06' and r.message like 'Đúng hạn %· Quá hạn: % việc',
    'BLĐ nhận nhắc chốt công ty: '||row_to_json(r)::text);
  select * into r from pg_temp.rem('head2');
  perform pg_temp.ok(r.n = 1 and r.ok and r.kind = 'due' and r.source_id = v_u2 || ':2026-08-31:2026-09-06:due'
    and r.title = 'Đến giờ chốt Tuần 36 · 31–06/09 · Work dot2r U2'
    and r.link = '/work/my?space=team&unit=' || v_u2 || '&from=2026-08-31&to=2026-09-06'
    and r.message = 'Đúng hạn 0% (0/1 việc đến hạn) · Quá hạn: 1 việc', 'trưởng U2 theo lịch công ty: '||row_to_json(r)::text);
  perform pg_temp.ok(not exists (select 1 from pg_temp.rem('head')) and not exists (select 1 from pg_temp.rem('head5'))
    and not exists (select 1 from pg_temp.rem('staff')) and not exists (select 1 from pg_temp.rem('staff3'))
    and not exists (select 1 from pg_temp.rem('outsider')),
    'U1 lịch tháng chưa tới giờ, U5 không có số, nhân viên ⇒ không nhận');
  perform pg_temp.ok((select recipients from app_private.work_close_reminder_sends where scope_key = pg_temp.u('u5')::text and kind = 'due') = 0
    and not exists (select 1 from app_private.work_close_reminder_sends where scope_key in (pg_temp.u('u1')::text, pg_temp.u('u3')::text)),
    'U5 ghi đã xét (0 người), U1 ngoài cửa sổ, U3 không có trưởng');
  -- Gọi lại trong cửa sổ 'due' ⇒ không gửi lần 2.
  perform app_private.work_send_close_reminders('2026-09-05 18:00+07');
  perform app_private.work_send_close_reminders('2026-09-06 16:59+07');
  perform pg_temp.ok(pg_temp.fake_rems() = 2, 'không gửi lại trong cửa sổ: '||pg_temp.fake_rems());
end $$;

-- U2 chốt kỳ ⇒ không nhắc trễ; công ty chưa chốt ⇒ nhắc 'late'.
insert into public.work_period_closes(org_unit_id, period_from, period_to, label, status, snapshot, closed_by)
  select u2, '2026-08-31', '2026-09-06', 'Tuần 36 · thử', 'closed', '{}'::jsonb, pg_temp.p('head2') from wt_refs;
do $$ declare r record; begin
  perform app_private.work_send_close_reminders('2026-09-06 17:00+07');
  select * into r from pg_temp.rem('bld') where kind = 'late';
  perform pg_temp.ok(r.ok and r.severity = 'warning' and r.source_id = 'company:2026-08-31:2026-09-06:late'
    and r.title = 'Chưa chốt Tuần 36 · 31–06/09 · Toàn công ty' and r.link = '/work/my?space=company&from=2026-08-31&to=2026-09-06',
    'BLĐ nhận nhắc chưa chốt: '||coalesce(row_to_json(r)::text, 'null'));
  perform pg_temp.ok((select count(*) from pg_temp.rem('bld')) = 2 and (select count(*) from pg_temp.rem('head2')) = 1
    and not exists (select 1 from app_private.work_close_reminder_sends where scope_key = pg_temp.u('u2')::text and kind = 'late'),
    'U2 đã chốt ⇒ không nhắc trễ');
  perform app_private.work_send_close_reminders('2026-09-07 16:59+07');
  perform app_private.work_send_close_reminders('2026-09-07 17:00+07');
  perform pg_temp.ok(pg_temp.fake_rems() = 3, 'không gửi lại, quá 2 ngày ⇒ thôi: '||pg_temp.fake_rems());
end $$;

-- U1 lịch riêng tháng: thứ 6 cuối tháng 9 (25/09) 16:00; có mục tiêu chưa đạt chưa ghi giải pháp.
do $$ declare r record; v_u1 uuid := pg_temp.u('u1'); begin
  perform app_private.work_send_close_reminders('2026-09-25 16:00+07');
  select * into r from pg_temp.rem('head');
  perform pg_temp.ok(r.n = 1 and r.ok and r.kind = 'due' and r.source_id = v_u1 || ':2026-09-01:2026-09-30:due'
    and r.title = 'Đến giờ chốt Tháng 9/2026 · Work dot2r U1'
    and r.link = '/work/my?space=team&unit=' || v_u1 || '&from=2026-09-01&to=2026-09-30'
    and r.message = 'Đúng hạn 50% (1/2 việc đến hạn) · Quá hạn: 1 việc' || E'\n' || '1 mục tiêu chưa đạt cần ghi giải pháp trước khi chốt',
    'trưởng U1 theo lịch riêng tháng + mục tiêu cần giải pháp: '||coalesce(row_to_json(r)::text, 'null'));
  perform pg_temp.ok(pg_temp.fake_rems() = 4, 'công ty / U2 ngoài cửa sổ ngày 25/09: '||pg_temp.fake_rems());
end $$;

-- ── 3–4. Nhắc 08:00: chưa nhận việc 24 giờ + chờ duyệt 24 giờ ──────────────────────────────────────────
do $$ declare ea uuid; er uuid; c jsonb; v_mgr uuid := app_private.resolve_strict_direct_manager(pg_temp.p('staff')); begin
  perform app_private.work_enqueue_stale_reminders(500);
  perform pg_temp.ok((select count(*) from public.work_task_events where task_id = pg_temp.t('a1') and event_type = 'assignment.ack_overdue') = 1,
    'a1 giao 25 giờ chưa nhận ⇒ một nhắc');
  perform pg_temp.ok(not exists (select 1 from public.work_task_events where task_id in (pg_temp.t('a2'), pg_temp.t('a3')) and event_type = 'assignment.ack_overdue'),
    'có hạn xác nhận / chưa đủ 24 giờ ⇒ không nhắc');
  select id into ea from public.work_task_events where task_id = pg_temp.t('a1') and event_type = 'assignment.ack_overdue';
  perform pg_temp.ok((select e.payload->>'userId' = pg_temp.p('staff')::text and e.payload ? 'assignmentId' and not e.payload ? 'dueAt'
      and (e.payload->>'hours')::int = 25 and e.source = 'system' from public.work_task_events e where e.id = ea), 'payload nhắc chưa nhận');
  perform pg_temp.ok(exists (select 1 from app_private.work_notification_outbox o where o.event_id = ea and o.event_type = 'assignment.ack_overdue'), 'vào hàng chờ');
  perform pg_temp.ok(app_private.work_notification_mandatory(ea, pg_temp.p('staff')), 'người được giao nhận (bắt buộc)');
  perform pg_temp.ok(app_private.work_notification_mandatory(ea, pg_temp.p('bld')), 'người tạo nhận (bắt buộc)');
  perform pg_temp.ok(app_private.work_notification_mandatory(ea, pg_temp.p('outsider')) is null, 'người ngoài không nhận');
  if v_mgr is not null then
    perform pg_temp.ok(app_private.work_notification_mandatory(ea, v_mgr) is not null, 'quản lý trực tiếp nhận');
  else
    perform pg_temp.ok(app_private.work_notification_mandatory(ea, pg_temp.p('head')) is null, 'không có quản lý trực tiếp ⇒ trưởng không nhận nhắc nhận việc');
  end if;
  c := app_private.work_notification_content(ea);
  perform pg_temp.ok(c->>'title' like 'VW-2099-% · Chưa xác nhận' and c->>'message' like 'Chưa nhận việc: “PR8: a1” · giao % · đã 25 giờ', 'câu nhắc chưa nhận: '||c::text);

  perform pg_temp.ok((select count(*) from public.work_task_events where task_id = pg_temp.t('r1') and event_type = 'task.review_waiting') = 1,
    'r1 chờ duyệt 30 giờ ⇒ một nhắc');
  perform pg_temp.ok(not exists (select 1 from public.work_task_events where task_id in (pg_temp.t('r2'), pg_temp.t('r3')) and event_type = 'task.review_waiting'),
    'mới nộp / không có người duyệt ⇒ không nhắc');
  select id into er from public.work_task_events where task_id = pg_temp.t('r1') and event_type = 'task.review_waiting';
  perform pg_temp.ok(exists (select 1 from app_private.work_notification_outbox o where o.event_id = er), 'nhắc duyệt vào hàng chờ');
  perform pg_temp.ok(app_private.work_notification_mandatory(er, pg_temp.p('head')), 'người duyệt nhận (bắt buộc)');
  perform pg_temp.ok(app_private.work_notification_mandatory(er, pg_temp.p('bld')) is null
    and app_private.work_notification_mandatory(er, pg_temp.p('staff')) is null, 'người tạo / người làm không nhận nhắc duyệt');
  c := app_private.work_notification_content(er);
  perform pg_temp.ok(c->>'title' like 'VW-2099-% · Kết quả chờ bạn duyệt · 30 giờ'
    and c->>'message' = 'Kết quả “PR8: r1” đã chờ bạn duyệt 30 giờ. Bấm để duyệt hoặc yêu cầu chỉnh sửa.', 'câu nhắc duyệt: '||c::text);

  -- Gọi lại trong ngày ⇒ không trùng.
  perform app_private.work_enqueue_stale_reminders(500);
  perform pg_temp.ok((select count(*) from public.work_task_events where task_id in (pg_temp.t('a1'), pg_temp.t('r1'))
    and event_type in ('assignment.ack_overdue', 'task.review_waiting')) = 2, 'mỗi ngày tối đa một nhắc');
end $$;

-- Gửi thật qua work_process_notifications (vai service_role). Người duyệt tắt thông báo việc vẫn nhận (tin bắt buộc).
set local session_replication_role = 'replica';
insert into public.work_task_notification_preferences(task_id, user_id, notifications_enabled, muted_at) values (pg_temp.t('r1'), pg_temp.p('head'), false, now());
set local session_replication_role = 'origin';
do $$ declare v jsonb; begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v := app_private.work_process_notifications(50);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.ok((v->>'enabled')::boolean and (v->>'failed')::int = 0, 'xử lý hàng chờ: '||v::text);
  perform pg_temp.ok((select count(*) from public.notifications n where n.metadata->>'eventType' = 'assignment.ack_overdue'
      and n.entity_id = pg_temp.t('a1') and n.user_id in (pg_temp.p('staff')::text, pg_temp.p('bld')::text)
      and (n.metadata->>'mandatory')::boolean and n.work_delivery_id is not null and n.link like '/work/tasks/VW-2099-%') = 2,
    'nhắc chưa nhận tới người được giao + người tạo');
  perform pg_temp.ok((select count(*) from public.notifications n where n.metadata->>'eventType' = 'task.review_waiting' and n.entity_id = pg_temp.t('r1')) = 1
    and exists (select 1 from public.notifications n where n.metadata->>'eventType' = 'task.review_waiting' and n.entity_id = pg_temp.t('r1')
      and n.user_id = pg_temp.p('head')::text and n.title like '% · Kết quả chờ bạn duyệt · 30 giờ'),
    'nhắc duyệt chỉ tới người duyệt (dù đã tắt thông báo việc)');
end $$;

-- Đã nhận việc / đã duyệt ⇒ tin nhắc cũ thôi hiệu lực.
do $$ declare ea uuid; er uuid; begin
  select id into ea from public.work_task_events where task_id = pg_temp.t('a1') and event_type = 'assignment.ack_overdue';
  select id into er from public.work_task_events where task_id = pg_temp.t('r1') and event_type = 'task.review_waiting';
  set local session_replication_role = 'replica';
  update public.work_task_assignments set acknowledged_at = now(), state = 'not_started' where task_id = pg_temp.t('a1');
  update public.work_task_submissions set status = 'approved', reviewed_by = pg_temp.p('head'), reviewed_at = now() where task_id = pg_temp.t('r1');
  set local session_replication_role = 'origin';
  perform pg_temp.ok(app_private.work_notification_mandatory(ea, pg_temp.p('staff')) is null, 'đã nhận việc ⇒ nhắc cũ không gửi');
  perform pg_temp.ok(app_private.work_notification_mandatory(er, pg_temp.p('head')) is null, 'đã duyệt ⇒ nhắc cũ không gửi');
end $$;

-- ── 5. Quyền thực thi + cron ───────────────────────────────────────────────────────────────────────────
do $$ declare f text; begin
  foreach f in array array['app_private.work_close_due(public.work_period_settings,timestamptz)', 'app_private.work_send_close_reminders(timestamptz)',
    'app_private.work_enqueue_stale_reminders(integer)', 'app_private.work_notification_content(uuid)', 'app_private.work_notification_mandatory(uuid,uuid)'] loop
    perform pg_temp.ok(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
      and not has_function_privilege('public', f, 'execute'), 'hàm nội bộ không mở '||f);
  end loop;
  perform pg_temp.ok(not has_table_privilege('authenticated', 'app_private.work_close_reminder_sends', 'select')
    and not has_table_privilege('anon', 'app_private.work_close_reminder_sends', 'select')
    and (select c.relrowsecurity from pg_class c where c.oid = 'app_private.work_close_reminder_sends'::regclass), 'bảng đã nhắc đóng + RLS');
  perform pg_temp.ok((select count(*) from cron.job where jobname = 'work-close-reminders' and schedule = '*/15 * * * *'
    and command = 'select app_private.work_send_close_reminders();' and active) = 1, 'cron work-close-reminders 15 phút, một job');
  perform pg_temp.ok(exists (select 1 from cron.job where jobname = 'work-stale-reminders' and schedule = '0 1 * * 1-6' and active), 'lịch 08:00 giữ nguyên');
end $$;

select 'work dot2 reminders smoke passed' as result;
