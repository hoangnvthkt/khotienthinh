-- Vioo Work · Việc của tôi (work_my_board_v1). Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261022150000_work_my_board.sql \
--   --smoke supabase/tests/work_my_board_smoke.sql
-- Vai: head (trưởng đơn vị U1) · staff (nhân viên U1) · outsider (nhân viên U2) · bld (xem toàn công ty) · noaccess (không có Vioo Work).
create temporary table wt_people(name text primary key, id uuid default gen_random_uuid(),
  email text default ('work-dot1-'||gen_random_uuid()||'@invalid.local'), employee_id uuid default gen_random_uuid());
insert into wt_people(name) values ('head'),('staff'),('outsider'),('bld'),('noaccess');
insert into public.users(id,name,username,email,role)
  select id,'Work dot1 '||name,'work-dot1-'||id,email,'EMPLOYEE'::public.user_role from wt_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select p.id, g.code, g.scope, '*', 'Work dot1 rollback test' from wt_people p
  cross join (values ('work.module.access','global'),('work.task.create','own'),('work.task.view_related','own'),('work.task.view_related','assigned')) g(code,scope)
  where p.name <> 'noaccess';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select p.id, g.code, g.scope, '*', 'Work dot1 rollback test' from wt_people p
  cross join (values ('work.task.assign_user','own'),('work.task.review','assigned')) g(code,scope) where p.name in ('head','bld');
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason,expires_at)
  select id,'work.task.view_scope','global','*','Work dot1 rollback test',null from wt_people where name = 'bld';
grant select on wt_people to authenticated, anon;

create function pg_temp.p(p_name text) returns uuid language sql as $$ select id from wt_people where name = p_name $$;
create function pg_temp.as_(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text
    from wt_people where name = p_name), true);
end $$;
create function pg_temp.ok(cond boolean, message text) returns void language plpgsql as $$ begin
  if cond is distinct from true then raise exception 'Work dot1 test failed: %', message; end if;
end $$;
-- Gọi một khối SQL, trả về mã lỗi (null nếu chạy được).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$ begin
  execute p_sql; return null;
exception when others then return sqlerrm;
end $$;

-- ── Sơ đồ tổ chức giả: U1 (head làm trưởng, staff, noaccess), U2 (outsider, bld) ────────────────────
create temporary table wt_refs as select gen_random_uuid() as u1, gen_random_uuid() as u2, gen_random_uuid() as slot1;
grant select on wt_refs to authenticated, anon;
set local session_replication_role = 'replica';
insert into public.org_units(id, name, type, code) select u1, 'Work dot1 U1', 'department', 'WD1-U1' from wt_refs
  union all select u2, 'Work dot1 U2', 'department', 'WD1-U2' from wt_refs;
insert into public.hrm_org_position_slots(id, code, org_unit_id, position_id) select slot1, 'WD1-HEAD', u1, gen_random_uuid() from wt_refs;
update public.org_units set manager_slot_id = (select slot1 from wt_refs) where id = (select u1 from wt_refs);
insert into public.employees(id, full_name, user_id, org_unit_id, status)
  select employee_id, 'Work dot1 '||name, id, case when name in ('head','staff','noaccess') then (select u1 from wt_refs) else (select u2 from wt_refs) end, 'Đang làm việc'
  from wt_people;
insert into public.hrm_employee_slot_assignments(employee_id, slot_id, assignment_type, status, effective_from)
  select (select employee_id from wt_people where name = 'head'), slot1, 'PRIMARY', 'ACTIVE', current_date - 1 from wt_refs;
set local session_replication_role = 'origin';

do $$ begin
  perform pg_temp.ok(app_private.work_user_heads_user(pg_temp.p('head'), pg_temp.p('staff')), 'head là trưởng của staff');
  perform pg_temp.ok(not app_private.work_user_heads_user(pg_temp.p('head'), pg_temp.p('outsider')), 'head không là trưởng của outsider');
  perform pg_temp.ok(not app_private.work_user_heads_user(pg_temp.p('staff'), pg_temp.p('head')), 'staff không là trưởng của head');
  perform pg_temp.ok(not app_private.work_user_heads_user(pg_temp.p('head'), pg_temp.p('head')), 'không tự làm trưởng của mình');
end $$;

