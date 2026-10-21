-- Vioo Work Đợt 2 PR-6: lịch chốt + mục tiêu tháng / quý + chốt kỳ. Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261023120000_work_dot2_close_goals.sql \
--   --smoke supabase/tests/work_dot2_close_goals_smoke.sql
-- Vai (tên giả): head = Vương Thành Đô (trưởng U1, U1a là đơn vị con) · staff = Đặng Thu Hà (nhân viên U1) · outsider (U2) · bld (xem toàn công ty) · noaccess.
-- Việc thử chèn thẳng (session_replication_role) với mã VW-2099-…, không đụng sequence mã việc thật.
-- Kỳ thử theo lịch thật: quý trước (đã qua), tháng này (đang chạy), tuần này.
create temporary table wt_people(name text primary key, full_name text, id uuid default gen_random_uuid(),
  email text default ('work-dot2c-'||gen_random_uuid()||'@invalid.local'), employee_id uuid default gen_random_uuid());
insert into wt_people(name, full_name) values ('head', 'Vương Thành Đô'), ('staff', 'Đặng Thu Hà'), ('outsider', 'Lã Minh Khang'),
  ('bld', 'Tạ Hồng Sơn'), ('noaccess', 'Mạc Thị Yến');
insert into public.users(id,name,username,email,role)
  select id,full_name,'work-dot2c-'||id,email,'EMPLOYEE'::public.user_role from wt_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select p.id, g.code, g.scope, '*', 'Work dot2 close rollback test' from wt_people p
  cross join (values ('work.module.access','global'),('work.task.create','own'),('work.task.view_related','own'),('work.task.view_related','assigned')) g(code,scope)
  where p.name <> 'noaccess';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason,expires_at)
  select id,'work.task.view_scope','global','*','Work dot2 close rollback test',null from wt_people where name = 'bld';
grant select on wt_people to authenticated, anon;

create function pg_temp.p(p_name text) returns uuid language sql as $$ select id from wt_people where name = p_name $$;
create function pg_temp.as_(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text
    from wt_people where name = p_name), true);
end $$;
create function pg_temp.ok(cond boolean, message text) returns void language plpgsql as $$ begin
  if cond is distinct from true then raise exception 'Work dot2 close test failed: %', message; end if;
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$ begin
  execute p_sql; return null;
exception when others then return sqlstate || ':' || sqlerrm;
end $$;

