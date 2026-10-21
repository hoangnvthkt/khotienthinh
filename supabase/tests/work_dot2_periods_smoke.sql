-- Vioo Work Đợt 2 PR-5: kỳ linh động + so kỳ trước. Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261023090000_work_dot2_periods.sql \
--   --smoke supabase/tests/work_dot2_periods_smoke.sql
-- Vai (tên giả): head = Vương Thành Đô (trưởng U1) · staff = Đặng Thu Hà (nhân viên U1) · outsider (U2) · bld (xem toàn công ty) · noaccess.
-- Kỳ thử: tháng 09/2026 (kỳ trước 08/2026), cộng tuần trước / tuần trước nữa theo lịch thật cho chế độ mặc định.
create temporary table wt_people(name text primary key, full_name text, id uuid default gen_random_uuid(),
  email text default ('work-dot2-'||gen_random_uuid()||'@invalid.local'), employee_id uuid default gen_random_uuid());
insert into wt_people(name, full_name) values ('head', 'Vương Thành Đô'), ('staff', 'Đặng Thu Hà'), ('outsider', 'Lã Minh Khang'),
  ('bld', 'Tạ Hồng Sơn'), ('noaccess', 'Mạc Thị Yến');
insert into public.users(id,name,username,email,role)
  select id,full_name,'work-dot2-'||id,email,'EMPLOYEE'::public.user_role from wt_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select p.id, g.code, g.scope, '*', 'Work dot2 rollback test' from wt_people p
  cross join (values ('work.module.access','global'),('work.task.create','own'),('work.task.view_related','own'),('work.task.view_related','assigned')) g(code,scope)
  where p.name <> 'noaccess';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select p.id, g.code, g.scope, '*', 'Work dot2 rollback test' from wt_people p
  cross join (values ('work.task.assign_user','own'),('work.task.review','assigned')) g(code,scope) where p.name in ('head','bld');
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason,expires_at)
  select id,'work.task.view_scope','global','*','Work dot2 rollback test',null from wt_people where name = 'bld';
grant select on wt_people to authenticated, anon;

create function pg_temp.p(p_name text) returns uuid language sql as $$ select id from wt_people where name = p_name $$;
create function pg_temp.as_(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text
    from wt_people where name = p_name), true);
end $$;
create function pg_temp.ok(cond boolean, message text) returns void language plpgsql as $$ begin
  if cond is distinct from true then raise exception 'Work dot2 test failed: %', message; end if;
end $$;
-- Gọi một khối SQL, trả về "mã lỗi SQLSTATE: thông điệp" (null nếu chạy được).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$ begin
  execute p_sql; return null;
exception when others then return sqlstate || ':' || sqlerrm;
end $$;
-- Giờ VN → timestamptz.
create function pg_temp.vn(p text) returns timestamptz language sql as $$ select p::timestamp at time zone 'Asia/Ho_Chi_Minh' $$;