-- ── Tạo việc bằng lệnh thật ─────────────────────────────────────────────────────────────────────────
create temporary table wt_tasks(name text primary key, id uuid);
grant select, insert on wt_tasks to authenticated, anon;
create function pg_temp.create_task(p_actor text, p_title text, p_recipient text, p_priority text, p_privacy text) returns uuid language plpgsql as $$
declare v_scope jsonb := '{"type":"direct"}'; v_sources jsonb; v_preview jsonb; v_res jsonb;
begin
  perform pg_temp.as_(p_actor);
  v_sources := jsonb_build_array(jsonb_build_object('type','user','id',pg_temp.p(p_recipient)));
  v_preview := public.preview_work_task_recipients(v_sources, v_scope);
  v_res := public.create_work_task(jsonb_build_object('title', p_title,
    'description', '{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Việc thử Đợt 1"}]}]}'::jsonb,
    'scope', v_scope, 'recipientSources', v_sources, 'watcherUserIds', '[]'::jsonb, 'priority', p_priority, 'privacy', p_privacy,
    'labels', '["Thử"]'::jsonb, 'checklist', '[{"title":"Bước 1"},{"title":"Bước 2"}]'::jsonb,
    'deadlineAt', to_jsonb(now() + interval '3 days')), gen_random_uuid(), v_preview->>'fingerprint');
  return (v_res->>'taskId')::uuid;
end $$;
insert into wt_tasks values
  ('ack', pg_temp.create_task('head', 'Board: đã nhận, chưa bắt đầu', 'staff', 'urgent', 'standard')),
  ('unack', pg_temp.create_task('head', 'Board: chưa nhận việc', 'staff', 'important', 'standard')),
  ('other', pg_temp.create_task('bld', 'Board: người đơn vị khác giao', 'staff', 'normal', 'standard')),
  ('self', pg_temp.create_task('staff', 'Board: tự ghi việc giao miệng', 'staff', 'important', 'standard')),
  ('notmine', pg_temp.create_task('head', 'Board: việc của người khác', 'outsider', 'urgent', 'standard')),
  ('lastweek', pg_temp.create_task('head', 'Board: hạn tuần trước, xong đúng hạn', 'staff', 'normal', 'standard')),
  ('lastlate', pg_temp.create_task('head', 'Board: hạn tuần trước, trễ', 'staff', 'normal', 'standard'));

do $$ declare n text; t uuid; v bigint; begin
  perform pg_temp.as_('staff');
  foreach n in array array['ack', 'other', 'lastweek', 'lastlate'] loop
    t := (select id from wt_tasks where name = n);
    select lock_version into v from public.work_tasks where id = t;
    perform public.command_work_task(t, 'acknowledge', '{}'::jsonb, v, gen_random_uuid());
  end loop;
  perform public.work_task_set_origin_v1((select id from wt_tasks where name = 'self'), 'oral_claim', null, pg_temp.p('head'));
  perform pg_temp.as_('head');
  perform public.work_task_set_origin_v1((select id from wt_tasks where name = 'ack'), 'directive',
    (public.work_meeting_create_v1('Giao ban tuần 43', current_date - 1)->>'meetingId')::uuid, pg_temp.p('bld'));
end $$;

