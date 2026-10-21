-- Vioo Work Đợt 2 PR-7: số kỳ gọn (work_period_digest_v1) + bản tin theo lịch. Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261023150000_work_dot2_digest.sql \
--   --smoke supabase/tests/work_dot2_digest_smoke.sql
-- Vai (tên giả): head = Phùng Quang Vĩ (trưởng U1; U1a là đơn vị con) · staff = Lục Thị Ngân (U1) · staff2 = Tôn Đức Bảo (U1a)
--   · head2 = Kha Minh Tuệ (trưởng U2) · staff3 = Ninh Thị Lam (U2) · noaccess = Quách Thị Mỵ (trưởng U4, không có Vioo Work)
--   · staff4 = Hầu Văn Sang (U4) · head5 = Diêm Văn Lực (trưởng U5, đơn vị không có việc) · bld = Thạch Ngọc Hân (U3, xem toàn công ty).
-- Kỳ thử cố định: tuần 36 (31/08 – 06/09/2026), kỳ trước 24/08 – 30/08. Bản tin gọi thẳng app_private.work_send_digests(p_now),
-- không phụ thuộc cron. Mọi thông báo chèn ra đều hoàn tác cùng giao dịch.
create temporary table wt_people(name text primary key, full_name text, id uuid default gen_random_uuid(),
  email text default ('work-dot2d-'||gen_random_uuid()||'@invalid.local'), employee_id uuid default gen_random_uuid());
insert into wt_people(name, full_name) values ('head', 'Phùng Quang Vĩ'), ('staff', 'Lục Thị Ngân'), ('staff2', 'Tôn Đức Bảo'),
  ('head2', 'Kha Minh Tuệ'), ('staff3', 'Ninh Thị Lam'), ('noaccess', 'Quách Thị Mỵ'), ('staff4', 'Hầu Văn Sang'),
  ('head5', 'Diêm Văn Lực'), ('bld', 'Thạch Ngọc Hân');
insert into public.users(id,name,username,email,role)
  select id,full_name,'work-dot2d-'||id,email,'EMPLOYEE'::public.user_role from wt_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select p.id, g.code, g.scope, '*', 'Work dot2 digest rollback test' from wt_people p
  cross join (values ('work.module.access','global'),('work.task.create','own'),('work.task.view_related','own'),('work.task.view_related','assigned')) g(code,scope)
  where p.name <> 'noaccess';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason,expires_at)
  select id,'work.task.view_scope','global','*','Work dot2 digest rollback test',null from wt_people where name = 'bld';
grant select on wt_people to authenticated, anon;

create function pg_temp.p(p_name text) returns uuid language sql as $$ select id from wt_people where name = p_name $$;
create function pg_temp.as_(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text
    from wt_people where name = p_name), true);
end $$;
create function pg_temp.ok(cond boolean, message text) returns void language plpgsql as $$ begin
  if cond is distinct from true then raise exception 'Work dot2 digest test failed: %', message; end if;
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$ begin
  execute p_sql; return null;
exception when others then return sqlstate || ':' || sqlerrm;
end $$;

-- ── Sơ đồ tổ chức giả ──────────────────────────────────────────────────────────────────────────────────
create temporary table wt_refs as select gen_random_uuid() as u1, gen_random_uuid() as u1a, gen_random_uuid() as u2, gen_random_uuid() as u3,
  gen_random_uuid() as u4, gen_random_uuid() as u5,
  gen_random_uuid() as slot1, gen_random_uuid() as slot2, gen_random_uuid() as slot4, gen_random_uuid() as slot5,
  (now() at time zone 'Asia/Ho_Chi_Minh')::date as today;
grant select on wt_refs to authenticated, anon;
create function pg_temp.u(p_name text) returns uuid language sql as $$
  select case p_name when 'u1' then u1 when 'u1a' then u1a when 'u2' then u2 when 'u3' then u3 when 'u4' then u4 when 'u5' then u5 end from wt_refs $$;
set local session_replication_role = 'replica';
insert into public.org_units(id, name, type, code)
  select u1, 'Work dot2d U1', 'department', 'WD2D-U1' from wt_refs union all select u2, 'Work dot2d U2', 'department', 'WD2D-U2' from wt_refs
  union all select u3, 'Work dot2d U3', 'department', 'WD2D-U3' from wt_refs union all select u4, 'Work dot2d U4', 'department', 'WD2D-U4' from wt_refs
  union all select u5, 'Work dot2d U5', 'department', 'WD2D-U5' from wt_refs;
