-- Vioo Work Đợt 1 PR-1: nền giao việc + hạ tầng AI. Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261021210000_work_dot1_foundation.sql \
--   --smoke supabase/tests/work_dot1_foundation_smoke.sql
-- Vai: head (trưởng đơn vị U1) · staff (nhân viên U1) · outsider (nhân viên U2) · bld (xem toàn công ty) · noaccess (không có Vioo Work).
-- Việc tạo bằng đúng lệnh thật (xem trước người nhận → create_work_task) để kiểm cả luồng quyền hiện có.
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
  ('by_head', pg_temp.create_task('head', 'Dot1: trưởng giao nhân viên', 'staff', 'urgent', 'standard')),
  ('by_bld', pg_temp.create_task('bld', 'Dot1: BLĐ giao nhân viên', 'staff', 'important', 'standard')),
  ('by_bld_restricted', pg_temp.create_task('bld', 'Dot1: BLĐ giao hạn chế', 'staff', 'normal', 'restricted')),
  ('self_claim', pg_temp.create_task('staff', 'Dot1: tự ghi việc giao miệng', 'staff', 'urgent', 'standard')),
  ('outsider_task', pg_temp.create_task('outsider', 'Dot1: việc của U2', 'outsider', 'normal', 'standard'));

-- Nhân viên tự giao cho mình được, giao cho người khác vẫn bị chặn.
do $$ declare e text; begin
  perform pg_temp.as_('staff');
  e := pg_temp.err(format('select public.preview_work_task_recipients(%L::jsonb, %L::jsonb)',
    jsonb_build_array(jsonb_build_object('type','user','id',pg_temp.p('outsider'))), '{"type":"direct"}'));
  perform pg_temp.ok(e like '%WORK_ASSIGN_USER_DENIED%', 'nhân viên không giao cho người khác: '||coalesce(e,'chạy được'));
  perform pg_temp.ok((select app_private.work_task_user_can_view(id, pg_temp.p('staff')) from wt_tasks where name = 'self_claim'), 'nhân viên tự tạo việc cho mình');
end $$;

-- ── 1. Quyền xem: trưởng đơn vị thấy việc của người trong đơn vị (trừ hạn chế) ─────────────────────
do $$ declare t uuid := (select id from wt_tasks where name = 'by_bld'); r uuid := (select id from wt_tasks where name = 'by_bld_restricted');
  o uuid := (select id from wt_tasks where name = 'outsider_task'); begin
  perform pg_temp.ok(app_private.work_task_user_can_view(t, pg_temp.p('head')), 'trưởng U1 xem việc BLĐ giao cho staff');
  perform pg_temp.ok(app_private.work_task_user_can_view(t, pg_temp.p('staff')), 'staff xem việc của mình');
  perform pg_temp.ok(not app_private.work_task_user_can_view(t, pg_temp.p('outsider')), 'outsider không xem việc U1');
  perform pg_temp.ok(not app_private.work_task_user_can_view(t, pg_temp.p('noaccess')), 'không có Vioo Work thì không xem');
  perform pg_temp.ok(not app_private.work_task_user_can_view(r, pg_temp.p('head')), 'trưởng không xem việc hạn chế');
  perform pg_temp.ok(app_private.work_task_user_can_view(r, pg_temp.p('bld')), 'người tạo xem việc hạn chế');
  perform pg_temp.ok(not app_private.work_task_user_can_view(o, pg_temp.p('head')), 'trưởng U1 không xem việc U2');
  perform pg_temp.ok(app_private.work_task_user_can_view(o, pg_temp.p('bld')), 'BLĐ (view_scope global) xem việc U2');
end $$;