-- Tuần trước: một việc xong đúng hạn, một việc trễ; một lần nộp được duyệt ngay lần đầu.
set local session_replication_role = 'replica';
update public.work_tasks set deadline_at = (date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh') - interval '3 days') at time zone 'Asia/Ho_Chi_Minh',
  status = 'completed', completed_at = (date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh') - interval '4 days') at time zone 'Asia/Ho_Chi_Minh'
  where id = (select id from wt_tasks where name = 'lastweek');
update public.work_tasks set deadline_at = (date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh') - interval '3 days') at time zone 'Asia/Ho_Chi_Minh'
  where id = (select id from wt_tasks where name = 'lastlate');
insert into public.work_task_submissions(task_id, iteration, submitted_by, status, reviewed_by, reviewed_at)
  select id, 1, pg_temp.p('staff'), 'approved', pg_temp.p('head'), now() - interval '3 days' from wt_tasks where name = 'lastweek';
set local session_replication_role = 'origin';

do $$ declare r jsonb; t jsonb; e text;
  find constant text := 'select x from jsonb_array_elements($1) x where x->>''title'' = $2';
begin
  perform pg_temp.as_('staff');
  r := public.work_my_board_v1();
  perform pg_temp.ok(r->'me'->>'name' = 'Work dot1 staff' and r->'me'->'unit'->>'code' = 'WD1-U1', 'thông tin của tôi: '||(r->'me')::text);
  perform pg_temp.ok((r->>'weekEnd')::date - (r->>'weekStart')::date = 6 and extract(isodow from (r->>'weekStart')::date) = 1, 'tuần bắt đầu thứ 2');
  perform pg_temp.ok(jsonb_array_length(r->'tasks') = 6, 'việc giao cho tôi: 5 việc đang làm + 1 việc xong tuần trước (cho Lịch): '||jsonb_array_length(r->'tasks'));
  perform pg_temp.ok((r->>'doneSince')::date = (r->>'weekStart')::date - 35, 'mốc Lịch lùi 5 tuần');
  perform pg_temp.ok(not (r->'tasks')::text like '%việc của người khác%', 'không lẫn việc người khác');

  execute find into t using r->'tasks', 'Board: đã nhận, chưa bắt đầu';
  perform pg_temp.ok(t->>'level' = 'A' and (t->'can'->>'start')::boolean and not (t->'can'->>'acknowledge')::boolean and (t->>'createdByHead')::boolean
    and t->'origin'->>'origin' = 'directive' and t->'origin'->'meeting'->>'title' = 'Giao ban tuần 43' and t->'origin'->'giver'->>'name' = 'Work dot1 bld'
    and (t->'checklist'->>'total')::int = 2, 'việc chỉ đạo đã nhận: '||t::text);
  execute find into t using r->'tasks', 'Board: chưa nhận việc';
  perform pg_temp.ok((t->'can'->>'acknowledge')::boolean and not (t->'can'->>'start')::boolean and not (t->>'acknowledged')::boolean, 'chưa nhận việc: '||t::text);
  execute find into t using r->'tasks', 'Board: người đơn vị khác giao';
  perform pg_temp.ok(not (t->>'createdByHead')::boolean and t->'createdBy'->>'name' = 'Work dot1 bld', 'người khác giao (không phải trưởng): '||t::text);
  execute find into t using r->'tasks', 'Board: tự ghi việc giao miệng';
  perform pg_temp.ok((t->>'createdByMe')::boolean and t->'origin'->>'claimStatus' = 'pending' and t->'origin'->'giver'->>'name' = 'Work dot1 head', 'việc giao miệng chờ xác nhận: '||t::text);

  perform pg_temp.ok((r->'weeks'->0->>'due')::int = 2 and (r->'weeks'->0->>'ontime')::int = 1, 'tuần trước 1/2 đúng hạn: '||(r->'weeks')::text);
  perform pg_temp.ok(jsonb_array_length(r->'weeks') = 4, '4 tuần');
  perform pg_temp.ok((r->'review'->>'reviewed')::int = 1 and (r->'review'->>'firstPass')::int = 1, 'duyệt lần đầu 1/1: '||(r->'review')::text);
  perform pg_temp.ok((r->>'load')::int = 3 + 2 + 1 + 2 + 1, 'tải việc A3 + B2 + C1 + B2 (tự ghi) + C1 (trễ): '||(r->>'load'));

  -- Xong trong tuần này thì vẫn hiện (nhóm "Đã xong tuần này").
  set local session_replication_role = 'replica';
  update public.work_tasks set status = 'completed', completed_at = now() where id = (select id from wt_tasks where name = 'other');
  set local session_replication_role = 'origin';
  r := public.work_my_board_v1();
  execute find into t using r->'tasks', 'Board: người đơn vị khác giao';
  perform pg_temp.ok(t->>'status' = 'completed' and not (t->'can'->>'submit')::boolean, 'việc xong tuần này còn trong bảng, không còn nút: '||coalesce(t::text, 'null'));

  perform pg_temp.as_('noaccess');
  e := pg_temp.err($q$select public.work_my_board_v1()$q$);
  perform pg_temp.ok(e = 'WORK_TASK_NOT_FOUND', 'người ngoài Vioo Work bị chặn: '||coalesce(e, 'null'));
  perform pg_temp.ok(not has_function_privilege('anon', 'public.work_my_board_v1(date, date, date, date, date)', 'execute'), 'anon không gọi được');
end $$;