insert into public.org_units(id, name, type, code, parent_id) select u1a, 'Work dot2d U1a', 'department', 'WD2D-U1A', u1 from wt_refs;
insert into public.hrm_org_position_slots(id, code, org_unit_id, position_id)
  select slot1, 'WD2D-HEAD1', u1, gen_random_uuid() from wt_refs union all select slot2, 'WD2D-HEAD2', u2, gen_random_uuid() from wt_refs
  union all select slot4, 'WD2D-HEAD4', u4, gen_random_uuid() from wt_refs union all select slot5, 'WD2D-HEAD5', u5, gen_random_uuid() from wt_refs;
update public.org_units o set manager_slot_id = s.slot from (
    select u1 as unit, slot1 as slot from wt_refs union all select u2, slot2 from wt_refs
    union all select u4, slot4 from wt_refs union all select u5, slot5 from wt_refs) s
  where o.id = s.unit;
insert into public.employees(id, full_name, user_id, org_unit_id, status)
  select employee_id, full_name, id, pg_temp.u(case name when 'head' then 'u1' when 'staff' then 'u1' when 'staff2' then 'u1a'
      when 'head2' then 'u2' when 'staff3' then 'u2' when 'noaccess' then 'u4' when 'staff4' then 'u4' when 'head5' then 'u5' else 'u3' end),
    'Đang làm việc'
  from wt_people;
insert into public.hrm_employee_slot_assignments(employee_id, slot_id, assignment_type, status, effective_from)
  select (select employee_id from wt_people where name = 'head'), slot1, 'PRIMARY', 'ACTIVE', date '2026-01-01' from wt_refs
  union all select (select employee_id from wt_people where name = 'head2'), slot2, 'PRIMARY', 'ACTIVE', date '2026-01-01' from wt_refs
  union all select (select employee_id from wt_people where name = 'noaccess'), slot4, 'PRIMARY', 'ACTIVE', date '2026-01-01' from wt_refs
  union all select (select employee_id from wt_people where name = 'head5'), slot5, 'ACTING', 'ACTIVE', date '2026-01-01' from wt_refs;

-- ── Việc thử (chèn thẳng, mã VW-2099-…) ───────────────────────────────────────────────────────────────
create temporary table wt_tasks(name text primary key, id uuid default gen_random_uuid(), assignee text, status text,
  deadline timestamptz, done_at timestamptz, directive boolean default false);
grant select on wt_tasks to authenticated, anon;
insert into wt_tasks(name, assignee, status, deadline, done_at, directive) values
  ('t1', 'staff', 'completed', '2026-09-02 10:00+07', '2026-09-01 10:00+07', true),     -- đúng hạn, chỉ đạo xong trong kỳ
  ('t2', 'staff', 'completed', '2026-09-03 10:00+07', '2026-09-05 10:00+07', false),    -- xong trễ
  ('t3', 'staff', 'in_progress', '2026-09-04 10:00+07', null, true),                    -- quá hạn, chỉ đạo trễ
  ('t4', 'staff', 'cancelled', '2026-09-05 10:00+07', null, false),                     -- hủy: không tính
  ('tdraft', 'staff', 'draft', '2026-09-03 10:00+07', null, false),                     -- nháp: không tính
  ('t5', 'staff', 'completed', '2026-08-26 10:00+07', '2026-08-25 10:00+07', false),    -- kỳ trước đúng hạn
  ('t6', 'staff', 'completed', '2026-08-27 10:00+07', '2026-08-28 10:00+07', false),    -- kỳ trước trễ
  ('t7', 'staff2', 'completed', '2026-09-02 10:00+07', '2026-09-02 09:00+07', false),   -- đơn vị con, đúng hạn
  ('t8', 'staff2', 'completed', '2026-08-26 10:00+07', '2026-08-26 09:00+07', false),   -- đơn vị con, kỳ trước đúng hạn
  ('t9', 'staff2', 'in_progress', now() + interval '2 days', null, false),             -- chưa đến hạn
  ('t10', 'staff3', 'in_progress', '2026-09-03 10:00+07', null, false),                 -- U2 quá hạn
  ('t11', 'staff4', 'in_progress', '2026-09-03 10:00+07', null, false);                 -- U4 quá hạn
insert into public.work_tasks(id, task_code, title, scope_type, status, priority, privacy, deadline_at, created_by, completed_at, cancelled_at)
  select w.id, 'VW-2099-' || lpad((row_number() over (order by w.name) + floor(random() * 90000000)::int)::text, 9, '0'),
    'PR7: ' || w.name, 'direct', w.status, 'normal', 'standard', w.deadline, pg_temp.p('head'),
    case when w.status = 'completed' then w.done_at end, case when w.status = 'cancelled' then now() - interval '1 day' end
  from wt_tasks w;