-- ── Sơ đồ tổ chức giả: U1 (head trưởng, staff, noaccess) ⊃ U1a (không người), U2 (outsider, bld) ─────
create temporary table wt_refs as select gen_random_uuid() as u1, gen_random_uuid() as u1a, gen_random_uuid() as u2, gen_random_uuid() as slot1,
  (now() at time zone 'Asia/Ho_Chi_Minh')::date as today,
  (date_trunc('quarter', now() at time zone 'Asia/Ho_Chi_Minh') - interval '3 months')::date as pq,
  (date_trunc('quarter', now() at time zone 'Asia/Ho_Chi_Minh'))::date - 1 as pq_end,
  (date_trunc('quarter', now() at time zone 'Asia/Ho_Chi_Minh') - interval '6 months')::date as pq2,
  (date_trunc('quarter', now() at time zone 'Asia/Ho_Chi_Minh') - interval '3 months')::date - 1 as pq2_end,
  (date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh'))::date as cm,
  (date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh'))::date as cw;
grant select on wt_refs to authenticated, anon;
set local session_replication_role = 'replica';
insert into public.org_units(id, name, type, code) select u1, 'Work dot2c U1', 'department', 'WD2C-U1' from wt_refs
  union all select u2, 'Work dot2c U2', 'department', 'WD2C-U2' from wt_refs;
insert into public.org_units(id, name, type, code, parent_id) select u1a, 'Work dot2c U1a', 'department', 'WD2C-U1A', u1 from wt_refs;
insert into public.hrm_org_position_slots(id, code, org_unit_id, position_id) select slot1, 'WD2C-HEAD', u1, gen_random_uuid() from wt_refs;
update public.org_units set manager_slot_id = (select slot1 from wt_refs) where id = (select u1 from wt_refs);
insert into public.employees(id, full_name, user_id, org_unit_id, status)
  select employee_id, full_name, id, case when name in ('head','staff','noaccess') then (select u1 from wt_refs) else (select u2 from wt_refs) end, 'Đang làm việc'
  from wt_people;
insert into public.hrm_employee_slot_assignments(employee_id, slot_id, assignment_type, status, effective_from)
  select (select employee_id from wt_people where name = 'head'), slot1, 'PRIMARY', 'ACTIVE', current_date - 1 from wt_refs;

-- ── Việc thử (chèn thẳng) ──────────────────────────────────────────────────────────────────────────────
create temporary table wt_tasks(name text primary key, id uuid default gen_random_uuid(), creator text, assignee text, status text,
  deadline timestamptz, done_at timestamptz, privacy text default 'standard');
grant select on wt_tasks to authenticated, anon;
insert into wt_tasks(name, creator, assignee, status, deadline, done_at, privacy) values
  ('ontime', 'head', 'staff', 'completed', now() - interval '5 days', now() - interval '6 days', 'standard'),
  ('late', 'head', 'staff', 'completed', now() - interval '5 days', now() - interval '4 days', 'standard'),
  ('overdue', 'head', 'staff', 'in_progress', now() - interval '1 day', null, 'standard'),
  ('open', 'head', 'staff', 'in_progress', now() + interval '5 days', null, 'standard'),
  ('cancel', 'head', 'staff', 'cancelled', now() - interval '2 days', null, 'standard'),
  ('secret', 'head', 'head', 'completed', now() - interval '3 days', now() - interval '4 days', 'restricted'),
  ('draft', 'head', 'staff', 'draft', now() + interval '3 days', null, 'standard'),
  ('foreign', 'outsider', 'outsider', 'in_progress', now() + interval '3 days', null, 'standard');
insert into public.work_tasks(id, task_code, title, scope_type, status, priority, privacy, deadline_at, created_by, completed_at, cancelled_at)
  select w.id, 'VW-2099-' || lpad((row_number() over (order by w.name) + floor(random() * 90000000)::int)::text, 9, '0'),
    'PR6: ' || w.name, 'direct', w.status, 'normal', w.privacy, w.deadline, pg_temp.p(w.creator),
    case when w.status = 'completed' then w.done_at end, case when w.status = 'cancelled' then now() - interval '1 day' end
  from wt_tasks w;
insert into public.work_task_assignments(task_id, user_id, state, assigned_by, acknowledged_at, completed_at, ended_at)
  select w.id, pg_temp.p(w.assignee),
    case w.status when 'completed' then 'completed' when 'cancelled' then 'cancelled' when 'draft' then 'pending_acknowledgement' else 'in_progress' end,
    pg_temp.p(w.creator), case when w.status <> 'draft' then now() - interval '7 days' end,
    case when w.status = 'completed' then w.done_at end,
    case when w.status in ('completed', 'cancelled') then now() - interval '1 day' end
  from wt_tasks w;
-- Lượt AI: một của head (chốt dùng được), một của staff (người khác ⇒ không dùng được).
create temporary table wt_runs(name text primary key, id uuid default gen_random_uuid());
grant select on wt_runs to authenticated, anon;
insert into wt_runs(name) values ('head'), ('staff');
insert into public.ai_runs(id, user_id, skill_code, status) select id, pg_temp.p(name), 'work_period_review', 'ok' from wt_runs;
set local session_replication_role = 'origin';

create function pg_temp.t(p_name text) returns uuid language sql as $$ select id from wt_tasks where name = p_name $$;
create temporary table wt_goals(name text primary key, id uuid);
grant select on wt_goals to authenticated, anon;
create function pg_temp.g(p_name text) returns uuid language sql as $$ select id from wt_goals where name = p_name $$;
create function pg_temp.goal(p_name text) returns jsonb language sql as $$ select app_private.work_goal_json(id) from wt_goals where name = p_name $$;
create temporary table wt_closes(name text primary key, id uuid, snapshot jsonb);
grant select on wt_closes to authenticated, anon;

-- ── 1. Lịch chốt ─────────────────────────────────────────────────────────────────────────────────────
do $$ declare r jsonb; e text; u1 uuid := (select u1 from wt_refs); u1a uuid := (select u1a from wt_refs); u2 uuid := (select u2 from wt_refs); begin
  perform pg_temp.as_('staff');
  r := public.work_period_settings_v1();
  perform pg_temp.ok(r->'company'->>'cadence' = 'week' and (r->'company'->>'closeDow')::int = 6 and r->'company'->>'closeTime' = '17:00'
    and (r->'company'->>'reportDow')::int = 1 and r->'company'->>'reportTime' = '08:00' and r->'company'->'orgUnitId' = 'null'::jsonb,
    'mặc định công ty tuần / T7 17:00 / T2 08:00: '||(r->'company')::text);
  perform pg_temp.ok(not (r->>'canEditCompany')::boolean and r->'editableUnits' = '[]'::jsonb and r->'reopens' = '[]'::jsonb
    and r->'overrides' = '[]'::jsonb, 'nhân viên không sửa được lịch: '||r::text);
  e := pg_temp.err(format('select public.work_period_settings_save_v1(%L::uuid, ''week'', 6, ''17:00'', 1, ''08:00'')', u1));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'nhân viên không đặt lịch đơn vị: '||coalesce(e, 'null'));

  perform pg_temp.as_('bld');
  r := public.work_period_settings_save_v1(null, '2weeks', 5, '16:30', 1, '09:00');
  perform pg_temp.ok(r->>'cadence' = '2weeks' and (r->>'closeDow')::int = 5 and r->>'closeTime' = '16:30' and r->>'reportTime' = '09:00'
    and r->>'updatedBy' = 'Tạ Hồng Sơn' and r->>'updatedAt' is not null, 'BLĐ sửa lịch công ty: '||r::text);
  r := public.work_period_settings_v1();
  perform pg_temp.ok((r->>'canEditCompany')::boolean and r->'company'->>'cadence' = '2weeks'
    and exists (select 1 from jsonb_array_elements(r->'editableUnits') x where x->>'id' = u1::text)
    and exists (select 1 from jsonb_array_elements(r->'editableUnits') x where x->>'id' = u2::text)
    and not exists (select 1 from jsonb_array_elements(r->'editableUnits') x where x->>'id' = u1a::text), 'BLĐ: đơn vị có người: '||(r->'editableUnits')::text);

  perform pg_temp.as_('head');
  e := pg_temp.err($q$select public.work_period_settings_save_v1(null, 'week', 6, '17:00', 1, '08:00')$q$);
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'trưởng không sửa lịch công ty: '||coalesce(e, 'null'));
  e := pg_temp.err(format('select public.work_period_settings_save_v1(%L::uuid, ''week'', 6, ''17:00'', 1, ''08:00'')', u2));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'trưởng không đặt lịch đơn vị khác: '||coalesce(e, 'null'));
  r := public.work_period_settings_save_v1(u1, 'month', 6, '17:00', 1, '08:00');
  perform pg_temp.ok(r->>'cadence' = 'month' and r->>'orgUnitId' = u1::text, 'trưởng đặt riêng U1: '||r::text);
  r := public.work_period_settings_save_v1(u1, 'month', 0, '18:15', 1, '07:45');
  perform pg_temp.ok((r->>'closeDow')::int = 0 and r->>'closeTime' = '18:15' and r->>'reportTime' = '07:45', 'lưu lại (upsert) U1: '||r::text);
  perform pg_temp.ok((select count(*) from public.work_period_settings where org_unit_id = u1) = 1, 'một dòng mỗi đơn vị');
  foreach e in array array[
      format('select public.work_period_settings_save_v1(%L::uuid, ''week'', 6, ''25:00'', 1, ''08:00'')', u1),
      format('select public.work_period_settings_save_v1(%L::uuid, ''week'', 6, ''17:00'', 1, ''8:00'')', u1),
      format('select public.work_period_settings_save_v1(%L::uuid, ''day'', 6, ''17:00'', 1, ''08:00'')', u1),
      format('select public.work_period_settings_save_v1(%L::uuid, ''week'', 7, ''17:00'', 1, ''08:00'')', u1),
      format('select public.work_period_settings_save_v1(%L::uuid, ''week'', 6, ''17:00'', -1, ''08:00'')', u1)] loop
    perform pg_temp.ok(pg_temp.err(e) = '22023:WORK_INVALID_SETTING', 'cài sai ⇒ WORK_INVALID_SETTING: '||e||' → '||coalesce(pg_temp.err(e), 'null'));
  end loop;
  r := public.work_period_settings_v1();
  perform pg_temp.ok(jsonb_array_length(r->'overrides') = 1 and r->'overrides'->0->'unit'->>'code' = 'WD2C-U1' and r->'overrides'->0->>'cadence' = 'month'
    and r->'editableUnits'->0->>'code' = 'WD2C-U1' and jsonb_array_length(r->'editableUnits') = 1 and r->'reopens' = '[]'::jsonb,
    'trưởng thấy lịch riêng U1: '||r::text);

  -- Hiệu lực: U1 riêng ⇒ 'unit'; U1a không cài ⇒ 'parent' (theo U1); U2 ⇒ 'company'.
  r := public.work_period_status_v1(u1, null, null);
  perform pg_temp.ok(r->>'settingSource' = 'unit' and r->'setting'->>'cadence' = 'month' and (r->>'canClose')::boolean, 'U1 theo lịch riêng: '||r::text);
  r := public.work_period_status_v1(u1a, null, null);
  perform pg_temp.ok(r->>'settingSource' = 'parent' and r->'setting'->>'orgUnitId' = u1::text and r->'setting'->>'closeTime' = '18:15',
    'U1a theo U1: '||r::text);
  perform pg_temp.as_('bld');
  r := public.work_period_status_v1(u2, null, null);
  perform pg_temp.ok(r->>'settingSource' = 'company' and r->'setting'->>'cadence' = '2weeks', 'U2 theo công ty: '||r::text);

  perform pg_temp.as_('head');
  e := pg_temp.err('select public.work_period_settings_reset_v1(null)');
  perform pg_temp.ok(e = '22023:WORK_INVALID_SETTING', 'reset công ty không có nghĩa: '||coalesce(e, 'null'));
  r := public.work_period_settings_reset_v1(u1);
  perform pg_temp.ok(r->>'cadence' = '2weeks' and r->'orgUnitId' = 'null'::jsonb, 'reset trả lịch công ty: '||r::text);
  r := public.work_period_status_v1(u1a, null, null);
  perform pg_temp.ok(r->>'settingSource' = 'company' and r->'setting'->>'cadence' = '2weeks', 'sau reset U1a theo công ty: '||r::text);
  -- Trưởng đặt riêng cho đơn vị con.
  r := public.work_period_settings_save_v1(u1a, 'week', 6, '17:00', 1, '08:00');
  perform pg_temp.ok(public.work_period_status_v1(u1a, null, null)->>'settingSource' = 'unit', 'trưởng đặt riêng đơn vị con');
  perform public.work_period_settings_reset_v1(u1a);

  perform pg_temp.as_('outsider');
  e := pg_temp.err(format('select public.work_period_status_v1(%L::uuid, null, null)', u1));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'người đơn vị khác không xem trạng thái U1: '||coalesce(e, 'null'));
  r := public.work_period_status_v1(null, null, null);
  perform pg_temp.ok(not (r->>'canClose')::boolean and r->>'settingSource' = 'company', 'mọi người xem trạng thái công ty, không chốt được: '||r::text);
  perform pg_temp.as_('noaccess');
  e := pg_temp.err('select public.work_period_settings_v1()');
  perform pg_temp.ok(e = '42501:WORK_TASK_NOT_FOUND', 'không có Vioo Work: '||coalesce(e, 'null'));
