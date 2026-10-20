-- Vioo Work Đợt 1 PR-2: thông báo + nhắc lâu chưa cập nhật + dữ liệu giao nhanh / chi tiết. Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261022090000_work_dot1_notify_quick.sql \
--   --smoke supabase/tests/work_dot1_notify_quick_smoke.sql
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
  ('reported', pg_temp.create_task('head', 'PR2: việc có cập nhật', 'staff', 'urgent', 'standard')),
  ('stale_old', pg_temp.create_task('head', 'PR2: A lâu chưa cập nhật 4 ngày', 'staff', 'urgent', 'standard')),
  ('stale_mid', pg_temp.create_task('head', 'PR2: B lâu chưa cập nhật 2,5 ngày', 'staff', 'important', 'standard')),
  ('stale_c', pg_temp.create_task('head', 'PR2: C lâu không nhắc', 'staff', 'normal', 'standard')),
  ('claim', pg_temp.create_task('staff', 'PR2: tự ghi việc giao miệng', 'staff', 'important', 'standard'));

-- Nhân viên nhận các việc A/B/C để có trạng thái "chưa bắt đầu" (đối tượng nhắc).
do $$ declare n text; t uuid; v bigint; begin
  perform pg_temp.as_('staff');
  foreach n in array array['reported','stale_old','stale_mid','stale_c'] loop
    t := (select id from wt_tasks where name = n);
    select lock_version into v from public.work_tasks where id = t;
    perform public.command_work_task(t, 'acknowledge', '{}'::jsonb, v, gen_random_uuid());
  end loop;
end $$;

-- ── 1. Trưởng đơn vị gần nhất + câu thông báo cập nhật tiến độ ──────────────────────────────────────────
do $$ declare t uuid := (select id from wt_tasks where name = 'reported'); ev uuid; c jsonb; begin
  perform pg_temp.ok((select array_agg(h) from app_private.work_heads_of_user(pg_temp.p('staff')) h) = array[pg_temp.p('head')], 'trưởng gần nhất của staff là head');
  perform pg_temp.ok(not exists (select 1 from app_private.work_heads_of_user(pg_temp.p('head')) h), 'head không tự là trưởng của mình');
  perform pg_temp.as_('staff');
  perform public.command_work_task_collaboration(t, 'progress_report', '{"done":"Bóc xong cọc","blocked":"Thiếu bản vẽ","progressPercent":60}'::jsonb, gen_random_uuid());
  select id into ev from public.work_task_events where task_id = t and event_type = 'task.progress_reported';
  c := app_private.work_notification_content(ev);
  perform pg_temp.ok(c->>'message' like '%cập nhật 60%' and c->>'message' like '%có vướng%' and c->>'title' like '%Cập nhật tiến độ', 'câu thông báo: '||c::text);
  perform pg_temp.ok(app_private.work_notification_mandatory(ev, pg_temp.p('head')) = false, 'người giao nhận tin cập nhật (thường)');
  perform pg_temp.ok(app_private.work_notification_mandatory(ev, pg_temp.p('staff')) is null, 'người cập nhật không tự nhận tin');
  perform pg_temp.ok(app_private.work_notification_mandatory(ev, pg_temp.p('outsider')) is null, 'người ngoài không nhận');
end $$;

-- ── 2. Nhắc lâu chưa cập nhật: A 4 ngày → báo cả trưởng; B 2,5 ngày → chỉ người làm; C không nhắc ───────
set local session_replication_role = 'replica';
update public.work_tasks set created_at = now() - interval '4 days' where id = (select id from wt_tasks where name = 'stale_old');
update public.work_task_assignments set acknowledged_at = now() - interval '4 days' where task_id = (select id from wt_tasks where name = 'stale_old');
update public.work_task_events set created_at = now() - interval '4 days' where task_id = (select id from wt_tasks where name = 'stale_old');
update public.work_tasks set created_at = now() - interval '60 hours' where id in (select id from wt_tasks where name in ('stale_mid', 'stale_c'));
update public.work_task_assignments set acknowledged_at = now() - interval '60 hours' where task_id in (select id from wt_tasks where name in ('stale_mid', 'stale_c'));
update public.work_task_events set created_at = now() - interval '60 hours' where task_id in (select id from wt_tasks where name in ('stale_mid', 'stale_c'));
set local session_replication_role = 'origin';
update app_private.work_notification_settings set enabled = true where singleton;