insert into public.work_task_assignments(task_id, user_id, state, assigned_by, acknowledged_at, completed_at, ended_at)
  select w.id, pg_temp.p(w.assignee),
    case w.status when 'completed' then 'completed' when 'cancelled' then 'cancelled' when 'draft' then 'pending_acknowledgement' else 'in_progress' end,
    pg_temp.p('head'), case when w.status <> 'draft' then now() - interval '1 hour' end,
    case when w.status = 'completed' then w.done_at end,
    case when w.status in ('completed', 'cancelled') then coalesce(w.done_at, now() - interval '1 day') end
  from wt_tasks w;
insert into public.work_task_origins(task_id, origin, claim_status, created_by)
  select w.id, 'directive', 'not_needed', pg_temp.p('bld') from wt_tasks w where w.directive;
-- Mục tiêu U1: tháng 8 đạt (10/10), tháng 9 chưa đạt (5/10, đã có giải pháp).
create temporary table wt_goals(name text primary key, id uuid default gen_random_uuid());
grant select on wt_goals to authenticated, anon;
insert into wt_goals(name) values ('aug'), ('sep');
insert into public.work_goals(id, org_unit_id, period_kind, period_start, title, target_value, unit, actual_value, solution, created_by)
  select (select id from wt_goals where name = 'aug'), u1, 'month', date '2026-08-01', 'Hoàn thành việc tháng 8', 10, 'việc', 10, null, pg_temp.p('head') from wt_refs
  union all select (select id from wt_goals where name = 'sep'), u1, 'month', date '2026-09-01', 'Hoàn thành việc tháng 9', 10, 'việc', 5,
    'Chia việc lớn thành bước tuần.', pg_temp.p('head') from wt_refs;
set local session_replication_role = 'origin';
create function pg_temp.t(p_name text) returns uuid language sql as $$ select id from wt_tasks where name = p_name $$;

-- ── 1. Quyền ──────────────────────────────────────────────────────────────────────────────────────────
do $$ declare e text; r jsonb; v_call text := 'select public.work_period_digest_v1(%L::uuid, %L::date, %L::date, %L::date, %L::date)'; begin
  perform pg_temp.as_('staff');
  e := pg_temp.err(format(v_call, pg_temp.u('u1'), '2026-08-31', '2026-09-06', null, null));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'nhân viên không xem số kỳ đơn vị: '||coalesce(e, 'null'));
  e := pg_temp.err(format(v_call, null, '2026-08-31', '2026-09-06', null, null));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'nhân viên không xem số kỳ công ty: '||coalesce(e, 'null'));
  perform pg_temp.as_('noaccess');
  e := pg_temp.err(format(v_call, pg_temp.u('u4'), '2026-08-31', '2026-09-06', null, null));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'không có Vioo Work (dù là trưởng): '||coalesce(e, 'null'));
  perform pg_temp.as_('head');
  e := pg_temp.err(format(v_call, pg_temp.u('u2'), '2026-08-31', '2026-09-06', null, null));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'trưởng U1 không xem U2: '||coalesce(e, 'null'));
  e := pg_temp.err(format(v_call, null, '2026-08-31', '2026-09-06', null, null));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'trưởng không xem toàn công ty: '||coalesce(e, 'null'));
  e := pg_temp.err(format(v_call, gen_random_uuid(), '2026-08-31', '2026-09-06', null, null));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'đơn vị không có: '||coalesce(e, 'null'));
  e := pg_temp.err(format(v_call, pg_temp.u('u1'), null, null, null, null));
  perform pg_temp.ok(e = '22023:WORK_INVALID_PERIOD', 'thiếu kỳ: '||coalesce(e, 'null'));
  e := pg_temp.err(format(v_call, pg_temp.u('u1'), '2026-09-06', '2026-08-31', null, null));
  perform pg_temp.ok(e = '22023:WORK_INVALID_PERIOD', 'đến < từ: '||coalesce(e, 'null'));
  r := public.work_period_digest_v1(pg_temp.u('u1a'), '2026-08-31', '2026-09-06');
  perform pg_temp.ok(r->>'scopeName' = 'Work dot2d U1a', 'trưởng U1 xem đơn vị con: '||r::text);
end $$;