end $$;

-- ── 2. Mục tiêu: tạo, chia quý, xem / sửa theo quyền, phiên bản ───────────────────────────────────────
do $$ declare r jsonb; e text; u1 uuid := (select u1 from wt_refs); pq date := (select pq from wt_refs); begin
  perform pg_temp.as_('head');
  r := public.work_goal_save_v1(jsonb_build_object('orgUnitId', u1, 'periodKind', 'quarter', 'periodStart', pq, 'title', 'Sản lượng thép lắp dựng',
    'criteria', 'Tổng tấn thép lắp dựng trong quý', 'targetValue', 90, 'measure', 'tấn', 'higherIsBetter', true, 'ownerUserId', pg_temp.p('staff')));
  insert into wt_goals values ('q', (r->>'id')::uuid);
  perform pg_temp.ok(r->>'periodKind' = 'quarter' and (r->>'periodStart')::date = pq and (r->>'periodEnd')::date = (select pq_end from wt_refs)
    and r->>'label' = 'Quý ' || extract(quarter from pq)::int || '/' || extract(year from pq)::int and r->>'measure' = 'tấn'
    and (r->>'lockVersion')::int = 1 and r->'owner'->>'name' = 'Đặng Thu Hà' and r->'unit'->>'code' = 'WD2C-U1'
    and r->'achievedPercent' = 'null'::jsonb and r->>'status' = 'unknown'
    and r->'tasks' = '{"total":0,"done":0,"ontime":0,"late":0,"overdue":0}'::jsonb, 'tạo mục tiêu quý: '||r::text);

  r := public.work_goal_split_v1(pg_temp.g('q'));
  perform pg_temp.ok(jsonb_array_length(r->'goals') = 3
    and (select bool_and((x->>'targetValue')::numeric = 30 and x->>'measure' = 'tấn' and x->>'parentGoalId' = pg_temp.g('q')::text
      and x->>'periodKind' = 'month' and x->>'title' = 'Sản lượng thép lắp dựng' and x->'owner'->>'name' = 'Đặng Thu Hà') from jsonb_array_elements(r->'goals') x)
    and (r->'goals'->0->>'periodStart')::date = pq and (r->'goals'->2->>'periodStart')::date = (pq + interval '2 months')::date
    and r->'goals'->0->>'label' = 'Tháng ' || extract(month from pq)::int || '/' || extract(year from pq)::int, 'chia quý ⇒ 3 tháng target/3: '||r::text);
  insert into wt_goals select 'm' || (ord - 1), (x->>'id')::uuid from jsonb_array_elements(r->'goals') with ordinality a(x, ord);
  r := public.work_goal_split_v1(pg_temp.g('q'));
  perform pg_temp.ok(jsonb_array_length(r->'goals') = 3, 'chia lại không nhân đôi');
  e := pg_temp.err(format('select public.work_goal_split_v1(%L::uuid)', pg_temp.g('m0')));
  perform pg_temp.ok(e = '22023:WORK_GOAL_INVALID', 'chia mục tiêu tháng: '||coalesce(e, 'null'));