-- ── Sơ đồ tổ chức giả: U1 (head làm trưởng, staff, noaccess), U2 (outsider, bld) ────────────────────
create temporary table wt_refs as select gen_random_uuid() as u1, gen_random_uuid() as u2, gen_random_uuid() as slot1,
  (date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh'))::date as this_week;
grant select on wt_refs to authenticated, anon;
set local session_replication_role = 'replica';
insert into public.org_units(id, name, type, code) select u1, 'Work dot2 U1', 'department', 'WD2-U1' from wt_refs
  union all select u2, 'Work dot2 U2', 'department', 'WD2-U2' from wt_refs;
insert into public.hrm_org_position_slots(id, code, org_unit_id, position_id) select slot1, 'WD2-HEAD', u1, gen_random_uuid() from wt_refs;
update public.org_units set manager_slot_id = (select slot1 from wt_refs) where id = (select u1 from wt_refs);
insert into public.employees(id, full_name, user_id, org_unit_id, status)
  select employee_id, full_name, id, case when name in ('head','staff','noaccess') then (select u1 from wt_refs) else (select u2 from wt_refs) end, 'Đang làm việc'
  from wt_people;
insert into public.hrm_employee_slot_assignments(employee_id, slot_id, assignment_type, status, effective_from)
  select (select employee_id from wt_people where name = 'head'), slot1, 'PRIMARY', 'ACTIVE', current_date - 1 from wt_refs;
set local session_replication_role = 'origin';

-- ── Tạo việc bằng lệnh thật, rồi dời hạn / trạng thái về các kỳ thử ─────────────────────────────────
create temporary table wt_tasks(name text primary key, id uuid);
grant select, insert on wt_tasks to authenticated, anon;
create function pg_temp.create_task(p_actor text, p_title text, p_recipient text) returns uuid language plpgsql as $$
declare v_scope jsonb := '{"type":"direct"}'; v_sources jsonb; v_preview jsonb; v_res jsonb;
begin
  perform pg_temp.as_(p_actor);
  v_sources := jsonb_build_array(jsonb_build_object('type','user','id',pg_temp.p(p_recipient)));
  v_preview := public.preview_work_task_recipients(v_sources, v_scope);
  v_res := public.create_work_task(jsonb_build_object('title', p_title,
    'description', '{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Việc thử Đợt 2"}]}]}'::jsonb,
    'scope', v_scope, 'recipientSources', v_sources, 'watcherUserIds', '[]'::jsonb, 'priority', 'normal', 'privacy', 'standard',
    'labels', '["Thử"]'::jsonb, 'checklist', '[]'::jsonb,
    'deadlineAt', to_jsonb(now() + interval '3 days')), gen_random_uuid(), v_preview->>'fingerprint');
  return (v_res->>'taskId')::uuid;
end $$;
insert into wt_tasks values
  ('s1', pg_temp.create_task('head', 'P5: chỉ đạo tuần 07/09, xong đúng hạn', 'staff')),
  ('s2', pg_temp.create_task('head', 'P5: tuần 21/09, xong trễ', 'staff')),
  ('s3', pg_temp.create_task('head', 'P5: hạn 30/09 23:30, chưa xong', 'staff')),
  ('s4', pg_temp.create_task('head', 'P5: hạn 01/10 00:00 (ngoài tháng 9)', 'staff')),
  ('s5', pg_temp.create_task('head', 'P5: tháng 8, xong đúng hạn', 'staff')),
  ('s6', pg_temp.create_task('head', 'P5: tháng 9, đã hủy', 'staff')),
  ('claim', pg_temp.create_task('staff', 'P5: tháng 9, giao miệng chờ xác nhận', 'staff')),
  ('lw', pg_temp.create_task('head', 'P5: tuần trước, xong đúng hạn', 'staff')),
  ('pw', pg_temp.create_task('head', 'P5: tuần trước nữa, chưa xong', 'staff'));

do $$ begin
  perform pg_temp.as_('staff');
  perform public.work_task_set_origin_v1((select id from wt_tasks where name = 'claim'), 'oral_claim', null, pg_temp.p('head'));
  perform pg_temp.as_('head');
  perform public.work_task_set_origin_v1((select id from wt_tasks where name = 's1'), 'directive',
    (public.work_meeting_create_v1('Giao ban tháng 9', current_date - 1)->>'meetingId')::uuid, pg_temp.p('bld'));
end $$;

set local session_replication_role = 'replica';
update public.work_tasks t set deadline_at = v.d, status = v.st, completed_at = v.c,
  cancelled_at = case when v.st = 'cancelled' then pg_temp.vn('2026-09-09 10:00') end
from (select w.id, x.d, x.st, x.c from wt_tasks w join (values
    ('s1', pg_temp.vn('2026-09-08 10:00'), 'completed', pg_temp.vn('2026-09-07 16:00')),
    ('s2', pg_temp.vn('2026-09-23 10:00'), 'completed', pg_temp.vn('2026-09-25 09:00')),
    ('s3', pg_temp.vn('2026-09-30 23:30'), 'in_progress', null::timestamptz),
    ('s4', pg_temp.vn('2026-10-01 00:00'), 'in_progress', null),
    ('s5', pg_temp.vn('2026-08-15 10:00'), 'completed', pg_temp.vn('2026-08-14 10:00')),
    ('s6', pg_temp.vn('2026-09-10 10:00'), 'cancelled', null),
    ('claim', pg_temp.vn('2026-09-12 10:00'), 'in_progress', null),
    ('lw', ((select this_week from wt_refs) - 5)::timestamp at time zone 'Asia/Ho_Chi_Minh' + interval '10 hours', 'completed',
       ((select this_week from wt_refs) - 6)::timestamp at time zone 'Asia/Ho_Chi_Minh' + interval '10 hours'),
    ('pw', ((select this_week from wt_refs) - 12)::timestamp at time zone 'Asia/Ho_Chi_Minh' + interval '10 hours', 'in_progress', null)
  ) x(name, d, st, c) on x.name = w.name) v
where t.id = v.id;
set local session_replication_role = 'origin';

-- ── 1. Phòng tôi: tháng 9 gom việc 2 tuần khác nhau, so tháng 8 ───────────────────────────────────────
do $$ declare r jsonb; m jsonb; begin
  perform pg_temp.as_('head');
  r := public.work_team_board_v1(p_from => '2026-09-01', p_to => '2026-09-30', p_prev_from => '2026-08-01', p_prev_to => '2026-08-31');
  select x into m from jsonb_array_elements(r->'members') x where x->>'userId' = pg_temp.p('staff')::text;
  perform pg_temp.ok((m->>'due')::int = 3 and (m->>'ontime')::int = 1,
    'tháng 9: s1 (tuần 07/09) + s2 (tuần 21/09) + s3 (30/09 23:30); không tính hủy, giao miệng chờ, 01/10 00:00: '||coalesce(m::text, 'null'));
  perform pg_temp.ok((m->>'prevDue')::int = 1 and (m->>'prevOntime')::int = 1, 'tháng 8: 1/1 đúng hạn: '||m::text);
  perform pg_temp.ok(r->'period' = '{"from":"2026-09-01","to":"2026-09-30","prevFrom":"2026-08-01","prevTo":"2026-08-31"}'::jsonb, 'period: '||(r->'period')::text);
  perform pg_temp.ok(r ? 'weekStart' and r->>'unit' is not null, 'vẫn trả weekStart + unit');

  -- Một tuần (07/09 – 13/09) và một ngày (p_to null ⇒ to = from), không có kỳ trước ⇒ prev null.
  r := public.work_team_board_v1(p_from => '2026-09-07', p_to => '2026-09-13');
  select x into m from jsonb_array_elements(r->'members') x where x->>'userId' = pg_temp.p('staff')::text;
  perform pg_temp.ok((m->>'due')::int = 1 and (m->>'ontime')::int = 1 and m->'prevDue' = 'null'::jsonb and m->'prevOntime' = 'null'::jsonb,
    'tuần 07/09: 1/1, không có kỳ trước: '||m::text);
  perform pg_temp.ok(r->'period'->'prevFrom' = 'null'::jsonb and r->'period'->'prevTo' = 'null'::jsonb, 'period không có kỳ trước');
  r := public.work_team_board_v1(p_from => '2026-09-30');
  select x into m from jsonb_array_elements(r->'members') x where x->>'userId' = pg_temp.p('staff')::text;
  perform pg_temp.ok((m->>'due')::int = 1 and (m->>'ontime')::int = 0 and r->'period'->>'to' = '2026-09-30', 'một ngày 30/09 tính cả 23:30: '||m::text);
  r := public.work_team_board_v1(p_from => '2026-10-01');
  select x into m from jsonb_array_elements(r->'members') x where x->>'userId' = pg_temp.p('staff')::text;
  perform pg_temp.ok((m->>'due')::int = 1, 'hạn 01/10 00:00 thuộc ngày 01/10: '||m::text);
end $$;

-- ── 2. Mặc định (không truyền p_from) như cũ: tuần trước + kỳ trước = tuần trước nữa ───────────────────
do $$ declare r jsonb; m jsonb; ws date := (select this_week from wt_refs); begin
  perform pg_temp.as_('head');
  r := public.work_team_board_v1();
  select x into m from jsonb_array_elements(r->'members') x where x->>'userId' = pg_temp.p('staff')::text;
  perform pg_temp.ok((r->>'weekStart')::date = ws - 7 and (r->'period'->>'from')::date = ws - 7 and (r->'period'->>'to')::date = ws - 1
    and (r->'period'->>'prevFrom')::date = ws - 14 and (r->'period'->>'prevTo')::date = ws - 8, 'period mặc định = tuần trước: '||(r->'period')::text);
  perform pg_temp.ok((m->>'due')::int = 1 and (m->>'ontime')::int = 1 and (m->>'prevDue')::int = 1 and (m->>'prevOntime')::int = 0,
    'mặc định: tuần trước 1/1, tuần trước nữa 0/1: '||m::text);
  -- Client cũ chỉ truyền p_week_start: kỳ = tuần đó, kỳ trước = tuần liền trước.
  r := public.work_team_board_v1(null, '2026-09-21');
  select x into m from jsonb_array_elements(r->'members') x where x->>'userId' = pg_temp.p('staff')::text;
  perform pg_temp.ok((m->>'due')::int = 1 and (m->>'ontime')::int = 0 and (m->>'prevDue')::int = 0 and r->'period'->>'prevFrom' = '2026-09-14',
    'p_week_start cũ vẫn chạy: '||m::text);
end $$;

-- ── 3. Kỳ không hợp lệ ───────────────────────────────────────────────────────────────────────────────
do $$ declare e text; begin
  perform pg_temp.as_('head');
  e := pg_temp.err($q$select public.work_team_board_v1(p_from => '2026-09-10', p_to => '2026-09-01')$q$);
  perform pg_temp.ok(e = '22023:WORK_INVALID_PERIOD', 'to < from: '||coalesce(e, 'null'));
  e := pg_temp.err($q$select public.work_team_board_v1(p_from => '2025-01-01', p_to => '2026-09-01')$q$);
  perform pg_temp.ok(e = '22023:WORK_INVALID_PERIOD', 'dài quá 400 ngày: '||coalesce(e, 'null'));
  e := pg_temp.err($q$select public.work_team_board_v1(p_from => '2026-09-01', p_to => '2026-09-30', p_prev_from => '2026-08-31', p_prev_to => '2026-08-01')$q$);
  perform pg_temp.ok(e = '22023:WORK_INVALID_PERIOD', 'kỳ trước to < from: '||coalesce(e, 'null'));
  perform pg_temp.as_('bld');
  e := pg_temp.err($q$select public.work_company_board_v1(p_from => '2026-09-10', p_to => '2026-09-01')$q$);
  perform pg_temp.ok(e = '22023:WORK_INVALID_PERIOD', 'toàn công ty to < from: '||coalesce(e, 'null'));
  e := pg_temp.err($q$select public.work_directives_v1(null, '2026-09-10', '2026-09-01')$q$);
  perform pg_temp.ok(e = '22023:WORK_INVALID_PERIOD', 'sổ chỉ đạo to < from: '||coalesce(e, 'null'));
  perform pg_temp.as_('staff');
  e := pg_temp.err($q$select public.work_my_board_v1(p_from => '2026-09-10', p_to => '2026-09-01')$q$);
  perform pg_temp.ok(e = '22023:WORK_INVALID_PERIOD', 'việc của tôi to < from: '||coalesce(e, 'null'));
  -- Quyền vẫn như cũ.
  perform pg_temp.as_('outsider');
  e := pg_temp.err(format('select public.work_team_board_v1(%L::uuid, null, %L::date, %L::date)', (select u1 from wt_refs), '2026-09-01', '2026-09-30'));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'người đơn vị khác không xem Phòng tôi U1: '||coalesce(e, 'null'));
  e := pg_temp.err($q$select public.work_company_board_v1(p_from => '2026-09-01')$q$);
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'không có quyền toàn công ty: '||coalesce(e, 'null'));
end $$;