-- ── 2. Số kỳ đơn vị (tính trực tiếp) ─────────────────────────────────────────────────────────────────
do $$ declare r jsonb; b jsonb; s jsonb; begin
  perform pg_temp.as_('head');
  r := public.work_period_digest_v1(pg_temp.u('u1'), '2026-08-31', '2026-09-06', '2026-08-24', '2026-08-30');
  perform pg_temp.ok(r->>'orgUnitId' = pg_temp.u('u1')::text and r->>'scopeName' = 'Work dot2d U1' and r->>'from' = '2026-08-31' and r->>'to' = '2026-09-06'
    and r->>'statsTo' = '2026-09-06' and not (r->>'closed')::boolean and r->'closedAt' = 'null'::jsonb and r->'closedBy' = 'null'::jsonb,
    'phạm vi + chưa chốt: '||r::text);
  perform pg_temp.ok((r->>'due')::int = 4 and (r->>'ontime')::int = 2 and (r->>'rate')::int = 50 and (r->>'prevRate')::int = 67
    and (r->>'overdue')::int = 1 and (r->>'stale')::int = 0,
    'U1 + U1a: 4 đến hạn (không tính hủy / nháp / chưa đến hạn), 2 đúng hạn ⇒ 50%; kỳ trước 2/3 ⇒ 67%; 1 quá hạn: '||r::text);
  perform pg_temp.ok(r->'directives' = '{"open":1,"late":1,"done":1}'::jsonb, 'chỉ đạo như Sổ chỉ đạo đơn vị (t1 xong trong kỳ tính cho người làm cuối): '||(r->'directives')::text);
  perform pg_temp.ok(r->'goals' = '{"total":2,"met":1,"missed":1,"atRisk":0}'::jsonb, 'mục tiêu tháng 8 + 9 giao với kỳ: '||(r->'goals')::text);
  perform pg_temp.ok(r->'worst' = jsonb_build_array(jsonb_build_object('id', pg_temp.p('staff'), 'name', 'Lục Thị Ngân', 'code', null,
      'overdue', 1, 'late', 2, 'rate', 33)), 'người trễ nhiều nhất, bỏ dòng = 0: '||(r->'worst')::text);
  perform pg_temp.ok(r->'lines' = jsonb_build_array('Đúng hạn 50% (2/4 việc đến hạn) · kỳ trước 67%', 'Đang quá hạn: 1 việc',
      'Chỉ đạo: 1 đang mở · 1 trễ · 1 xong trong kỳ', 'Mục tiêu: 1/2 đạt · 1 chưa đạt', 'Cần chú ý: Lục Thị Ngân (1 quá hạn, 2 không đúng hạn)'),
    'dòng chữ thông báo: '||(r->'lines')::text);

  -- Khớp bảng Phòng tôi cùng kỳ.
  b := public.work_team_board_v1(pg_temp.u('u1'), null, '2026-08-31', '2026-09-06', '2026-08-24', '2026-08-30');
  perform pg_temp.ok((select sum((m->>'due')::int) = (r->>'due')::int and sum((m->>'ontime')::int) = (r->>'ontime')::int
      and sum((m->>'overdue')::int) = (r->>'overdue')::int and sum((m->>'stale')::int) = (r->>'stale')::int from jsonb_array_elements(b->'members') m),
    'khớp Phòng tôi: '||(b->'members')::text);

  -- Không kỳ trước ⇒ prevRate null (không che bằng 0).
  r := public.work_period_digest_v1(pg_temp.u('u1'), '2026-08-31', '2026-09-06');
  perform pg_temp.ok(r->'prevRate' = 'null'::jsonb and (r->>'rate')::int = 50 and r->'lines'->>0 = 'Đúng hạn 50% (2/4 việc đến hạn)', 'không kỳ trước: '||r::text);

  -- Kỳ đang chạy: chỉ tính tới hôm nay; chưa có việc đến hạn ⇒ rate null.
  r := public.work_period_digest_v1(pg_temp.u('u1'), (select today from wt_refs) - 1, (select today from wt_refs) + 5);
  perform pg_temp.ok((r->>'due')::int = 0 and r->'rate' = 'null'::jsonb and (r->>'statsTo')::date = (select today from wt_refs)
    and r->'lines'->>0 = 'Chưa có việc đến hạn trong kỳ' and (r->>'overdue')::int = 1, 'kỳ đang chạy: '||r::text);

  -- U2: không mục tiêu ⇒ 4 dòng; 0% đúng hạn.
  perform pg_temp.as_('head2');
  r := public.work_period_digest_v1(pg_temp.u('u2'), '2026-08-31', '2026-09-06', '2026-08-24', '2026-08-30');
  perform pg_temp.ok((r->>'due')::int = 1 and (r->>'rate')::int = 0 and r->'prevRate' = 'null'::jsonb and jsonb_array_length(r->'lines') = 4
    and r->'lines'->>3 = 'Cần chú ý: Ninh Thị Lam (1 quá hạn, 1 không đúng hạn)', 'U2: '||r::text);
end $$;