end $$;
do $$ declare r jsonb; e text; u1 uuid := (select u1 from wt_refs); pq date := (select pq from wt_refs); begin
  perform pg_temp.ok((select count(*) from wt_goals) = 4, 'đã có q + 3 tháng');
  perform pg_temp.as_('head');
  -- Mục tiêu '%' chia giữ nguyên; xóa mềm cả con.
  r := public.work_goal_save_v1(jsonb_build_object('orgUnitId', u1, 'periodKind', 'quarter', 'periodStart', pq, 'title', 'Tỷ lệ nghiệm thu lần đầu',
    'targetValue', 95, 'measure', '%'));
  insert into wt_goals values ('pct', (r->>'id')::uuid);
  r := public.work_goal_split_v1(pg_temp.g('pct'));
  perform pg_temp.ok((select bool_and((x->>'targetValue')::numeric = 95) from jsonb_array_elements(r->'goals') x), '% giữ nguyên khi chia: '||r::text);
  e := pg_temp.err(format('select public.work_goal_delete_v1(%L::uuid, 7)', pg_temp.g('pct')));
  perform pg_temp.ok(e = 'PT409:WORK_VERSION_CONFLICT', 'xóa sai phiên bản: '||coalesce(e, 'null'));
  r := public.work_goal_delete_v1(pg_temp.g('pct'), 1);
  perform pg_temp.ok(r->>'id' = pg_temp.g('pct')::text
    and (select count(*) from public.work_goals where (id = pg_temp.g('pct') or parent_goal_id = pg_temp.g('pct')) and deleted_at is null) = 0,
    'xóa mềm cả con');

  -- Dữ liệu sai.
  foreach e in array array[
      format('select public.work_goal_save_v1(%L::jsonb)', jsonb_build_object('orgUnitId', u1, 'periodKind', 'quarter', 'periodStart', (pq + interval '1 month')::date, 'title', 'Quý lệch tháng')),
      format('select public.work_goal_save_v1(%L::jsonb)', jsonb_build_object('orgUnitId', u1, 'periodKind', 'month', 'periodStart', pq + 4, 'title', 'Không phải ngày 1')),
      format('select public.work_goal_save_v1(%L::jsonb)', jsonb_build_object('orgUnitId', u1, 'periodKind', 'month', 'periodStart', pq, 'title', 'ab')),
      format('select public.work_goal_save_v1(%L::jsonb)', jsonb_build_object('orgUnitId', u1, 'periodKind', 'week', 'periodStart', pq, 'title', 'Kỳ lạ')),
      format('select public.work_goal_save_v1(%L::jsonb)', jsonb_build_object('orgUnitId', u1, 'periodKind', 'month', 'periodStart', pq, 'title', 'Người phụ trách không có Vioo Work', 'ownerUserId', pg_temp.p('noaccess'))),
      format('select public.work_goal_save_v1(%L::jsonb)', jsonb_build_object('orgUnitId', u1, 'periodKind', 'month', 'periodStart', (pq - interval '1 month')::date, 'title', 'Tháng ngoài quý cha', 'parentGoalId', pg_temp.g('q'))),
      format('select public.work_goal_save_v1(%L::jsonb)', jsonb_build_object('orgUnitId', u1, 'periodKind', 'month', 'periodStart', pq, 'title', 'Khóa lạ', 'bừa', 1)),
      format('select public.work_goal_save_v1(%L::jsonb)', jsonb_build_object('orgUnitId', u1, 'periodKind', 'month', 'periodStart', pq, 'title', 'Số dạng chữ', 'targetValue', '10'))] loop
    perform pg_temp.ok(pg_temp.err(e) = '22023:WORK_GOAL_INVALID', 'mục tiêu sai: '||e||' → '||coalesce(pg_temp.err(e), 'null'));
  end loop;
  e := pg_temp.err(format('select public.work_goal_save_v1(%L::jsonb)', jsonb_build_object('orgUnitId', (select u2 from wt_refs), 'periodKind', 'month', 'periodStart', pq, 'title', 'Mục tiêu U2')));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'trưởng U1 không đặt mục tiêu U2: '||coalesce(e, 'null'));
  e := pg_temp.err(format('select public.work_goal_save_v1(%L::jsonb)', jsonb_build_object('periodKind', 'month', 'periodStart', pq, 'title', 'Mục tiêu công ty')));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'trưởng không đặt mục tiêu công ty: '||coalesce(e, 'null'));

  -- Nhân viên xem được, không sửa được; người đơn vị khác không xem.
  perform pg_temp.as_('staff');
  r := public.work_goals_v1(u1, pq, (select pq_end from wt_refs));
  perform pg_temp.ok(not (r->>'canEdit')::boolean and jsonb_array_length(r->'goals') = 4 and r->'goals'->0->>'id' = pg_temp.g('q')::text
    and r->'goals'->1->>'id' = pg_temp.g('m0')::text, 'nhân viên xem 4 mục tiêu (quý trước tháng, không có mục tiêu đã xóa): '||r::text);
  e := pg_temp.err(format('select public.work_goal_save_v1(%L::jsonb)', jsonb_build_object('id', pg_temp.g('q'), 'title', 'Nhân viên sửa', 'expectedLockVersion', 1)));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'nhân viên không sửa mục tiêu: '||coalesce(e, 'null'));
  e := pg_temp.err(format('select public.work_goal_split_v1(%L::uuid)', pg_temp.g('q')));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'nhân viên không chia mục tiêu: '||coalesce(e, 'null'));
  e := pg_temp.err(format('select public.work_goal_tasks_set_v1(%L::uuid, array[%L::uuid], null)', pg_temp.g('q'), pg_temp.t('open')));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'nhân viên không gắn việc: '||coalesce(e, 'null'));
  perform pg_temp.as_('outsider');
  e := pg_temp.err(format('select public.work_goals_v1(%L::uuid, %L::date, %L::date)', u1, pq, (select pq_end from wt_refs)));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'người U2 không xem mục tiêu U1: '||coalesce(e, 'null'));
  e := pg_temp.err(format('select public.work_goal_tasks_v1(%L::uuid)', pg_temp.g('q')));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'người U2 không xem việc của mục tiêu U1: '||coalesce(e, 'null'));
  r := public.work_goals_v1(null, pq, (select pq_end from wt_refs));
  perform pg_temp.ok(not (r->>'canEdit')::boolean and r ? 'goals', 'mọi người xem mục tiêu công ty: '||r::text);

  -- Sai phiên bản ⇒ PT409; thiếu phiên bản ⇒ WORK_GOAL_INVALID.
  perform pg_temp.as_('head');
  e := pg_temp.err(format('select public.work_goal_save_v1(%L::jsonb)', jsonb_build_object('id', pg_temp.g('q'), 'actualValue', 81, 'expectedLockVersion', 5)));
  perform pg_temp.ok(e = 'PT409:WORK_VERSION_CONFLICT', 'sai phiên bản ⇒ PT409: '||coalesce(e, 'null'));
  e := pg_temp.err(format('select public.work_goal_save_v1(%L::jsonb)', jsonb_build_object('id', pg_temp.g('q'), 'actualValue', 81)));
  perform pg_temp.ok(e = '22023:WORK_GOAL_INVALID', 'thiếu phiên bản: '||coalesce(e, 'null'));
end $$;

-- ── 3. % đạt + trạng thái ───────────────────────────────────────────────────────────────────────────────
create function pg_temp.edit(p_name text, p_patch jsonb) returns jsonb language plpgsql as $$
declare v jsonb := pg_temp.goal(p_name);
begin
  return public.work_goal_save_v1(p_patch || jsonb_build_object('id', v->>'id', 'expectedLockVersion', (v->>'lockVersion')::int));