-- ── 2. progress_report ──────────────────────────────────────────────────────────────────────────────
do $$ declare t uuid := (select id from wt_tasks where name = 'by_head'); v bigint; k uuid := gen_random_uuid(); r1 jsonb; r2 jsonb; e text; begin
  perform pg_temp.as_('staff');
  select lock_version into v from public.work_tasks where id = t;
  perform public.command_work_task(t, 'acknowledge', '{}'::jsonb, v, gen_random_uuid());
  e := pg_temp.err(format('select public.command_work_task_collaboration(%L, %L, %L::jsonb, %L)', t, 'progress_report', '{"progressPercent":30}', gen_random_uuid()));
  perform pg_temp.ok(e like '%WORK_PROGRESS_REPORT_EMPTY%', 'báo cáo rỗng bị chặn: '||coalesce(e,'chạy được'));
  e := pg_temp.err(format('select public.command_work_task_collaboration(%L, %L, %L::jsonb, %L)', t, 'progress_report', '{"done":"x","progressPercent":101}', gen_random_uuid()));
  perform pg_temp.ok(e like '%WORK_INVALID_PROGRESS%', '% > 100 bị chặn: '||coalesce(e,'chạy được'));
  e := pg_temp.err(format('select public.command_work_task_collaboration(%L, %L, %L::jsonb, %L)', t, 'progress_report', '{"done":"x","progressPercent":10,"extra":1}', gen_random_uuid()));
  perform pg_temp.ok(e like '%WORK_INVALID_COMMAND%', 'khóa lạ bị chặn: '||coalesce(e,'chạy được'));
  e := pg_temp.err(format('select public.command_work_task_collaboration(%L, %L, %L::jsonb, %L)', t, 'progress_report',
    jsonb_build_object('done','x','progressPercent',10,'aiRunId',gen_random_uuid()), gen_random_uuid()));
  perform pg_temp.ok(e like '%WORK_AI_RUN_INVALID%', 'lượt AI không phải của mình bị chặn: '||coalesce(e,'chạy được'));
  r1 := public.command_work_task_collaboration(t, 'progress_report',
    '{"done":"Bóc xong cọc","doing":"Đài móng","next":"Giằng móng","blocked":"Thiếu bản vẽ","progressPercent":60}'::jsonb, k);
  perform pg_temp.ok((r1->>'progressPercent')::int = 60 and (r1->>'suggestBlock')::boolean, 'cập nhật 60% + gợi ý báo vướng: '||r1::text);
  perform pg_temp.ok(r1->>'status' = 'in_progress' and exists (select 1 from public.work_task_events where task_id = t and event_type = 'task.started'), 'việc chưa bắt đầu tự chuyển Đang làm');
  r2 := public.command_work_task_collaboration(t, 'progress_report',
    '{"done":"Bóc xong cọc","doing":"Đài móng","next":"Giằng móng","blocked":"Thiếu bản vẽ","progressPercent":60}'::jsonb, k);
  perform pg_temp.ok(r1 = r2, 'gửi lại cùng khóa trả cùng kết quả');
  perform pg_temp.ok((select count(*) from public.work_task_updates where task_id = t) = 1, 'chỉ một dòng cập nhật');
  perform pg_temp.ok((select progress_percent from public.work_tasks where id = t) = 60, 'tiến độ việc = 60');
  perform pg_temp.ok(exists (select 1 from public.work_task_events where task_id = t and event_type = 'task.progress_reported'), 'có sự kiện progress_reported');
  perform pg_temp.ok(exists (select 1 from app_private.work_notification_outbox where task_id = t and event_type = 'task.progress_reported'), 'có hàng chờ thông báo');
  perform pg_temp.ok(app_private.work_task_last_progress_at(t) >= now() - interval '1 minute', 'lần chuyển động gần nhất = vừa xong');
  -- Chỉ cập nhật chữ, không đổi %: không cần đúng phiên bản.
  r2 := public.command_work_task_collaboration(t, 'progress_report', '{"doing":"Giằng móng trục 1-5","progressPercent":60,"expectedLockVersion":1}'::jsonb, gen_random_uuid());
  perform pg_temp.ok((select count(*) from public.work_task_updates where task_id = t) = 2, 'cập nhật chữ không cần đúng phiên bản');
  e := pg_temp.err(format('select public.command_work_task_collaboration(%L, %L, %L::jsonb, %L)', t, 'progress_report', '{"done":"x","progressPercent":70,"expectedLockVersion":1}', gen_random_uuid()));
  perform pg_temp.ok(e like '%WORK_VERSION_CONFLICT%', 'đổi % với phiên bản cũ bị chặn: '||coalesce(e,'chạy được'));
  perform pg_temp.as_('head');
  e := pg_temp.err(format('select public.command_work_task_collaboration(%L, %L, %L::jsonb, %L)', t, 'progress_report', '{"done":"x","progressPercent":70}', gen_random_uuid()));
  perform pg_temp.ok(e like '%WORK_COMMAND_DENIED%', 'trưởng (không phải người làm) không cập nhật thay: '||coalesce(e,'chạy được'));
  perform pg_temp.as_('outsider');
  e := pg_temp.err(format('select public.command_work_task_collaboration(%L, %L, %L::jsonb, %L)', t, 'progress_report', '{"done":"x","progressPercent":70}', gen_random_uuid()));
  perform pg_temp.ok(e like '%WORK_TASK_NOT_FOUND%', 'người ngoài không thấy việc: '||coalesce(e,'chạy được'));