-- ── 3. Số kỳ toàn công ty: BLĐ; khớp bảng Toàn công ty ────────────────────────────────────────────────
do $$ declare r jsonb; b jsonb; v_due int; v_ontime int; v_overdue int; v_pd int; v_po int; begin
  perform pg_temp.as_('bld');
  r := public.work_period_digest_v1(null, '2026-08-31', '2026-09-06', '2026-08-24', '2026-08-30');
  b := public.work_company_board_v1(null, '2026-08-31', '2026-09-06', '2026-08-24', '2026-08-30');
  select sum((u->>'due')::int), sum((u->>'ontime')::int), sum((u->>'overdue')::int), sum((u->>'prevDue')::int), sum((u->>'prevOntime')::int)
    into v_due, v_ontime, v_overdue, v_pd, v_po from jsonb_array_elements(b->'units') u;
  perform pg_temp.ok(r->>'scopeName' = 'Toàn công ty' and r->'orgUnitId' = 'null'::jsonb and (r->>'due')::int = v_due and (r->>'ontime')::int = v_ontime
    and (r->>'overdue')::int = v_overdue and r->'prevRate' = coalesce(to_jsonb(case when v_pd > 0 then round(v_po * 100.0 / v_pd)::int end), 'null'::jsonb)
    and (r->>'due')::int >= 5, 'khớp Toàn công ty: '||(r - 'lines')::text);
  perform pg_temp.ok((r->'directives'->>'done')::int >= 1 and (r->'directives'->>'late')::int >= 1, 'chỉ đạo toàn công ty có việc xong trong kỳ: '||(r->'directives')::text);
  perform pg_temp.ok(jsonb_array_length(r->'worst') between 1 and 5
    and (select bool_and((w->>'overdue')::int + (w->>'late')::int > 0 and w ? 'code') from jsonb_array_elements(r->'worst') w)
    and (select bool_and(((r->'worst'->(i - 1)->>'overdue')::int + (r->'worst'->(i - 1)->>'late')::int)
        >= ((r->'worst'->i->>'overdue')::int + (r->'worst'->i->>'late')::int)) from generate_series(1, jsonb_array_length(r->'worst') - 1) i) is not false,
    'xếp đơn vị trễ giảm dần: '||(r->'worst')::text);
  perform pg_temp.ok(jsonb_array_length(r->'lines') between 3 and 5, 'dòng chữ 3–5: '||(r->'lines')::text);
  r := public.work_period_digest_v1(pg_temp.u('u1'), '2026-08-31', '2026-09-06', '2026-08-24', '2026-08-30');
  perform pg_temp.ok((r->>'due')::int = 4, 'BLĐ xem được đơn vị');
end $$;

-- ── 4. Đã chốt ⇒ lấy số từ ảnh chốt ───────────────────────────────────────────────────────────────────
create temporary table wt_close(id uuid, closed_at timestamptz);
grant select on wt_close to authenticated, anon;
do $$ declare c jsonb; begin
  perform pg_temp.as_('head');
  c := public.work_period_close_v1(pg_temp.u('u1'), '2026-08-31', '2026-09-06', '2026-08-24', '2026-08-30', 'Tuần 36 · thử');
  insert into wt_close values ((c->>'closeId')::uuid, (c->>'closedAt')::timestamptz);
end $$;
-- Sau khi chốt: t2 thành đúng hạn ⇒ số chạy thật đổi, ảnh chốt không đổi.
set local session_replication_role = 'replica';
update public.work_tasks set completed_at = deadline_at - interval '1 hour' where id = (select id from wt_tasks where name = 't2');
update public.work_task_assignments a set completed_at = t.deadline_at - interval '1 hour' from public.work_tasks t
  where t.id = a.task_id and a.task_id = (select id from wt_tasks where name = 't2');
set local session_replication_role = 'origin';
do $$ declare r jsonb; begin
  perform pg_temp.as_('head');
  perform pg_temp.ok((select sum((m->>'ontime')::int) from jsonb_array_elements(
      public.work_team_board_v1(pg_temp.u('u1'), null, '2026-08-31', '2026-09-06', '2026-08-24', '2026-08-30')->'members') m) = 3,
    'số chạy thật đã đổi (t2 nay đúng hạn)');
  r := public.work_period_digest_v1(pg_temp.u('u1'), '2026-08-31', '2026-09-06', '2026-08-24', '2026-08-30');
  perform pg_temp.ok((r->>'closed')::boolean and r->>'closedBy' = 'Phùng Quang Vĩ' and (r->>'closedAt')::timestamptz = (select closed_at from wt_close)
    and (r->>'due')::int = 4 and (r->>'ontime')::int = 2 and (r->>'rate')::int = 50 and (r->>'prevRate')::int = 67
    and r->'goals' = '{"total":2,"met":1,"missed":1,"atRisk":0}'::jsonb and r->'directives' = '{"open":1,"late":1,"done":1}'::jsonb
    and r->'worst'->0->>'id' = pg_temp.p('staff')::text and (r->'worst'->0->>'late')::int = 2 and r->>'statsTo' = '2026-09-06',
    'kỳ đã chốt lấy số ảnh chốt: '||r::text);
  -- Kỳ khác (không chốt) vẫn tính trực tiếp.
  r := public.work_period_digest_v1(pg_temp.u('u1'), '2026-08-31', '2026-09-05');
  perform pg_temp.ok(not (r->>'closed')::boolean and (r->>'ontime')::int = 3, 'kỳ khác tính trực tiếp: '||r::text);