-- ── 4. Toàn công ty: prevDue / prevOntime + chỉ đạo xong trong kỳ ──────────────────────────────────────
do $$ declare r jsonb; u jsonb; begin
  perform pg_temp.as_('bld');
  r := public.work_company_board_v1(p_from => '2026-09-01', p_to => '2026-09-30', p_prev_from => '2026-08-01', p_prev_to => '2026-08-31');
  select x into u from jsonb_array_elements(r->'units') x where x->>'code' = 'WD2-U1';
  perform pg_temp.ok((u->>'due')::int = 3 and (u->>'ontime')::int = 1 and (u->>'prevDue')::int = 1 and (u->>'prevOntime')::int = 1,
    'U1 tháng 9 so tháng 8: '||coalesce(u::text, 'null'));
  perform pg_temp.ok((u->'directives'->>'doneInPeriod')::int = 1 and (u->'directives'->>'doneThisMonth')::int = 0,
    'chỉ đạo s1 xong 07/09: trong kỳ, không phải tháng này: '||(u->'directives')::text);
  select x into u from jsonb_array_elements(r->'units') x where x->>'code' = 'WD2-U2';
  perform pg_temp.ok((u->>'prevDue')::int = 0 and (u->>'prevOntime')::int = 0, 'U2 có kỳ trước nhưng không có việc ⇒ 0: '||coalesce(u::text, 'null'));
  perform pg_temp.ok(r->'period' = '{"from":"2026-09-01","to":"2026-09-30","prevFrom":"2026-08-01","prevTo":"2026-08-31"}'::jsonb, 'period: '||(r->'period')::text);

  r := public.work_company_board_v1(p_from => '2026-09-01', p_to => '2026-09-30');
  select x into u from jsonb_array_elements(r->'units') x where x->>'code' = 'WD2-U1';
  perform pg_temp.ok(u->'prevDue' = 'null'::jsonb and u->'prevOntime' = 'null'::jsonb, 'không có kỳ trước ⇒ null: '||u::text);

  r := public.work_company_board_v1();
  select x into u from jsonb_array_elements(r->'units') x where x->>'code' = 'WD2-U1';
  perform pg_temp.ok((r->'period'->>'from')::date = (select this_week from wt_refs) - 7 and (r->>'weekStart')::date = (select this_week from wt_refs) - 7
    and (u->>'due')::int = 1 and (u->>'ontime')::int = 1 and (u->>'prevDue')::int = 1 and (u->>'prevOntime')::int = 0,
    'mặc định toàn công ty = tuần trước, so tuần trước nữa: '||u::text);