end $$;
do $$ declare r jsonb; u1 uuid := (select u1 from wt_refs); begin
  perform pg_temp.as_('head');
  -- Kỳ đã qua.
  r := pg_temp.edit('q', '{"actualValue": 81}');
  perform pg_temp.ok((r->>'achievedPercent')::numeric = 90 and r->>'status' = 'missed' and (r->>'lockVersion')::int = 2
    and r->>'title' = 'Sản lượng thép lắp dựng' and r->>'measure' = 'tấn', 'quý qua 81/90 ⇒ 90% chưa đạt (khóa không gửi giữ nguyên): '||r::text);
  r := pg_temp.edit('q', '{"actualValue": 90}');
  perform pg_temp.ok((r->>'achievedPercent')::numeric = 100 and r->>'status' = 'met', '90/90 ⇒ đạt: '||r::text);
  r := pg_temp.edit('q', '{"higherIsBetter": false, "targetValue": 5, "actualValue": 4}');
  perform pg_temp.ok((r->>'achievedPercent')::numeric = 125 and r->>'status' = 'met', 'càng thấp càng tốt 4/5 ⇒ 125%: '||r::text);
  r := pg_temp.edit('q', '{"actualValue": 10}');
  perform pg_temp.ok((r->>'achievedPercent')::numeric = 50 and r->>'status' = 'missed', 'càng thấp càng tốt 10/5 ⇒ 50%: '||r::text);
  r := pg_temp.edit('q', '{"actualValue": 0}');
  perform pg_temp.ok((r->>'achievedPercent')::numeric = 100, 'càng thấp càng tốt, thực tế 0 ⇒ 100%: '||r::text);
  r := pg_temp.edit('q', '{"targetValue": 0, "actualValue": 0}');
  perform pg_temp.ok((r->>'achievedPercent')::numeric = 100, 'mục tiêu 0, thực tế 0 ⇒ 100%: '||r::text);
  r := pg_temp.edit('q', '{"higherIsBetter": true, "targetValue": 0, "actualValue": 5}');
  perform pg_temp.ok(r->'achievedPercent' = 'null'::jsonb and r->>'status' = 'unknown', 'càng cao càng tốt, mục tiêu 0 ⇒ null, không việc ⇒ unknown: '||r::text);
  r := pg_temp.edit('q', '{"targetValue": 90, "actualValue": 81, "title": "Sản lượng thép lắp dựng quý"}');
  perform pg_temp.ok(r->>'status' = 'missed' and (r->>'lockVersion')::int = 9, 'trả về 81/90 cho phần chốt: '||r::text);

  -- Kỳ đang chạy: tháng này.
  r := public.work_goal_save_v1(jsonb_build_object('orgUnitId', u1, 'periodKind', 'month', 'periodStart', (select cm from wt_refs),
    'title', 'Hoàn thành việc tháng', 'targetValue', 10, 'measure', 'việc', 'actualValue', 10));
  insert into wt_goals values ('cur', (r->>'id')::uuid);
  perform pg_temp.ok(r->>'status' = 'met' and (r->>'achievedPercent')::numeric = 100, 'đang chạy, đủ chỉ tiêu ⇒ met: '||r::text);
  r := pg_temp.edit('cur', '{"actualValue": 5}');
  perform pg_temp.ok(r->>'status' = 'on_track', 'đang chạy, chưa đủ ⇒ on_track: '||r::text);
end $$;

-- ── 4. Gắn việc: số việc + trạng thái ──────────────────────────────────────────────────────────────────
do $$ declare r jsonb; e text; it jsonb; begin
  perform pg_temp.as_('head');
  r := public.work_goal_tasks_set_v1(pg_temp.g('cur'), array[pg_temp.t('ontime'), pg_temp.t('late'), pg_temp.t('overdue'), pg_temp.t('open'),
    pg_temp.t('cancel'), pg_temp.t('secret'), pg_temp.t('ontime')], null);
  perform pg_temp.ok((r->>'total')::int = 6, 'gắn 6 việc (trùng bỏ qua): '||r::text);
  r := pg_temp.goal('cur');
  perform pg_temp.ok(r->'tasks' = '{"total":5,"done":3,"ontime":2,"late":1,"overdue":1}'::jsonb and r->>'status' = 'at_risk',
    'không tính hủy; có trễ / quá hạn ⇒ at_risk: '||r::text);
  e := pg_temp.err(format('select public.work_goal_tasks_set_v1(%L::uuid, array[%L::uuid], null)', pg_temp.g('cur'), pg_temp.t('draft')));
  perform pg_temp.ok(e = '22023:WORK_GOAL_INVALID', 'không gắn việc nháp: '||coalesce(e, 'null'));
  e := pg_temp.err(format('select public.work_goal_tasks_set_v1(%L::uuid, array[%L::uuid], null)', pg_temp.g('cur'), pg_temp.t('foreign')));
  perform pg_temp.ok(e = '22023:WORK_GOAL_INVALID', 'không gắn việc mình không xem được: '||coalesce(e, 'null'));
  e := pg_temp.err(format('select public.work_goal_tasks_set_v1(%L::uuid, array[%L::uuid], null)', pg_temp.g('cur'), gen_random_uuid()));
  perform pg_temp.ok(e = '22023:WORK_GOAL_INVALID', 'không gắn việc không có: '||coalesce(e, 'null'));
  r := public.work_goal_tasks_v1(pg_temp.g('cur'));
  select x into it from jsonb_array_elements(r->'items') x where x->>'id' = pg_temp.t('secret')::text;
  perform pg_temp.ok(jsonb_array_length(r->'items') = 6 and it->>'title' = 'PR6: secret' and not (it->>'restricted')::boolean, 'người gắn thấy đủ: '||r::text);

  -- Kỳ đã qua: việc xong hết, đúng hạn ⇒ met; có việc trễ ⇒ missed; bỏ gắn ⇒ unknown.
  perform public.work_goal_tasks_set_v1(pg_temp.g('m0'), array[pg_temp.t('ontime')]);
  perform public.work_goal_tasks_set_v1(pg_temp.g('m1'), array[pg_temp.t('late')]);
  perform pg_temp.ok(pg_temp.goal('m0')->>'status' = 'met' and pg_temp.goal('m0')->'achievedPercent' = 'null'::jsonb, 'đã qua, xong đúng hạn ⇒ met: '||pg_temp.goal('m0')::text);
  perform pg_temp.ok(pg_temp.goal('m1')->>'status' = 'missed', 'đã qua, xong trễ ⇒ missed: '||pg_temp.goal('m1')::text);
  r := public.work_goal_tasks_set_v1(pg_temp.g('m1'), null, array[pg_temp.t('late')]);
  perform pg_temp.ok((r->>'total')::int = 0 and pg_temp.goal('m1')->>'status' = 'unknown', 'bỏ gắn ⇒ unknown: '||pg_temp.goal('m1')::text);

  perform pg_temp.as_('staff');
  r := public.work_goal_tasks_v1(pg_temp.g('cur'));
  select x into it from jsonb_array_elements(r->'items') x where x->>'id' = pg_temp.t('secret')::text;
  perform pg_temp.ok(it->>'title' = 'Việc hạn chế' and it->'code' = 'null'::jsonb and (it->>'restricted')::boolean and it->'assignees' = '[]'::jsonb,
    'nhân viên thấy việc hạn chế đã che: '||coalesce(it::text, 'null'));
  select x into it from jsonb_array_elements(r->'items') x where x->>'id' = pg_temp.t('late')::text;
  perform pg_temp.ok(it->>'title' = 'PR6: late' and not (it->>'ontime')::boolean and not (it->>'overdue')::boolean,
    'việc trễ: '||coalesce(it::text, 'null'));
  select x into it from jsonb_array_elements(r->'items') x where x->>'id' = pg_temp.t('overdue')::text;
  perform pg_temp.ok((it->>'overdue')::boolean and not (it->>'ontime')::boolean and it->>'level' = 'C' and it->'assignees'->0->>'name' = 'Đặng Thu Hà', 'việc quá hạn: '||coalesce(it::text, 'null'));
  perform pg_temp.ok((public.work_goals_v1((select u1 from wt_refs), (select cm from wt_refs))->'goals'->0->'tasks'->>'total')::int = 5,
    'số việc của mục tiêu vẫn đếm việc hạn chế với nhân viên');
