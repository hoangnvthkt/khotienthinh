-- Vioo Work Đợt 1 PR-3: skill AI Vioo Work (quyền module + chung 20 lượt / ngày), thẻ Trợ lý work_task, việc theo người / đơn vị, học cách gọi người.
-- Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261022130000_work_dot1_ai.sql \
--   --smoke supabase/tests/work_dot1_ai_smoke.sql
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
  ('a1', pg_temp.create_task('head', 'PR3: rà soát hồ sơ thanh toán', 'staff', 'urgent', 'standard')),
  ('b1', pg_temp.create_task('head', 'PR3: bóc khối lượng mái', 'staff', 'important', 'standard')),
  ('c1', pg_temp.create_task('head', 'PR3: cập nhật danh bạ', 'staff', 'normal', 'standard')),
  ('secret', pg_temp.create_task('head', 'PR3: việc hạn chế', 'staff', 'important', 'restricted')),
  ('self', pg_temp.create_task('staff', 'PR3: tự ghi việc', 'staff', 'normal', 'standard'));

-- Nhân viên nhận việc A/B/C (trạng thái "chưa bắt đầu").
do $$ declare n text; t uuid; v bigint; begin
  perform pg_temp.as_('staff');
  foreach n in array array['a1','b1','c1'] loop
    t := (select id from wt_tasks where name = n);
    select lock_version into v from public.work_tasks where id = t;
    perform public.command_work_task(t, 'acknowledge', '{}'::jsonb, v, gen_random_uuid());
  end loop;
end $$;

-- ── 1. Skill Vioo Work: bật, gắn quyền module, chung nhóm 20 lượt ─────────────────────────────────────
do $$ begin
  perform pg_temp.ok((select count(*) from public.ai_skills where code like 'work\_%' and enabled and required_permission = 'work.module.access'
    and quota_group = 'work' and daily_limit = 20) = 5, '5 skill Work bật + quyền module + nhóm');
  perform pg_temp.ok((select daily_limit from public.ai_quota_groups where code = 'work') = 20, 'nhóm work 20 lượt');
  perform pg_temp.ok((select count(*) from public.ai_skills where required_permission is not null or quota_group is not null) = 5, 'skill khác không đổi');
end $$;

do $$ declare r jsonb; begin
  perform pg_temp.as_('noaccess');
  r := public.ai_gateway_begin_v1('work_task_draft', '{}'::jsonb);
  perform pg_temp.ok(r->>'code' = 'AI_DENIED' and r->>'reason' = 'module', 'người ngoài Vioo Work bị chặn: '||r::text);
  perform pg_temp.ok(exists (select 1 from public.ai_runs where user_id = pg_temp.p('noaccess') and error = 'AI_MODULE_DENIED'), 'ghi nhật ký chặn');
  perform pg_temp.as_('staff');
  r := public.ai_gateway_begin_v1('work_task_draft', '{"screen":"work"}'::jsonb);
  perform pg_temp.ok(r->>'code' = 'OK' and r ? 'runId', 'người Vioo Work mở được lượt: '||r::text);
end $$;

-- 19 lượt khác trong nhóm (rải 3 skill) → lượt thứ 21 ở skill chưa dùng vẫn hết lượt nhóm; skill ngoài nhóm không ảnh hưởng.
insert into public.ai_runs (user_id, skill_code, status, context, finished_at)
  select pg_temp.p('staff'), case when g <= 10 then 'work_task_brief' when g <= 18 then 'work_update_draft' else 'work_meeting_tasks' end, 'ok', '{}'::jsonb, now()
  from generate_series(1, 19) g;
do $$ declare r jsonb; begin
  perform pg_temp.as_('staff');
  r := public.ai_gateway_begin_v1('work_task_writer', '{}'::jsonb);
  perform pg_temp.ok(r->>'code' = 'AI_QUOTA' and r->>'reason' = 'day' and (r->>'dailyLimit')::int = 20 and (r->>'usedToday')::int = 20, 'hết 20 lượt chung: '||r::text);
  perform pg_temp.ok(exists (select 1 from public.ai_runs where user_id = pg_temp.p('staff') and error = 'AI_GROUP_DAILY_LIMIT'), 'ghi hết lượt nhóm');
  perform pg_temp.as_('head');
  r := public.ai_gateway_begin_v1('work_task_writer', '{}'::jsonb);
  perform pg_temp.ok(r->>'code' = 'OK', 'người khác vẫn còn lượt: '||r::text);