end $$;

-- ── 5. Sổ chỉ đạo: nhóm Xong theo kỳ ─────────────────────────────────────────────────────────────────
do $$ declare r jsonb; begin
  perform pg_temp.as_('bld');
  r := public.work_directives_v1();
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(r) x where x->>'title' like 'P5: chỉ đạo%'),
    'mặc định: chỉ đạo xong tháng 9 không vào nhóm Xong tháng này');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r) x where x->>'title' = 'P5: tháng 9, giao miệng chờ xác nhận' and x->>'bucket' = 'confirm'),
    'các nhóm khác giữ nguyên');
  r := public.work_directives_v1(null, '2026-09-01', '2026-09-30');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r) x where x->>'title' like 'P5: chỉ đạo%' and x->>'bucket' = 'done'),
    'kỳ tháng 9: chỉ đạo xong 07/09 vào nhóm Xong: '||r::text);
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r) x where x->>'bucket' = 'confirm'), 'Chờ xác nhận vẫn hiện khi chọn kỳ');
  r := public.work_directives_v1(null, '2026-09-08', '2026-09-30');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(r) x where x->>'title' like 'P5: chỉ đạo%'), 'xong 07/09 ngoài kỳ 08/09 – 30/09');
  perform pg_temp.as_('head');
  r := public.work_directives_v1((select u1 from wt_refs), '2026-09-07');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r) x where x->>'title' like 'P5: chỉ đạo%' and x->>'bucket' = 'done'),
    'trưởng đơn vị, kỳ một ngày 07/09: '||r::text);