end $$;

-- ── 5. Chốt kỳ quý trước của U1 ─────────────────────────────────────────────────────────────────────────
do $$ declare r jsonb; e text; u1 uuid := (select u1 from wt_refs); pq date := (select pq from wt_refs); pqe date := (select pq_end from wt_refs);
  pq2 date := (select pq2 from wt_refs); pq2e date := (select pq2_end from wt_refs); v_call text;
begin
  v_call := 'select public.work_period_close_v1(%L::uuid, %L::date, %L::date, %L::date, %L::date, %L, %L, %L::jsonb, %L::uuid)';
  perform pg_temp.as_('staff');
  e := pg_temp.err(format(v_call, u1, pq, pqe, pq2, pq2e, 'Quý trước', null, null, null));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'nhân viên không chốt được: '||coalesce(e, 'null'));
  perform pg_temp.as_('head');
  e := pg_temp.err(format(v_call, u1, (select today from wt_refs) + 1, (select today from wt_refs) + 7, null, null, 'Tuần sau', null, null, null));
  perform pg_temp.ok(e = '22023:WORK_INVALID_PERIOD', 'kỳ chưa bắt đầu: '||coalesce(e, 'null'));
  e := pg_temp.err(format(v_call, null, pq, pqe, null, null, 'Quý trước', null, null, null));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'trưởng không chốt toàn công ty: '||coalesce(e, 'null'));
  e := pg_temp.err(format(v_call, u1, pq, pqe, pq2, pq2e, 'Quý trước', null, null, (select id from wt_runs where name = 'staff')));
  perform pg_temp.ok(e = '22023:WORK_AI_RUN_INVALID', 'lượt AI của người khác: '||coalesce(e, 'null'));
  e := pg_temp.err(format(v_call, u1, pq, pqe, pq2, pq2e, 'Quý trước', null, null, null));
  perform pg_temp.ok(e = '22023:WORK_GOAL_SOLUTION_REQUIRED', 'mục tiêu chưa đạt chưa có giải pháp: '||coalesce(e, 'null'));
  e := pg_temp.err(format(v_call, u1, pq, pqe, pq2, pq2e, 'Quý trước', null, jsonb_build_array(jsonb_build_object('goalId', pg_temp.g('cur'), 'solution', 'x')), null));
  perform pg_temp.ok(e = '22023:WORK_GOAL_INVALID', 'mục tiêu ngoài kỳ: '||coalesce(e, 'null'));
  e := pg_temp.err(format(v_call, u1, pq, pqe, pq2, pq2e, 'Quý trước', null, jsonb_build_array(jsonb_build_object('goalId', gen_random_uuid(), 'solution', 'x')), null));
  perform pg_temp.ok(e = '22023:WORK_GOAL_INVALID', 'mục tiêu lạ: '||coalesce(e, 'null'));
  perform pg_temp.ok((pg_temp.goal('q')->>'lockVersion')::int = 9, 'lệnh lỗi không ghi gì');

  r := public.work_period_close_v1(u1, pq, pqe, pq2, pq2e, 'Quý trước · thử', 'Kỳ ổn, thép chậm.',
    jsonb_build_array(jsonb_build_object('goalId', pg_temp.g('q'), 'actualValue', 81, 'assessment', 'Đạt 90% chỉ tiêu tấn.',
      'solution', 'Tổ lắp dựng tăng ca 2 tối / tuần đến hết tháng sau.')),
    (select id from wt_runs where name = 'head'));
  insert into wt_closes(name, id) values ('c1', (r->>'closeId')::uuid);
  perform pg_temp.ok(r->>'closedAt' is not null, 'chốt được: '||r::text);
  perform pg_temp.ok((select accepted from public.ai_runs where id = (select id from wt_runs where name = 'head')), 'lượt AI được đánh dấu đã dùng');
  perform pg_temp.ok(pg_temp.goal('q')->>'solution' like 'Tổ lắp dựng%' and (pg_temp.goal('q')->>'lockVersion')::int = 10, 'đánh giá ghi vào mục tiêu');
  e := pg_temp.err(format('select public.work_period_close_get_v1(%L::uuid)', gen_random_uuid()));
  perform pg_temp.ok(e = '42501:WORK_TASK_NOT_FOUND', 'bản chốt không có: '||coalesce(e, 'null'));
end $$;
do $$ declare r jsonb; s jsonb; e text; u1 uuid := (select u1 from wt_refs); pq date := (select pq from wt_refs); pqe date := (select pq_end from wt_refs);
  c1 uuid := (select id from wt_closes where name = 'c1');