end $$;

-- ── 2. Thẻ Trợ lý loại work_task ────────────────────────────────────────────────────────────────────────
insert into public.ai_runs (user_id, skill_code, status, context) values (pg_temp.p('head'), 'assistant_chat', 'started', '{}'::jsonb);
do $$ declare r jsonb; v_run uuid; begin
  select id into v_run from public.ai_runs where user_id = pg_temp.p('head') and skill_code = 'assistant_chat' and status = 'started' order by created_at desc limit 1;
  perform pg_temp.as_('head');
  r := public.assistant_command_create_v1(v_run, 'work_task', 'Giao việc: thử', jsonb_build_object('title', 'Thử', 'assigneeUserId', pg_temp.p('staff')), '{}'::jsonb);
  perform pg_temp.ok(r->>'kind' = 'work_task' and r->>'status' = 'prepared', 'tạo thẻ work_task: '||r::text);
end $$;

-- ── 3. Việc theo người / đơn vị / trạng thái theo quyền xem ─────────────────────────────────────────────
do $$ declare r jsonb; e text; begin
  perform pg_temp.as_('head');
  r := public.work_tasks_overview_v1(null, 'WD1-U1', 'open', null, 30);
  perform pg_temp.ok(r->'unit'->>'code' = 'WD1-U1' and (r->>'total')::int = 5, 'trưởng thấy 5 việc trong U1 (kể cả việc hạn chế mình giao, việc nhân viên tự ghi): '||r::text);
  perform pg_temp.ok((r->'items'->0->>'level') = 'A' and jsonb_array_length(r->'items'->0->'assignees') = 1, 'việc có mức + người làm');
  r := public.work_tasks_overview_v1(pg_temp.p('staff'), null, 'review', null, 30);
  perform pg_temp.ok((r->>'total')::int = 0, 'chưa có việc chờ duyệt');
  perform pg_temp.as_('bld');
  r := public.work_tasks_overview_v1(pg_temp.p('staff'), null, 'all', null, 30);
  perform pg_temp.ok((r->>'total')::int = 4 and not (r->'items')::text like '%PR3: việc hạn chế%', 'BLĐ thấy 4 việc, không thấy việc hạn chế: '||r::text);
  perform pg_temp.as_('outsider');
  r := public.work_tasks_overview_v1(null, 'WD1-U1', 'open', null, 30);
  perform pg_temp.ok((r->>'total')::int = 0, 'người đơn vị khác không thấy việc U1');
  r := public.work_tasks_overview_v1(null, 'Work dot1', 'open', null, 30);
  perform pg_temp.ok(r->>'code' = 'UNIT_AMBIGUOUS' and jsonb_array_length(r->'units') = 2, 'tên đơn vị trùng → danh sách: '||r::text);
  r := public.work_tasks_overview_v1(null, 'không-có-đơn-vị-này', 'open', null, 30);
  perform pg_temp.ok(r->>'code' = 'UNIT_NOT_FOUND', 'đơn vị không có');
  e := pg_temp.err($q$select public.work_tasks_overview_v1(null, null, 'bừa', null, 30)$q$);
  perform pg_temp.ok(e = 'WORK_INVALID_COMMAND', 'trạng thái lạ bị chặn: '||coalesce(e, 'null'));
  perform pg_temp.as_('noaccess');
  e := pg_temp.err($q$select public.work_tasks_overview_v1(null, null, 'open', null, 30)$q$);
  perform pg_temp.ok(e = 'WORK_TASK_NOT_FOUND', 'người ngoài Vioo Work bị chặn: '||coalesce(e, 'null'));
end $$;

