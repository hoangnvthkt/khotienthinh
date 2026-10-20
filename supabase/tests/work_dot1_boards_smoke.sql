-- Vioo Work Đợt 1 PR-4: Phòng tôi / Toàn công ty / Sổ chỉ đạo. Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261022200000_work_dot1_boards.sql \
--   --smoke supabase/tests/work_dot1_boards_smoke.sql
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
  ('rev', pg_temp.create_task('head', 'PR4: việc nộp chờ duyệt', 'staff', 'important', 'standard')),
  ('dir', pg_temp.create_task('head', 'PR4: việc chỉ đạo', 'staff', 'urgent', 'standard')),
  ('claim', pg_temp.create_task('staff', 'PR4: việc giao miệng', 'staff', 'important', 'standard')),
  ('unack', pg_temp.create_task('head', 'PR4: chưa nhận việc', 'staff', 'normal', 'standard'));

do $$ declare t uuid := (select id from wt_tasks where name = 'rev'); v bigint; begin
  perform pg_temp.as_('staff');
  select lock_version into v from public.work_tasks where id = t;
  perform public.command_work_task(t, 'acknowledge', '{}'::jsonb, v, gen_random_uuid());
  select lock_version into v from public.work_tasks where id = t;
  perform public.command_work_task(t, 'start', '{}'::jsonb, v, gen_random_uuid());
  select lock_version into v from public.work_tasks where id = t;
  perform public.command_work_task(t, 'submit', '{"result":{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Đã xong bảng khối lượng"}]}]}}'::jsonb, v, gen_random_uuid());
  perform public.work_task_set_origin_v1((select id from wt_tasks where name = 'claim'), 'oral_claim', null, pg_temp.p('bld'));
  perform pg_temp.as_('head');
  perform public.work_task_set_origin_v1((select id from wt_tasks where name = 'dir'), 'directive',
    (public.work_meeting_create_v1('Giao ban tuần 43', current_date - 1)->>'meetingId')::uuid, pg_temp.p('bld'));
end $$;

-- ── 1. Tab được thấy ─────────────────────────────────────────────────────────────────────────────────────
do $$ declare r jsonb; begin
  perform pg_temp.as_('head'); r := public.work_board_access_v1();
  perform pg_temp.ok(r->'myUnits'->0->>'code' = 'WD1-U1' and not (r->>'company')::boolean and (r->>'reviewsWaitingMe')::int = 1, 'trưởng: Phòng tôi U1, 1 việc chờ duyệt: '||r::text);
  perform pg_temp.as_('bld'); r := public.work_board_access_v1();
  perform pg_temp.ok((r->>'company')::boolean and (r->>'claimsWaitingMe')::int = 1, 'BLĐ: Toàn công ty + 1 việc giao miệng chờ xác nhận: '||r::text);
  perform pg_temp.as_('staff'); r := public.work_board_access_v1();
  perform pg_temp.ok(jsonb_array_length(r->'myUnits') = 0 and not (r->>'company')::boolean, 'nhân viên chỉ có Việc của tôi: '||r::text);
end $$;

-- ── 2. Chờ tôi duyệt ─────────────────────────────────────────────────────────────────────────────────────
do $$ declare r jsonb; begin
  perform pg_temp.as_('head'); r := public.work_review_queue_v1();
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r->0->>'title' = 'PR4: việc nộp chờ duyệt' and (r->0->>'iteration')::int = 1
    and r->0->>'result' like 'Đã xong bảng khối lượng%' and r->0->'assignees'->>0 = 'Work dot1 staff', 'hàng chờ duyệt của trưởng: '||r::text);
  perform pg_temp.as_('bld'); r := public.work_review_queue_v1();
  perform pg_temp.ok(jsonb_array_length(r) = 0, 'BLĐ không phải người duyệt việc này');
end $$;