begin
  perform pg_temp.ok(c1 is not null, 'đã có bản chốt c1');
  perform pg_temp.as_('head');
  r := public.work_period_close_get_v1(c1);
  s := r->'snapshot';
  update wt_closes set snapshot = s where name = 'c1';
  perform pg_temp.ok(r->>'status' = 'closed' and r->>'label' = 'Quý trước · thử' and r->>'note' = 'Kỳ ổn, thép chậm.' and r->>'closedBy' = 'Vương Thành Đô'
    and (r->>'from')::date = pq and (r->>'to')::date = pqe and jsonb_array_length(r->'history') = 1 and r->'history'->0->>'action' = 'close',
    'xem bản chốt: '||(r - 'snapshot')::text);
  perform pg_temp.ok((s->>'version')::int = 1 and s->'scope'->>'code' = 'WD2C-U1' and s->'scope'->>'orgUnitId' = u1::text
    and (s->>'statsTo')::date = pqe and (s->'board'->'period'->>'to')::date = pqe and (s->>'prevFrom')::date = (select pq2 from wt_refs)
    and s->'closedBy'->>'name' = 'Vương Thành Đô' and jsonb_typeof(s->'directives') = 'array',
    'snapshot đủ phần, kỳ đã qua ⇒ statsTo = to: '||(s - 'board' - 'goals' - 'directives')::text);
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(s->'board'->'members') m where m->>'userId' = pg_temp.p('staff')::text),
    'snapshot.board.members có nhân viên: '||(s->'board')::text);
  perform pg_temp.ok(jsonb_array_length(s->'goals') = 4 and exists (select 1 from jsonb_array_elements(s->'goals') g
      where g->>'id' = pg_temp.g('q')::text and g->>'status' = 'missed' and g->>'solution' like 'Tổ lắp dựng%' and (g->>'actualValue')::numeric = 81)
    and exists (select 1 from jsonb_array_elements(s->'goals') g where g->>'id' = pg_temp.g('m0')::text and g->>'status' = 'met'),
    'snapshot.goals: '||(s->'goals')::text);

  e := pg_temp.err(format('select public.work_period_close_v1(%L::uuid, %L::date, %L::date)', u1, pq, pqe));
  perform pg_temp.ok(e = '22023:WORK_PERIOD_ALREADY_CLOSED', 'chốt lại cùng kỳ: '||coalesce(e, 'null'));

  r := public.work_period_status_v1(u1, pq, pqe);
  perform pg_temp.ok(r->'close'->>'id' = c1::text and r->'close'->>'closedBy' = 'Vương Thành Đô' and (r->>'canClose')::boolean
    and jsonb_array_length(r->'history') = 1, 'trạng thái đã chốt: '||r::text);
  perform pg_temp.as_('staff');
  r := public.work_period_status_v1(u1, pq, pqe);
  perform pg_temp.ok(r->'close'->>'id' = c1::text and not (r->>'canClose')::boolean, 'nhân viên thấy đã chốt, không chốt được: '||r::text);
  e := pg_temp.err(format('select public.work_period_close_get_v1(%L::uuid)', c1));
  perform pg_temp.ok(e = '42501:WORK_TASK_NOT_FOUND', 'nhân viên không mở bản chốt: '||coalesce(e, 'null'));
  perform pg_temp.as_('outsider');
  e := pg_temp.err(format('select public.work_period_close_get_v1(%L::uuid)', c1));
  perform pg_temp.ok(e = '42501:WORK_TASK_NOT_FOUND', 'người U2 không mở bản chốt U1: '||coalesce(e, 'null'));
  perform pg_temp.as_('bld');
  perform pg_temp.ok(public.work_period_close_get_v1(c1)->'snapshot' = s, 'BLĐ mở được bản chốt U1');
end $$;

-- Sau khi chốt: việc đổi (đúng hạn ⇒ trễ), mục tiêu đổi tên ⇒ ảnh chốt không đổi.
set local session_replication_role = 'replica';
update public.work_tasks set completed_at = deadline_at + interval '1 day' where id = (select id from wt_tasks where name = 'ontime');
set local session_replication_role = 'origin';
do $$ declare r jsonb; c1 uuid := (select id from wt_closes where name = 'c1'); begin
  perform pg_temp.as_('head');
  perform pg_temp.edit('q', '{"title": "Tên mới sau khi chốt", "actualValue": 50}');
  perform pg_temp.ok(pg_temp.goal('m0')->>'status' = 'missed' and pg_temp.goal('q')->>'title' = 'Tên mới sau khi chốt', 'số chạy thật đã đổi');
  r := public.work_period_close_get_v1(c1);
  perform pg_temp.ok(r->'snapshot' = (select snapshot from wt_closes where name = 'c1'), 'ảnh chốt không đổi sau khi sửa việc / mục tiêu');
end $$;

-- ── 6. Mở lại + chốt lại ─────────────────────────────────────────────────────────────────────────────────
do $$ declare r jsonb; e text; u1 uuid := (select u1 from wt_refs); pq date := (select pq from wt_refs); pqe date := (select pq_end from wt_refs);
  c1 uuid := (select id from wt_closes where name = 'c1'); c2 uuid;
begin
  perform pg_temp.as_('staff');
  e := pg_temp.err(format('select public.work_period_reopen_v1(%L::uuid, %L)', c1, 'Nhân viên muốn mở'));
  perform pg_temp.ok(e = '42501:WORK_BOARD_DENIED', 'nhân viên không mở lại: '||coalesce(e, 'null'));
  perform pg_temp.as_('head');
  e := pg_temp.err(format('select public.work_period_reopen_v1(%L::uuid, null)', c1));
  perform pg_temp.ok(e = '22023:WORK_REOPEN_REASON_REQUIRED', 'mở lại không lý do: '||coalesce(e, 'null'));
  e := pg_temp.err(format('select public.work_period_reopen_v1(%L::uuid, %L)', c1, '  sai '));
  perform pg_temp.ok(e = '22023:WORK_REOPEN_REASON_REQUIRED', 'lý do < 5 ký tự: '||coalesce(e, 'null'));
  e := pg_temp.err(format('select public.work_period_reopen_v1(%L::uuid, %L)', gen_random_uuid(), 'Không có bản chốt'));
  perform pg_temp.ok(e = '42501:WORK_TASK_NOT_FOUND', 'bản chốt không có: '||coalesce(e, 'null'));
  r := public.work_period_reopen_v1(c1, 'Số tấn tháng đầu nhập sai');
  perform pg_temp.ok(r = jsonb_build_object('closeId', c1, 'status', 'reopened'), 'mở lại: '||r::text);
  e := pg_temp.err(format('select public.work_period_reopen_v1(%L::uuid, %L)', c1, 'Mở lần nữa'));
  perform pg_temp.ok(e = '22023:WORK_PERIOD_NOT_CLOSED', 'mở lại bản đã mở: '||coalesce(e, 'null'));

  r := public.work_period_status_v1(u1, pq, pqe);
  perform pg_temp.ok(r->'close' = 'null'::jsonb and jsonb_array_length(r->'history') = 2 and r->'history'->0->>'action' = 'reopen'
    and r->'history'->0->>'reason' = 'Số tấn tháng đầu nhập sai' and r->'history'->0->>'actor' = 'Vương Thành Đô' and r->'history'->1->>'action' = 'close',
    'trạng thái sau mở lại: '||r::text);
  r := public.work_period_close_get_v1(c1);
  perform pg_temp.ok(r->>'status' = 'reopened' and r->>'reopenReason' = 'Số tấn tháng đầu nhập sai' and r->>'reopenedBy' = 'Vương Thành Đô'
    and r->>'reopenedAt' is not null, 'bản chốt đã mở lại: '||(r - 'snapshot')::text);
  perform pg_temp.ok(public.work_period_settings_v1()->'reopens' = '[]'::jsonb, 'trưởng không thấy lịch sử mở lại toàn công ty');

  perform pg_temp.as_('bld');
  r := public.work_period_settings_v1();
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r->'reopens') x where x->>'closeId' = c1::text and x->>'reason' = 'Số tấn tháng đầu nhập sai'
      and x->>'actor' = 'Vương Thành Đô' and x->'unit'->>'code' = 'WD2C-U1' and (x->>'from')::date = pq and x->>'label' = 'Quý trước · thử'),
    'BLĐ thấy lần mở lại: '||(r->'reopens')::text);

  -- Chốt lại: m0 nay trễ ⇒ chưa đạt, phải có giải pháp.
  perform pg_temp.as_('head');
  e := pg_temp.err(format('select public.work_period_close_v1(%L::uuid, %L::date, %L::date)', u1, pq, pqe));
  perform pg_temp.ok(e = '22023:WORK_GOAL_SOLUTION_REQUIRED', 'chốt lại cần giải pháp cho mục tiêu tháng nay trễ: '||coalesce(e, 'null'));
  r := public.work_period_close_v1(u1, pq, pqe, p_label => 'Quý trước · chốt lại',
    p_goal_reviews => jsonb_build_array(jsonb_build_object('goalId', pg_temp.g('m0'), 'assessment', 'Việc xong trễ 1 ngày.',
      'solution', 'Trưởng phòng duyệt kế hoạch tuần trước thứ 2.')));
  c2 := (r->>'closeId')::uuid;
  insert into wt_closes(name, id) values ('c2', c2);
  r := public.work_period_close_get_v1(c2);
  perform pg_temp.ok(r->>'status' = 'closed' and jsonb_array_length(r->'history') = 3
    and (select array_agg(x->>'action' order by ord) from jsonb_array_elements(r->'history') with ordinality a(x, ord)) = array['close', 'reopen', 'close']
    and r->'snapshot'->'prevFrom' = 'null'::jsonb and r->'snapshot'->'board'->'period'->'prevFrom' = 'null'::jsonb, 'chốt lại được: '||(r - 'snapshot')::text);
  perform pg_temp.ok(public.work_period_status_v1(u1, pq, pqe)->'close'->>'id' = c2::text, 'trạng thái trỏ bản chốt mới');
  perform pg_temp.ok((select count(*) from public.work_period_closes where org_unit_id = u1) = 2, 'giữ bản chốt cũ (đã mở lại)');