do $$ declare o uuid := (select id from wt_tasks where name = 'stale_old'); m uuid := (select id from wt_tasks where name = 'stale_mid');
  c uuid := (select id from wt_tasks where name = 'stale_c'); n integer; eo uuid; em uuid; msg jsonb; begin
  n := app_private.work_enqueue_stale_reminders(500);
  perform pg_temp.ok(n >= 2, 'có tin nhắc mới: '||n);
  select id into eo from public.work_task_events where task_id = o and event_type = 'task.stale_escalated';
  select id into em from public.work_task_events where task_id = m and event_type = 'task.stale_reminder';
  perform pg_temp.ok(eo is not null, 'A quá 3 ngày → báo cả trưởng');
  perform pg_temp.ok(em is not null, 'B quá 2 ngày → nhắc người làm');
  perform pg_temp.ok(not exists (select 1 from public.work_task_events where task_id = c and event_type like 'task.stale%'), 'việc C không nhắc');
  perform pg_temp.ok(exists (select 1 from app_private.work_notification_outbox where event_id = eo), 'tin nhắc vào hàng chờ');
  perform pg_temp.ok(app_private.work_enqueue_stale_reminders(500) = 0 or not exists (select 1 from public.work_task_events where task_id in (o, m) and event_type like 'task.stale%' group by task_id having count(*) > 1), 'mỗi việc tối đa một tin / ngày');
  perform pg_temp.ok(app_private.work_notification_mandatory(eo, pg_temp.p('staff')), 'người làm nhận tin báo trưởng');
  perform pg_temp.ok(app_private.work_notification_mandatory(eo, pg_temp.p('head')), 'trưởng đơn vị nhận khi quá 3 ngày');
  perform pg_temp.ok(app_private.work_notification_mandatory(em, pg_temp.p('staff')), 'người làm nhận nhắc 2 ngày');
  perform pg_temp.ok(app_private.work_notification_mandatory(em, pg_temp.p('head')) is null, 'chưa quá 3 ngày thì không báo trưởng');
  msg := app_private.work_notification_content(eo);
  perform pg_temp.ok(msg->>'message' like 'Lâu chưa cập nhật:%4 ngày%trưởng đơn vị%', 'câu nhắc: '||(msg->>'message'));
  -- Cập nhật xong thì tin nhắc cũ thôi hiệu lực.
  perform pg_temp.as_('staff');
  perform public.command_work_task_collaboration(o, 'progress_report', '{"doing":"Đã làm lại","progressPercent":30}'::jsonb, gen_random_uuid());
  perform pg_temp.ok(app_private.work_notification_mandatory(eo, pg_temp.p('staff')) is null, 'đã cập nhật thì không gửi tin nhắc cũ');
end $$;

-- ── 3. Việc giao miệng: chỉ người được nêu là người giao nhận (bắt buộc) ──────────────────────────────────
do $$ declare t uuid := (select id from wt_tasks where name = 'claim'); ev uuid; c jsonb; begin
  perform pg_temp.as_('staff');
  perform public.work_task_set_origin_v1(t, 'oral_claim', null, pg_temp.p('bld'));
  select id into ev from public.work_task_events where task_id = t and event_type = 'task.claim_recorded';
  perform pg_temp.ok(app_private.work_notification_mandatory(ev, pg_temp.p('bld')), 'BLĐ nhận tin bắt buộc để xác nhận');
  perform pg_temp.ok(app_private.work_notification_mandatory(ev, pg_temp.p('head')) is null, 'trưởng đơn vị không nhận tin xác nhận');
  c := app_private.work_notification_content(ev);
  perform pg_temp.ok(c->>'message' like '%ghi việc bạn giao trực tiếp%' and c->>'title' like '%Chờ bạn xác nhận', 'câu tin giao miệng: '||c::text);
end $$;

-- ── 4. Dữ liệu cho màn hình: dòng cập nhật + lần cập nhật gần nhất trong danh sách ────────────────────────
do $$ declare t uuid := (select id from wt_tasks where name = 'reported'); u jsonb; l jsonb; e text; begin
  perform pg_temp.as_('head');
  u := public.list_work_task_updates_v1(t);
  perform pg_temp.ok(jsonb_array_length(u->'items') = 1 and (u->'items'->0->>'progressAfter')::int = 60 and u->'items'->0->>'blocked' = 'Thiếu bản vẽ', 'dòng cập nhật: '||u::text);
  perform pg_temp.as_('outsider');
  e := pg_temp.err(format('select public.list_work_task_updates_v1(%L)', t));
  perform pg_temp.ok(e like '%WORK_TASK_NOT_FOUND%', 'người ngoài không đọc dòng cập nhật: '||coalesce(e,'chạy được'));
  perform pg_temp.as_('staff');
  l := public.list_work_tasks('assigned_to_me', '{}'::jsonb, null, 50);
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(l->'items') i where i->>'id' = t::text and i->>'last_progress_at' is not null), 'danh sách có last_progress_at');
  perform pg_temp.ok(app_private.work_task_last_progress_for_actor(t) is not null, 'người xem được thấy mốc');
  perform pg_temp.as_('outsider');
  perform pg_temp.ok(app_private.work_task_last_progress_for_actor(t) is null, 'người ngoài không thấy mốc');
end $$;

-- ── 5. Bật thông báo, lịch nhắc, quyền ──────────────────────────────────────────────────────────────────
do $$ begin
  perform pg_temp.ok((select enabled and rollout_started_at >= now() - interval '1 minute' from app_private.work_notification_settings where singleton), 'đã bật, mốc bỏ hàng chờ tồn = lúc áp');
  perform pg_temp.ok(exists (select 1 from cron.job where jobname = 'work-stale-reminders' and schedule = '0 1 * * 1-6' and active), 'lịch nhắc 08:00 thứ 2 – thứ 7');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.list_work_task_updates_v1(uuid,timestamptz,integer)', 'execute')
    and not has_function_privilege('anon', 'public.list_work_task_updates_v1(uuid,timestamptz,integer)', 'execute'), 'quyền dòng cập nhật');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'app_private.work_enqueue_stale_reminders(integer)', 'execute'), 'người dùng không tự gọi nhắc');
end $$;

select 'work dot1 notify quick smoke passed' as result;