-- ── 3. Sổ chỉ đạo theo vai ──────────────────────────────────────────────────────────────────────────────
set local session_replication_role = 'replica';
update public.work_tasks set deadline_at = now() - interval '1 day' where id = (select id from wt_tasks where name = 'dir');
set local session_replication_role = 'origin';
do $$ declare r jsonb; e text; begin
  perform pg_temp.as_('bld'); r := public.work_directives_v1();
  perform pg_temp.ok(jsonb_array_length(r) = 2, 'BLĐ thấy 2 việc trong sổ: '||r::text);
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r) x where x->>'title' = 'PR4: việc chỉ đạo' and x->>'bucket' = 'late'
    and x->'meeting'->>'title' = 'Giao ban tuần 43' and x->'assignees'->0->>'unit' = 'WD1-U1'), 'việc chỉ đạo quá hạn → Trễ');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r) x where x->>'title' = 'PR4: việc giao miệng' and x->>'bucket' = 'confirm' and (x->>'canDecide')::boolean),
    'việc giao miệng → Chờ xác nhận, BLĐ được nêu tên thì quyết được');
  perform pg_temp.as_('head'); r := public.work_directives_v1((select u1 from wt_refs));
  perform pg_temp.ok(jsonb_array_length(r) = 2 and not exists (select 1 from jsonb_array_elements(r) x where (x->>'canDecide')::boolean), 'trưởng thấy sổ của đơn vị, không quyết thay: '||r::text);
  perform pg_temp.as_('outsider');
  e := pg_temp.err(format('select public.work_directives_v1(%L::uuid)', (select u1 from wt_refs)));
  perform pg_temp.ok(e = 'WORK_BOARD_DENIED', 'người đơn vị khác không xem sổ U1: '||coalesce(e, 'null'));
  perform pg_temp.ok(jsonb_array_length(public.work_directives_v1()) = 0, 'người ngoài không thấy việc nào');
end $$;

-- ── 4. Xác nhận việc giao miệng + sửa hạn một chạm ─────────────────────────────────────────────────────
do $$ declare t uuid := (select id from wt_tasks where name = 'claim'); r jsonb; e text; d timestamptz := date_trunc('day', now()) + interval '5 days 10 hours'; begin
  perform pg_temp.as_('head');
  e := pg_temp.err(format('select public.work_task_claim_decide_v2(%L::uuid, ''confirm'', null, %L::timestamptz)', t, d));
  perform pg_temp.ok(e is not null, 'người không được nêu tên không xác nhận được');
  perform pg_temp.as_('bld');
  e := pg_temp.err(format('select public.work_task_claim_decide_v2(%L::uuid, ''confirm'', null, %L::timestamptz)', t, now() - interval '1 hour'));
  perform pg_temp.ok(e = 'WORK_DEADLINE_EXPIRED', 'hạn đã qua bị chặn: '||coalesce(e, 'null'));
  r := public.work_task_claim_decide_v2(t, 'confirm', null, d);
  perform pg_temp.ok(r->>'claimStatus' = 'confirmed' and (select deadline_at from public.work_tasks where id = t) = d, 'xác nhận + đổi hạn: '||r::text);
  perform pg_temp.ok(exists (select 1 from public.work_task_events where task_id = t and event_type = 'task.schedule_updated' and payload->>'reason' = 'claim_confirm'), 'ghi sự kiện đổi hạn');
end $$;

-- ── 5. Lọc chưa nhận việc + quyền gọi ───────────────────────────────────────────────────────────────────
do $$ declare r jsonb; begin
  perform pg_temp.as_('head'); r := public.work_tasks_overview_v1(null, 'WD1-U1', 'unack', null, 30);
  perform pg_temp.ok((r->>'total')::int = 2 and (r->'items')::text like '%PR4: chưa nhận việc%', 'chưa nhận việc trong U1: '||r::text);
  perform pg_temp.ok(not has_function_privilege('anon', 'public.work_directives_v1(uuid)', 'execute'), 'anon không đọc sổ');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.work_task_claim_decide_v2(uuid, text, text, timestamptz)', 'execute'), 'anon không xác nhận');
end $$;