end $$;

-- ── 3. Tóm tắt một việc ─────────────────────────────────────────────────────────────────────────────
do $$ declare t uuid := (select id from wt_tasks where name = 'by_head'); b jsonb; e text; begin
  perform pg_temp.as_('head');
  b := public.work_task_brief_v1(t);
  perform pg_temp.ok(b->'task'->>'level' = 'A' and (b->'task'->>'progressPercent')::int = 60, 'mức A, 60%: '||(b->'task')::text);
  perform pg_temp.ok(jsonb_array_length(b->'updates') = 2 and exists (select 1 from jsonb_array_elements(b->'updates') u where u->>'doing' = 'Giằng móng trục 1-5'), 'có 2 cập nhật');
  perform pg_temp.ok((b->'checklist'->>'total')::int = 2 and jsonb_array_length(b->'assignees') = 1, 'checklist 2 mục, 1 người làm');
  perform pg_temp.as_('outsider');
  e := pg_temp.err(format('select public.work_task_brief_v1(%L)', t));
  perform pg_temp.ok(e like '%WORK_TASK_NOT_FOUND%', 'người ngoài không đọc tóm tắt: '||coalesce(e,'chạy được'));
end $$;

-- ── 4. Phòng tôi ─────────────────────────────────────────────────────────────────────────────────────
do $$ declare b jsonb; s jsonb; e text; begin
  perform pg_temp.as_('head');
  b := public.work_team_board_v1();
  perform pg_temp.ok(b->'unit'->>'code' = 'WD1-U1', 'mặc định đơn vị mình làm trưởng');
  select m into s from jsonb_array_elements(b->'members') m where m->>'userId' = pg_temp.p('staff')::text;
  perform pg_temp.ok(s is not null and (s->>'active')::int = 4 and (s->'levels'->>'A')::int = 2, 'staff: 4 việc đang làm, 2 việc A: '||coalesce(s::text,'không có'));
  perform pg_temp.ok((s->>'load')::int = 3*2 + 2 + 1, 'tải = A×3 + B×2 + C');
  perform pg_temp.ok((select (m->>'isHead')::boolean from jsonb_array_elements(b->'members') m where m->>'userId' = pg_temp.p('head')::text), 'đánh dấu trưởng');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(b->'members') m where m->>'userId' = pg_temp.p('outsider')::text), 'không có người U2');
  perform pg_temp.as_('outsider');
  e := pg_temp.err('select public.work_team_board_v1()');
  perform pg_temp.ok(e like '%WORK_BOARD_DENIED%', 'không làm trưởng thì không mở Phòng tôi: '||coalesce(e,'chạy được'));
  e := pg_temp.err(format('select public.work_team_board_v1(%L)', (select u1 from wt_refs)));
  perform pg_temp.ok(e like '%WORK_BOARD_DENIED%', 'không mở được phòng người khác: '||coalesce(e,'chạy được'));
  perform pg_temp.as_('bld');
  b := public.work_team_board_v1((select u1 from wt_refs));
  perform pg_temp.ok(b->'unit'->>'code' = 'WD1-U1' and (b->>'canViewAll')::boolean, 'BLĐ mở được phòng bất kỳ');
end $$;