end $$;

-- ── 5. Lịch báo cáo: work_digest_period ───────────────────────────────────────────────────────────────
create function pg_temp.per(p_cadence text, p_dow int, p_time time, p_now timestamptz) returns jsonb language sql as $$
  select to_jsonb(x) from app_private.work_digest_period(
    row(gen_random_uuid(), null, p_cadence, 6, '17:00'::time, p_dow, p_time, null, now())::public.work_period_settings, p_now) x $$;
create function pg_temp.per_ok(r jsonb, p_due timestamptz, p_from date, p_to date, p_label text, message text) returns void language plpgsql as $$ begin
  perform pg_temp.ok((r->>'due_at')::timestamptz = p_due and (r->>'period_from')::date = p_from and (r->>'period_to')::date = p_to and r->>'label' = p_label,
    message || ': ' || coalesce(r::text, 'null'));
end $$;
do $$ begin
  perform pg_temp.per_ok(pg_temp.per('week', 1, '08:00', '2026-10-19 08:00+07'), '2026-10-19 08:00+07', '2026-10-12', '2026-10-18', 'Tuần 42 · 12–18/10',
    'tuần: đúng giờ báo cáo T2 08:00 ⇒ kỳ tuần trước');
  perform pg_temp.per_ok(pg_temp.per('week', 1, '08:00', '2026-10-19 07:59:59+07'), '2026-10-12 08:00+07', '2026-10-05', '2026-10-11', 'Tuần 41 · 05–11/10',
    'tuần: trước giờ báo cáo 1 giây ⇒ lần trước');
  perform pg_temp.per_ok(pg_temp.per('week', 1, '00:15', '2026-10-19 00:30+07'), '2026-10-19 00:15+07', '2026-10-12', '2026-10-18', 'Tuần 42 · 12–18/10',
    'tuần: ngày theo giờ VN (UTC còn chủ nhật)');
  perform pg_temp.per_ok(pg_temp.per('week', 0, '18:00', '2026-10-25 19:00+07'), '2026-10-25 18:00+07', '2026-10-12', '2026-10-18', 'Tuần 42 · 12–18/10',
    'tuần: báo cáo chủ nhật ⇒ tuần liền trước tuần chứa chủ nhật');
  perform pg_temp.per_ok(pg_temp.per('week', 5, '17:00', '2026-10-21 12:00+07'), '2026-10-16 17:00+07', '2026-10-05', '2026-10-11', 'Tuần 41 · 05–11/10',
    'tuần: báo cáo thứ 6, hôm nay thứ 4');
  perform pg_temp.per_ok(pg_temp.per('2weeks', 1, '08:00', '2026-10-21 12:00+07'), '2026-10-12 08:00+07', '2026-09-28', '2026-10-11', '28/09 – 11/10',
    '2 tuần: chỉ tuần ISO chẵn (43 lẻ ⇒ 42)');
  perform pg_temp.per_ok(pg_temp.per('2weeks', 1, '08:00', '2026-10-12 08:00+07'), '2026-10-12 08:00+07', '2026-09-28', '2026-10-11', '28/09 – 11/10',
    '2 tuần: đúng giờ ở tuần chẵn');
  perform pg_temp.per_ok(pg_temp.per('2weeks', 1, '08:00', '2026-10-12 07:00+07'), '2026-09-28 08:00+07', '2026-09-14', '2026-09-27', '14/09 – 27/09',
    '2 tuần: trước giờ ⇒ tuần chẵn trước (40)');
end $$;
do $$ begin
  perform pg_temp.per_ok(pg_temp.per('2weeks', 1, '08:00', '2027-01-06 12:00+07'), '2026-12-21 08:00+07', '2026-12-07', '2026-12-20', '07/12 – 20/12',
    '2 tuần qua năm 53 tuần: tuần 1 lẻ, 53 lẻ ⇒ tuần 52');
  perform pg_temp.per_ok(pg_temp.per('month', 1, '08:00', '2026-10-05 08:00+07'), '2026-10-05 08:00+07', '2026-09-01', '2026-09-30', 'Tháng 9/2026',
    'tháng: thứ 2 đầu tiên của tháng lúc 08:00 ⇒ tháng trước');
  perform pg_temp.per_ok(pg_temp.per('month', 1, '08:00', '2026-10-05 07:59+07'), '2026-09-07 08:00+07', '2026-08-01', '2026-08-31', 'Tháng 8/2026',
    'tháng: trước giờ ⇒ lần của tháng trước');
  perform pg_temp.per_ok(pg_temp.per('month', 4, '08:00', '2026-10-01 09:00+07'), '2026-10-01 08:00+07', '2026-09-01', '2026-09-30', 'Tháng 9/2026',
    'tháng: ngày 1 đúng thứ báo cáo');
  perform pg_temp.per_ok(pg_temp.per('month', 1, '08:00', '2026-01-10 08:00+07'), '2026-01-05 08:00+07', '2025-12-01', '2025-12-31', 'Tháng 12/2025',
    'tháng: qua năm');