-- Quá hạn + lâu chưa cập nhật + hạn đến ngày: lùi hạn / thời điểm tạo của việc a1.
set local session_replication_role = 'replica';
update public.work_tasks set deadline_at = now() - interval '1 day', created_at = now() - interval '5 days' where id = (select id from wt_tasks where name = 'a1');
update public.work_task_assignments set acknowledged_at = now() - interval '5 days' where task_id = (select id from wt_tasks where name = 'a1');
update public.work_task_events set created_at = now() - interval '5 days' where task_id = (select id from wt_tasks where name = 'a1');
set local session_replication_role = 'origin';
do $$ declare r jsonb; begin
  perform pg_temp.as_('head');
  r := public.work_tasks_overview_v1(pg_temp.p('staff'), null, 'overdue', null, 30);
  perform pg_temp.ok((r->>'total')::int = 1 and (r->'items'->0->>'overdue')::boolean and (r->>'overdue')::int = 1, 'một việc quá hạn: '||r::text);
  r := public.work_tasks_overview_v1(pg_temp.p('staff'), null, 'stale', null, 30);
  perform pg_temp.ok((r->>'total')::int = 1 and r->'items'->0->>'title' = 'PR3: rà soát hồ sơ thanh toán', 'một việc lâu chưa cập nhật: '||r::text);
  r := public.work_tasks_overview_v1(pg_temp.p('staff'), null, 'open', current_date, 30);
  perform pg_temp.ok((r->>'total')::int = 1, 'hạn đến hôm nay chỉ còn việc quá hạn: '||r::text);
end $$;

-- ── 4. Học cách gọi người từ việc đã giao ────────────────────────────────────────────────────────────────
do $$ declare t uuid := (select id from wt_tasks where name = 'b1'); r jsonb; p jsonb; begin
  perform pg_temp.as_('head');
  r := public.work_learn_person_alias_v1(t, 'Staff KH');
  perform pg_temp.ok((r->>'saved')::int = 1, 'người giao học được cách gọi');
  r := public.work_learn_person_alias_v1(t, 'staff kh');
  perform pg_temp.ok((select hits from public.ai_memory_aliases where kind = 'person' and target_id = pg_temp.p('staff')::text and alias_norm = 'staff kh') = 2, 'cùng cách gọi cộng lượt');
  perform pg_temp.ok((public.work_learn_person_alias_v1(t, 'Work dot1 staff')->>'saved')::int = 0, 'họ tên đầy đủ không cần học');
  perform pg_temp.ok((public.work_learn_person_alias_v1(t, 'Staff')->>'saved')::int = 0, 'tên gọi một chữ không học (để máy hỏi lại khi trùng)');
  p := public.work_assignable_people_v1('staff kh', 10);
  perform pg_temp.ok(p->'people'->0->>'userId' = pg_temp.p('staff')::text and (p->'people'->0->'aliases') ? 'staff kh', 'cách gọi đã học dùng được khi giao: '||p::text);
  perform pg_temp.as_('staff');
  perform pg_temp.ok((public.work_learn_person_alias_v1((select id from wt_tasks where name = 'self'), 'Tôi đây')->>'saved')::int = 0, 'tự giao cho mình không học');
  perform pg_temp.ok((public.work_learn_person_alias_v1(t, 'Ai đó')->>'saved')::int = 0, 'người làm không dạy được cách gọi cho việc người khác giao');
end $$;

-- ── 5. Quyền gọi hàm ─────────────────────────────────────────────────────────────────────────────────────
do $$ begin
  perform pg_temp.ok(not has_function_privilege('anon', 'public.work_tasks_overview_v1(uuid, text, text, date, integer, date)', 'execute'), 'anon không gọi được overview');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.work_learn_person_alias_v1(uuid, text)', 'execute'), 'anon không học cách gọi');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.work_tasks_overview_v1(uuid, text, text, date, integer, date)', 'execute'), 'authenticated gọi được');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.ai_quota_groups', 'select'), 'bảng nhóm hạn mức đóng');
end $$;