-- ── 5. Việc giao miệng + Sổ chỉ đạo ─────────────────────────────────────────────────────────────────
do $$ declare t uuid := (select id from wt_tasks where name = 'self_claim'); d uuid := (select id from wt_tasks where name = 'by_bld');
  r jsonb; m jsonb; c jsonb; e text; begin
  perform pg_temp.as_('head');
  e := pg_temp.err(format('select public.work_task_set_origin_v1(%L, %L, null, %L)', t, 'oral_claim', pg_temp.p('bld')));
  perform pg_temp.ok(e like '%WORK_TASK_NOT_FOUND%', 'chỉ người tạo được ghi nguồn: '||coalesce(e,'chạy được'));
  perform pg_temp.as_('staff');
  e := pg_temp.err(format('select public.work_task_set_origin_v1(%L, %L, null, %L)', t, 'oral_claim', pg_temp.p('noaccess')));
  perform pg_temp.ok(e like '%WORK_GIVER_INELIGIBLE%', 'người giao phải dùng Vioo Work: '||coalesce(e,'chạy được'));
  r := public.work_task_set_origin_v1(t, 'oral_claim', null, pg_temp.p('bld'));
  perform pg_temp.ok(r->>'claimStatus' = 'pending', 'chờ xác nhận');
  perform pg_temp.ok(app_private.work_task_user_can_view(t, pg_temp.p('bld')), 'người giao được nêu thấy việc');
  perform pg_temp.ok(exists (select 1 from public.work_task_participants where task_id = t and user_id = pg_temp.p('bld') and ended_at is null), 'người giao thành người theo dõi');
  e := pg_temp.err(format('select public.work_task_set_origin_v1(%L, %L, null, %L)', t, 'oral_claim', pg_temp.p('bld')));
  perform pg_temp.ok(e like '%WORK_ORIGIN_ALREADY_SET%', 'không ghi nguồn hai lần: '||coalesce(e,'chạy được'));
  perform pg_temp.as_('bld');
  c := public.work_company_board_v1();
  perform pg_temp.ok((c->>'claimsWaitingMe')::int >= 1, 'BLĐ thấy việc chờ mình xác nhận');
  perform pg_temp.ok((select (u->>'claimsPending')::int from jsonb_array_elements(c->'units') u where u->>'code' = 'WD1-U1') = 1, 'U1 có 1 việc chờ xác nhận');
  e := pg_temp.err(format('select public.work_task_claim_decide_v1(%L, %L, null)', t, 'reject'));
  perform pg_temp.ok(e like '%WORK_INVALID_COMMAND%', 'từ chối phải có lý do: '||coalesce(e,'chạy được'));
  r := public.work_task_claim_decide_v1(t, 'confirm', null);
  perform pg_temp.ok(r->>'claimStatus' = 'confirmed', 'BLĐ xác nhận');
  perform pg_temp.ok(exists (select 1 from public.work_task_events where task_id = t and event_type = 'task.claim_confirmed'), 'có sự kiện xác nhận');
  e := pg_temp.err(format('select public.work_task_claim_decide_v1(%L, %L, null)', t, 'confirm'));
  perform pg_temp.ok(e like '%WORK_CLAIM_ALREADY_DECIDED%', 'không xác nhận hai lần: '||coalesce(e,'chạy được'));
  m := public.work_meeting_create_v1('Giao ban tuần 43', current_date, null);
  r := public.work_task_set_origin_v1(d, 'directive', (m->>'meetingId')::uuid, null);
  perform pg_temp.ok(r->>'claimStatus' = 'not_needed', 'chỉ đạo từ họp không cần xác nhận');
  c := public.work_company_board_v1();
  perform pg_temp.ok((select (u->'directives'->>'open')::int from jsonb_array_elements(c->'units') u where u->>'code' = 'WD1-U1') = 2,
    'U1: 2 chỉ đạo đang mở (1 từ họp + 1 giao miệng đã xác nhận)');
  perform pg_temp.as_('head');
  e := pg_temp.err('select public.work_company_board_v1()');
  perform pg_temp.ok(e like '%WORK_BOARD_DENIED%', 'trưởng phòng không mở Toàn công ty: '||coalesce(e,'chạy được'));
  perform pg_temp.as_('noaccess');
  e := pg_temp.err(format('select public.work_meeting_create_v1(%L, %L, null)', 'Họp thử', current_date));
  perform pg_temp.ok(e like '%WORK_COMMAND_DENIED%', 'không có quyền giao thì không ghi họp: '||coalesce(e,'chạy được'));
end $$;