end $$;

-- ── 6. Tra việc: state 'due' + p_due_from + ontime ──────────────────────────────────────────────────────
do $$ declare r jsonb; t jsonb; e text;
  find constant text := 'select x from jsonb_array_elements($1) x where x->>''title'' = $2';
begin
  perform pg_temp.as_('staff');
  r := public.work_tasks_overview_v1(p_assignee_user_id => pg_temp.p('staff'), p_state => 'due', p_due_from => '2026-09-01', p_due_before => '2026-09-30');
  perform pg_temp.ok((r->>'total')::int = 3, 'đến hạn tháng 9 = đúng tập của bảng (3): '||r::text);
  execute find into t using r->'items', 'P5: chỉ đạo tuần 07/09, xong đúng hạn';
  perform pg_temp.ok((t->>'ontime')::boolean and t->>'completedAt' is not null, 's1 đúng hạn: '||coalesce(t::text, 'null'));
  execute find into t using r->'items', 'P5: tuần 21/09, xong trễ';
  perform pg_temp.ok(not (t->>'ontime')::boolean and t->>'completedAt' is not null, 's2 trễ: '||coalesce(t::text, 'null'));
  execute find into t using r->'items', 'P5: hạn 30/09 23:30, chưa xong';
  perform pg_temp.ok(not (t->>'ontime')::boolean and t->'completedAt' = 'null'::jsonb, 's3 chưa xong: '||coalesce(t::text, 'null'));
  -- 'all' cùng khoảng hạn còn có việc hủy + giao miệng chờ ⇒ 'due' lọc đúng.
  r := public.work_tasks_overview_v1(p_assignee_user_id => pg_temp.p('staff'), p_state => 'all', p_due_from => '2026-09-01', p_due_before => '2026-09-30');
  perform pg_temp.ok((r->>'total')::int = 5, 'all tháng 9 = 5 (thêm hủy + giao miệng chờ): '||r::text);
  -- Chỉ p_due_from: từ 30/09 trở đi (s3, s4, việc tuần trước / tuần trước nữa).
  r := public.work_tasks_overview_v1(p_assignee_user_id => pg_temp.p('staff'), p_state => 'due', p_due_from => '2026-09-30');
  perform pg_temp.ok((r->>'total')::int = 4 and not (r->'items')::text like '%tuần 21/09%', 'chỉ p_due_from: '||r::text);
  -- Việc chưa có hạn ⇒ ontime null (lấy một việc open bất kỳ không hạn nếu có; ở đây kiểm qua việc có hạn là boolean).
  perform pg_temp.ok(jsonb_typeof(r->'items'->0->'ontime') = 'boolean', 'ontime là boolean khi có hạn');
  -- Gọi kiểu AI (tên tham số cũ, không p_due_from) vẫn chạy.
  r := public.work_tasks_overview_v1(p_assignee_user_id => pg_temp.p('staff'), p_unit_query => null, p_state => 'open', p_due_before => null, p_limit => 30);
  perform pg_temp.ok((r->>'total')::int = 4, 'open: s3, s4, claim, pw: '||r::text);
  e := pg_temp.err($q$select public.work_tasks_overview_v1(null, null, 'bừa', null, 30)$q$);
  perform pg_temp.ok(e = '22023:WORK_INVALID_COMMAND', 'state lạ vẫn bị chặn: '||coalesce(e, 'null'));