end $$;

-- ── 6. Bản tin theo lịch: work_send_digests(p_now) ─────────────────────────────────────────────────────
-- Công ty: tuần, báo cáo T2 08:00. U1: lịch riêng tháng, T2 đầu tháng 08:00 (T2 07/09/2026 trùng cả hai lịch). U2, U4, U5 theo công ty.
insert into public.work_period_settings(org_unit_id, cadence, report_dow, report_time) values (null, 'week', 1, '08:00')
  on conflict ((coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update
  set cadence = excluded.cadence, report_dow = excluded.report_dow, report_time = excluded.report_time;
insert into public.work_period_settings(org_unit_id, cadence, report_dow, report_time) select u1, 'month', 1, '08:00' from wt_refs;
create function pg_temp.digests(p_name text) returns table(n bigint, source_id text, title text, link text, ok boolean) language sql as $$
  select count(*) over (), n.source_id, n.title, n.link,
    n.action_url = '/#' || n.link and n.push_enabled and n.delivery_reason = 'system' and n.delivery_mode = 'instant'
      and n.module = 'work' and n.category = 'work' and n.entity_type = 'work_digest' and n.work_delivery_id is null and not n.is_read
      and n.message = n.body and n.message like '%' || E'\n' || '%'
  from public.notifications n where n.user_id = pg_temp.p(p_name)::text and n.source_type = 'work_digest' $$;
create function pg_temp.fake_sends() returns bigint language sql as $$
  select count(*) from app_private.work_digest_sends s
  where s.scope_key = 'company' or s.scope_key in (select x::text from wt_refs, unnest(array[u1, u1a, u2, u3, u4, u5]) x) $$;
create function pg_temp.fake_digests() returns bigint language sql as $$
  select count(*) from public.notifications n where n.source_type = 'work_digest' and n.user_id in (select id::text from wt_people) $$;

do $$ declare v integer; begin
  -- Tắt thông báo Vioo Work ⇒ không gửi.
  update app_private.work_notification_settings set enabled = false where singleton;
  v := app_private.work_send_digests('2026-09-07 08:00+07');
  perform pg_temp.ok(v = 0 and pg_temp.fake_sends() = 0 and pg_temp.fake_digests() = 0, 'tắt thông báo ⇒ không gửi: '||v);
  update app_private.work_notification_settings set enabled = true where singleton;

  -- Trước giờ báo cáo 1 giây: lần gần nhất là T2 31/08 (đã quá 1 ngày) ⇒ không gửi bù.
  perform app_private.work_send_digests('2026-09-07 07:59:59+07');
  perform pg_temp.ok(pg_temp.fake_sends() = 0 and pg_temp.fake_digests() = 0, 'trước giờ báo cáo ⇒ không gửi bù kỳ cũ');
  -- Tròn 1 ngày sau giờ báo cáo: ngoài cửa sổ.
  perform app_private.work_send_digests('2026-09-08 08:00+07');
  perform pg_temp.ok(pg_temp.fake_sends() = 0 and pg_temp.fake_digests() = 0, 'ngoài cửa sổ 1 ngày ⇒ không gửi');
end $$;

do $$ declare v integer; r record; v_u1 uuid := pg_temp.u('u1'); v_u2 uuid := pg_temp.u('u2'); begin
  v := app_private.work_send_digests('2026-09-07 08:00+07');
  perform pg_temp.ok(v >= 3, 'đúng giờ báo cáo ⇒ gửi: '||v);

  select * into r from pg_temp.digests('bld');
  perform pg_temp.ok(r.n = 1 and r.ok and r.source_id = 'company:2026-08-31:2026-09-06' and r.title = 'Bản tin Tuần 36 · 31–06/09 · Toàn công ty'
    and r.link = '/work/my?space=company&from=2026-08-31&to=2026-09-06&report=1', 'BLĐ nhận bản tin công ty: '||row_to_json(r)::text);
  select * into r from pg_temp.digests('head');
  perform pg_temp.ok(r.n = 1 and r.ok and r.source_id = v_u1 || ':2026-08-01:2026-08-31' and r.title = 'Bản tin Tháng 8/2026 · Work dot2d U1'
    and r.link = '/work/my?space=team&unit=' || v_u1 || '&from=2026-08-01&to=2026-08-31&report=1',
    'trưởng U1 nhận theo lịch riêng (tháng), không nhận bản tin công ty: '||row_to_json(r)::text);
  select * into r from pg_temp.digests('head2');
  perform pg_temp.ok(r.n = 1 and r.ok and r.source_id = v_u2 || ':2026-08-31:2026-09-06' and r.title = 'Bản tin Tuần 36 · 31–06/09 · Work dot2d U2'
    and r.link = '/work/my?space=team&unit=' || v_u2 || '&from=2026-08-31&to=2026-09-06&report=1', 'trưởng U2 theo lịch công ty: '||row_to_json(r)::text);
  perform pg_temp.ok(not exists (select 1 from pg_temp.digests('staff')) and not exists (select 1 from pg_temp.digests('staff2'))
    and not exists (select 1 from pg_temp.digests('staff3')) and not exists (select 1 from pg_temp.digests('staff4'))
    and not exists (select 1 from pg_temp.digests('noaccess')) and not exists (select 1 from pg_temp.digests('head5')),
    'nhân viên, trưởng không có Vioo Work, trưởng đơn vị không có số ⇒ không nhận');
  perform pg_temp.ok((select message from public.notifications where user_id = pg_temp.p('head2')::text and source_type = 'work_digest')
      = array_to_string(array(select jsonb_array_elements_text(app_private.work_period_digest(v_u2, '2026-08-31', '2026-09-06', '2026-08-24', '2026-08-30')->'lines')), E'\n'),
    'nội dung = dòng chữ của số kỳ');

  perform pg_temp.ok((select recipients from app_private.work_digest_sends where scope_key = v_u1::text and period_from = '2026-08-01' and period_to = '2026-08-31') = 1
    and (select recipients from app_private.work_digest_sends where scope_key = v_u2::text and period_from = '2026-08-31' and period_to = '2026-09-06') = 1
    and (select recipients from app_private.work_digest_sends where scope_key = 'company' and period_from = '2026-08-31' and period_to = '2026-09-06') >= 1
    and (select recipients from app_private.work_digest_sends where scope_key = pg_temp.u('u4')::text) = 0
    and (select recipients from app_private.work_digest_sends where scope_key = pg_temp.u('u5')::text) = 0
    and not exists (select 1 from app_private.work_digest_sends where scope_key in (pg_temp.u('u3')::text, pg_temp.u('u1a')::text)),
    'ghi đã gửi theo phạm vi + kỳ; U3 / U1a không có trưởng ⇒ không xét: '||
      (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from app_private.work_digest_sends s where s.scope_key <> 'company'
        and s.scope_key in (select x::text from wt_refs, unnest(array[u1, u1a, u2, u3, u4, u5]) x))::text);
end $$;

do $$ declare v_before bigint := pg_temp.fake_digests(); begin
  perform app_private.work_send_digests('2026-09-07 09:00+07');
  perform app_private.work_send_digests('2026-09-08 07:59+07');
  perform pg_temp.ok(pg_temp.fake_digests() = v_before and v_before = 3, 'gọi lại trong cửa sổ không gửi lần 2: '||pg_temp.fake_digests());
end $$;

-- ── 7. Quyền thực thi + cron ───────────────────────────────────────────────────────────────────────────
do $$ declare f text; begin
  f := 'public.work_period_digest_v1(uuid,date,date,date,date)';
  perform pg_temp.ok(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
    and not has_function_privilege('public', f, 'execute'), 'quyền thực thi '||f);
  foreach f in array array['app_private.work_period_digest(uuid,date,date,date,date)',
    'app_private.work_digest_period(public.work_period_settings,timestamptz)', 'app_private.work_send_digests(timestamptz)'] loop
    perform pg_temp.ok(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
      and not has_function_privilege('public', f, 'execute'), 'hàm nội bộ không mở '||f);
  end loop;
  perform pg_temp.ok(not has_table_privilege('authenticated', 'app_private.work_digest_sends', 'select')
    and not has_table_privilege('anon', 'app_private.work_digest_sends', 'select')
    and (select c.relrowsecurity from pg_class c where c.oid = 'app_private.work_digest_sends'::regclass), 'bảng đã gửi đóng + RLS');
  perform pg_temp.ok((select count(*) from cron.job where jobname = 'work-period-digests' and schedule = '*/15 * * * *'
    and command = 'select app_private.work_send_digests();') = 1, 'cron work-period-digests 15 phút, một job');
end $$;