-- ── 6. Dấu vết AI ────────────────────────────────────────────────────────────────────────────────────
do $$ declare t uuid := (select id from wt_tasks where name = 'by_head'); run_head uuid; run_other uuid; e text; begin
  insert into public.ai_runs(user_id, skill_code, status) values (pg_temp.p('head'), 'work_task_draft', 'ok') returning id into run_head;
  insert into public.ai_runs(user_id, skill_code, status) values (pg_temp.p('staff'), 'work_task_draft', 'ok') returning id into run_other;
  perform pg_temp.as_('head');
  perform public.work_ai_link_v1(t, run_head, 'task_draft');
  perform public.work_ai_link_v1(t, run_head, 'task_draft');
  perform pg_temp.ok((select count(*) from public.work_task_ai_links where task_id = t and ai_run_id = run_head) = 1, 'một liên kết dù gọi hai lần');
  perform pg_temp.ok((select accepted from public.ai_runs where id = run_head), 'lượt AI được đánh dấu đã dùng');
  e := pg_temp.err(format('select public.work_ai_link_v1(%L, %L, %L)', t, run_other, 'task_draft'));
  perform pg_temp.ok(e like '%WORK_AI_RUN_INVALID%', 'không gắn lượt AI của người khác: '||coalesce(e,'chạy được'));
  e := pg_temp.err(format('select public.work_ai_link_v1(%L, %L, %L)', t, run_head, 'lung_tung'));
  perform pg_temp.ok(e like '%WORK_AI_RUN_INVALID%', 'loại liên kết lạ bị chặn: '||coalesce(e,'chạy được'));
end $$;

-- ── 7. Người giao được + biệt danh ───────────────────────────────────────────────────────────────────
do $$ declare b jsonb; s jsonb; begin
  insert into public.ai_memory_aliases(scope_type, scope_id, kind, alias_norm, alias_text, target_id, target_label, hits, last_used_at)
    values ('company', '*', 'person', 'em nhan vien dot1', 'em nhân viên dot1', pg_temp.p('staff')::text, 'Work dot1 staff', 3, now());
  perform pg_temp.as_('head');
  b := public.work_assignable_people_v1(null, 200);
  perform pg_temp.ok((b->>'canAssignOthers')::boolean, 'trưởng giao được cho người khác');
  select x into s from jsonb_array_elements(b->'people') x where x->>'userId' = pg_temp.p('staff')::text;
  perform pg_temp.ok(s is not null and (s->>'myTeam')::boolean and (s->>'canReceive')::boolean and (s->>'load')::int = 3*2 + 2 + 1, 'staff thuộc phòng tôi, nhận được việc, tải 9: '||coalesce(s::text,'không có'));
  perform pg_temp.ok(s->'aliases' ? 'em nhân viên dot1', 'có biệt danh đã học');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(b->'people') x where x->>'userId' = pg_temp.p('noaccess')::text), 'không liệt kê người không dùng Vioo Work');
  b := public.work_assignable_people_v1('nhan vien dot1', 20);
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(b->'people') x where x->>'userId' = pg_temp.p('staff')::text), 'tìm theo biệt danh không dấu');
  perform pg_temp.as_('staff');
  b := public.work_assignable_people_v1(null, 200);
  perform pg_temp.ok(not (b->>'canAssignOthers')::boolean, 'nhân viên chưa có quyền giao cho người khác');
end $$;

-- ── 8. Quyền thực thi + skill ────────────────────────────────────────────────────────────────────────
do $$ declare f text; begin
  foreach f in array array['public.work_meeting_create_v1(text,date,uuid)', 'public.work_task_set_origin_v1(uuid,text,uuid,uuid)',
    'public.work_task_claim_decide_v1(uuid,text,text)', 'public.work_ai_link_v1(uuid,uuid,text)', 'public.work_task_brief_v1(uuid)',
    'public.work_team_board_v1(uuid,date,date,date,date,date)', 'public.work_company_board_v1(date,date,date,date,date)', 'public.work_assignable_people_v1(text,integer)',
    'public.command_work_task_collaboration(uuid,text,jsonb,uuid)'] loop
    perform pg_temp.ok(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'), 'quyền thực thi '||f);
  end loop;
  perform pg_temp.ok(not has_function_privilege('authenticated', 'app_private.work_headed_units(uuid)', 'execute'), 'hàm nội bộ không mở cho người dùng');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.work_task_updates', 'select'), 'bảng cập nhật chỉ đọc qua RPC');
  perform pg_temp.ok((select count(*) from public.ai_skills where code like 'work\_%' and not enabled) = 5, '5 skill Vioo Work, đang tắt');
end $$;

select 'work dot1 foundation smoke passed' as result;