end $$;

-- Việc không có hạn ⇒ ontime null.
set local session_replication_role = 'replica';
update public.work_tasks set deadline_at = null where id = (select id from wt_tasks where name = 's4');
set local session_replication_role = 'origin';
do $$ declare r jsonb; t jsonb; begin
  perform pg_temp.as_('staff');
  r := public.work_tasks_overview_v1(p_assignee_user_id => pg_temp.p('staff'), p_state => 'open');
  select x into t from jsonb_array_elements(r->'items') x where x->>'title' like 'P5: hạn 01/10%';
  perform pg_temp.ok(t is not null and t->'ontime' = 'null'::jsonb, 'không hạn ⇒ ontime null: '||coalesce(t::text, 'null'));
end $$;
set local session_replication_role = 'replica';
update public.work_tasks set deadline_at = pg_temp.vn('2026-10-01 00:00') where id = (select id from wt_tasks where name = 's4');
set local session_replication_role = 'origin';

-- ── 7. Việc của tôi: period ──────────────────────────────────────────────────────────────────────────
do $$ declare r jsonb; ws date := (select this_week from wt_refs); begin
  perform pg_temp.as_('staff');
  r := public.work_my_board_v1();
  perform pg_temp.ok((r->>'weekStart')::date = ws and (r->'period'->>'from')::date = ws - 7 and (r->'period'->>'to')::date = ws - 1
    and (r->'period'->>'prevFrom')::date = ws - 14 and (r->'period'->>'prevTo')::date = ws - 8, 'mặc định: kỳ = tuần trước: '||(r->'period')::text);
  perform pg_temp.ok((r->'period'->>'due')::int = 1 and (r->'period'->>'ontime')::int = 1 and (r->'period'->>'prevDue')::int = 1 and (r->'period'->>'prevOntime')::int = 0,
    'mặc định: tuần trước 1/1, tuần trước nữa 0/1: '||(r->'period')::text);
  perform pg_temp.ok((r->'weeks'->0->>'due')::int = (r->'period'->>'due')::int and (r->'weeks'->1->>'due')::int = (r->'period'->>'prevDue')::int
    and jsonb_array_length(r->'weeks') = 4, 'khớp weeks[0] / weeks[1]: '||(r->'weeks')::text);
  perform pg_temp.ok(r ? 'tasks' and r ? 'review' and r ? 'load' and r ? 'doneSince', 'giữ các trường cũ');

  r := public.work_my_board_v1(p_from => '2026-09-01', p_to => '2026-09-30', p_prev_from => '2026-08-01', p_prev_to => '2026-08-31');
  perform pg_temp.ok(r->'period' = '{"from":"2026-09-01","to":"2026-09-30","due":3,"ontime":1,"prevFrom":"2026-08-01","prevTo":"2026-08-31","prevDue":1,"prevOntime":1}'::jsonb,
    'tháng 9 so tháng 8: '||(r->'period')::text);
  r := public.work_my_board_v1(p_from => '2026-09-01', p_to => '2026-09-30');
  perform pg_temp.ok((r->'period'->>'due')::int = 3 and r->'period'->'prevDue' = 'null'::jsonb and r->'period'->'prevOntime' = 'null'::jsonb
    and r->'period'->'prevFrom' = 'null'::jsonb, 'không kỳ trước ⇒ null: '||(r->'period')::text);
  perform pg_temp.as_('head');
  r := public.work_my_board_v1(p_from => '2026-09-01', p_to => '2026-09-30');
  perform pg_temp.ok((r->'period'->>'due')::int = 0, 'chỉ việc của chính người hỏi: '||(r->'period')::text);
end $$;

-- ── 8. Quyền gọi đúng chữ ký mới, không còn chữ ký cũ ────────────────────────────────────────────────
do $$ declare f text; begin
  foreach f in array array['public.work_team_board_v1(uuid,date,date,date,date,date)', 'public.work_company_board_v1(date,date,date,date,date)',
    'public.work_my_board_v1(date,date,date,date,date)', 'public.work_directives_v1(uuid,date,date)',
    'public.work_tasks_overview_v1(uuid,text,text,date,integer,date)'] loop
    perform pg_temp.ok(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
      and not has_function_privilege('public', f, 'execute'), 'quyền thực thi '||f);
  end loop;
  perform pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname in ('work_team_board_v1', 'work_company_board_v1', 'work_my_board_v1', 'work_directives_v1', 'work_tasks_overview_v1')) = 5,
    'không còn overload cũ');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'app_private.work_period_to(date,date)', 'execute'), 'hàm nội bộ không mở');
end $$;