end $$;

-- ── 7. Kỳ đang chạy: số bảng tính tới hôm nay; BLĐ chốt toàn công ty ──────────────────────────────────────
do $$ declare r jsonb; s jsonb; e text; cw date := (select cw from wt_refs); td date := (select today from wt_refs); begin
  perform pg_temp.as_('head');
  r := public.work_period_close_v1((select u1a from wt_refs), cw, cw + 6, cw - 7, cw - 1, 'Tuần này U1a', null, null, null);
  s := public.work_period_close_get_v1((r->>'closeId')::uuid);
  perform pg_temp.ok((s->>'to')::date = cw + 6 and (s->'snapshot'->>'statsTo')::date = least(cw + 6, td)
    and (s->'snapshot'->'board'->'period'->>'to')::date = least(cw + 6, td) and (s->'snapshot'->>'to')::date = cw + 6,
    'kỳ đang chạy: lưu trọn kỳ, số bảng tới hôm nay: '||((s->'snapshot') - 'board' - 'goals' - 'directives')::text);
  perform pg_temp.ok(public.work_period_status_v1((select u1a from wt_refs), cw, cw + 6)->'close'->>'id' = r->>'closeId', 'tìm thấy theo trọn kỳ');

  perform pg_temp.as_('bld');
  r := public.work_period_close_v1(null, (select pq from wt_refs), (select pq_end from wt_refs), p_label => 'Quý trước · toàn công ty');
  s := public.work_period_close_get_v1((r->>'closeId')::uuid);
  perform pg_temp.ok(s->'orgUnitId' = 'null'::jsonb and s->'snapshot'->'scope'->>'name' = 'Toàn công ty' and s->'snapshot'->'scope'->'orgUnitId' = 'null'::jsonb
    and jsonb_typeof(s->'snapshot'->'board'->'units') = 'array' and s->'snapshot'->'goals' = '[]'::jsonb,
    'BLĐ chốt toàn công ty: '||((s->'snapshot') - 'board' - 'directives')::text);
  perform pg_temp.ok((public.work_period_status_v1(null, (select pq from wt_refs), (select pq_end from wt_refs))->>'canClose')::boolean, 'BLĐ chốt được công ty');
  e := pg_temp.err(format('select public.work_period_close_v1(null, %L::date, %L::date)', (select pq from wt_refs), (select pq_end from wt_refs)));
  perform pg_temp.ok(e = '22023:WORK_PERIOD_ALREADY_CLOSED', 'công ty chốt lại cùng kỳ: '||coalesce(e, 'null'));
end $$;

-- ── 8. Quyền thực thi ───────────────────────────────────────────────────────────────────────────────────
do $$ declare f text; begin
  foreach f in array array['public.work_period_settings_v1()', 'public.work_period_settings_save_v1(uuid,text,integer,text,integer,text)',
    'public.work_period_settings_reset_v1(uuid)', 'public.work_period_status_v1(uuid,date,date)',
    'public.work_period_close_v1(uuid,date,date,date,date,text,text,jsonb,uuid)', 'public.work_period_reopen_v1(uuid,text)',
    'public.work_period_close_get_v1(uuid)', 'public.work_goals_v1(uuid,date,date)', 'public.work_goal_save_v1(jsonb)',
    'public.work_goal_split_v1(uuid)', 'public.work_goal_delete_v1(uuid,integer)', 'public.work_goal_tasks_set_v1(uuid,uuid[],uuid[])',
    'public.work_goal_tasks_v1(uuid)'] loop
    perform pg_temp.ok(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
      and not has_function_privilege('public', f, 'execute'), 'quyền thực thi '||f);
  end loop;
  foreach f in array array['app_private.work_can_manage_scope(uuid,uuid)', 'app_private.work_can_view_scope(uuid,uuid)',
    'app_private.work_unit_json(uuid)', 'app_private.work_period_setting_json(uuid)', 'app_private.work_goal_period_end(text,date)',
    'app_private.work_period_history_json(uuid,date,date)', 'app_private.work_goal_json(uuid)'] loop
    perform pg_temp.ok(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'), 'hàm nội bộ không mở '||f);
  end loop;
  foreach f in array array['public.work_period_settings', 'public.work_period_closes', 'public.work_period_close_events', 'public.work_goals', 'public.work_goal_tasks'] loop
    perform pg_temp.ok(not has_table_privilege('authenticated', f, 'select') and not has_table_privilege('anon', f, 'select')
      and (select c.relrowsecurity from pg_class c where c.oid = f::regclass), 'bảng đóng + RLS '||f);
  end loop;
  perform pg_temp.ok((select enabled and required_permission = 'work.module.access' and quota_group = 'work' and mode = 'draft' and daily_limit = 20
    from public.ai_skills where code = 'work_period_review'), 'skill work_period_review');
end $$;
