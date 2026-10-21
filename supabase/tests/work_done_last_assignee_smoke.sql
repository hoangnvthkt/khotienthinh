-- Vioo Work: việc đã xong tính theo người làm cuối cùng khi lọc theo người / đơn vị (20261024130000_work_done_last_assignee).
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261023150000_work_dot2_digest.sql \
--   --migration supabase/migrations/20261024130000_work_done_last_assignee.sql \
--   --smoke supabase/tests/work_done_last_assignee_smoke.sql
-- Vai (tên giả): a = Vương Thị Khuê (U1) · b = Lã Văn Đông (U2) · bld = Bế Thị Trang (U3, xem toàn công ty).
-- Việc thử (kỳ = hôm nay − 7 → hôm nay + 7, giờ VN):
--   x: chỉ đạo, a nhận rồi chuyển cho b, b làm xong hôm qua (trước hạn) ⇒ thuộc U2 / b, không thuộc U1 / a.
--   w: chỉ đạo đang làm, a chuyển cho b ⇒ đang mở thuộc U2 (như cũ).
--   z: chỉ đạo đang làm của a ⇒ U1 (như cũ).
-- Phân công chèn đúng như lệnh máy chủ: chuyển ⇒ state 'transferred' + ended_at; hoàn thành ⇒ state 'completed' + ended_at = lúc xong.
create temporary table wt_people(name text primary key, full_name text, id uuid default gen_random_uuid(),
  email text default ('work-dla-'||gen_random_uuid()||'@invalid.local'), employee_id uuid default gen_random_uuid());
insert into wt_people(name, full_name) values ('a', 'Vương Thị Khuê'), ('b', 'Lã Văn Đông'), ('bld', 'Bế Thị Trang');
insert into public.users(id,name,username,email,role)
  select id,full_name,'work-dla-'||id,email,'EMPLOYEE'::public.user_role from wt_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select p.id, g.code, g.scope, '*', 'Work done last assignee rollback test' from wt_people p
  cross join (values ('work.module.access','global'),('work.task.create','own'),('work.task.view_related','own'),('work.task.view_related','assigned')) g(code,scope);
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason,expires_at)
  select id,'work.task.view_scope','global','*','Work done last assignee rollback test',null from wt_people where name = 'bld';
grant select on wt_people to authenticated, anon;

create function pg_temp.p(p_name text) returns uuid language sql as $$ select id from wt_people where name = p_name $$;
create function pg_temp.as_(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text
    from wt_people where name = p_name), true);
end $$;
create function pg_temp.ok(cond boolean, message text) returns void language plpgsql as $$ begin
  if cond is distinct from true then raise exception 'Work done last assignee test failed: %', message; end if;
end $$;

create temporary table wt_refs as select gen_random_uuid() as u1, gen_random_uuid() as u2, gen_random_uuid() as u3,
  (now() at time zone 'Asia/Ho_Chi_Minh')::date as today;
grant select on wt_refs to authenticated, anon;
create function pg_temp.u(p_name text) returns uuid language sql as $$
  select case p_name when 'u1' then u1 when 'u2' then u2 when 'u3' then u3 end from wt_refs $$;
create function pg_temp.d(p_offset integer) returns date language sql as $$ select today + p_offset from wt_refs $$;

set local session_replication_role = 'replica';
insert into public.org_units(id, name, type, code)
  select u1, 'Work DLA U1', 'department', 'WDLA-U1' from wt_refs union all select u2, 'Work DLA U2', 'department', 'WDLA-U2' from wt_refs
  union all select u3, 'Work DLA U3', 'department', 'WDLA-U3' from wt_refs;
insert into public.employees(id, full_name, user_id, org_unit_id, status)
  select employee_id, full_name, id, pg_temp.u(case name when 'a' then 'u1' when 'b' then 'u2' else 'u3' end), 'Đang làm việc' from wt_people;

create temporary table wt_tasks(name text primary key, id uuid default gen_random_uuid(), status text, deadline timestamptz, done_at timestamptz);
grant select on wt_tasks to authenticated, anon;
insert into wt_tasks(name, status, deadline, done_at) values
  ('x', 'completed', now() + interval '1 day', now() - interval '1 day'),
  ('w', 'in_progress', now() + interval '3 days', null),
  ('z', 'in_progress', now() + interval '2 days', null);
insert into public.work_tasks(id, task_code, title, scope_type, status, priority, privacy, deadline_at, created_by, completed_at)
  select w.id, 'VW-2099-' || lpad((row_number() over (order by w.name) + floor(random() * 90000000)::int)::text, 9, '0'),
    'DLA: ' || w.name, 'direct', w.status, 'normal', 'standard', w.deadline, pg_temp.p('bld'), w.done_at
  from wt_tasks w;
insert into public.work_task_origins(task_id, origin, claim_status, created_by)
  select w.id, 'directive', 'not_needed', pg_temp.p('bld') from wt_tasks w;
-- x, w: a nhận rồi chuyển cho b.
insert into public.work_task_assignments(task_id, user_id, state, assigned_by, acknowledged_at, ended_at, transfer_reason, assigned_at)
  select w.id, pg_temp.p('a'), 'transferred', pg_temp.p('bld'), now() - interval '5 days', now() - interval '3 days', 'Chuyển người làm',
    now() - interval '5 days'
  from wt_tasks w where w.name in ('x', 'w');
insert into public.work_task_assignments(task_id, user_id, state, assigned_by, acknowledged_at, completed_at, ended_at, assigned_at)
  select w.id, pg_temp.p('b'), case when w.status = 'completed' then 'completed' else 'in_progress' end, pg_temp.p('a'),
    now() - interval '3 days', w.done_at, w.done_at, now() - interval '3 days'
  from wt_tasks w where w.name in ('x', 'w');
insert into public.work_task_assignments(task_id, user_id, state, assigned_by, acknowledged_at)
  select w.id, pg_temp.p('a'), 'in_progress', pg_temp.p('bld'), now() - interval '2 days' from wt_tasks w where w.name = 'z';
-- Mục tiêu U2 tháng này, gắn việc x.
create temporary table wt_goal as select gen_random_uuid() as id;
grant select on wt_goal to authenticated, anon;
insert into public.work_goals(id, org_unit_id, period_kind, period_start, title, target_value, unit, created_by)
  select (select id from wt_goal), u2, 'month', date_trunc('month', today)::date, 'Xong việc chỉ đạo tháng này', 1, 'việc', pg_temp.p('bld') from wt_refs;
insert into public.work_goal_tasks(goal_id, task_id, added_by) select (select id from wt_goal), id, pg_temp.p('bld') from wt_tasks where name = 'x';
set local session_replication_role = 'origin';
create function pg_temp.t(p_name text) returns uuid language sql as $$ select id from wt_tasks where name = p_name $$;

-- ── 1. Sổ chỉ đạo theo đơn vị: việc xong thuộc đơn vị người làm cuối ──────────────────────────────────
do $$ declare r jsonb; x jsonb; begin
  perform pg_temp.as_('bld');
  r := public.work_directives_v1(pg_temp.u('u2'), pg_temp.d(-7), pg_temp.d(7));
  select e into x from jsonb_array_elements(r) e where e->>'id' = pg_temp.t('x')::text;
  perform pg_temp.ok(x->>'bucket' = 'done' and x->'assignees' = jsonb_build_array(jsonb_build_object('name', 'Lã Văn Đông', 'unit', 'WDLA-U2')),
    'U2: x ở nhóm Xong, người làm = b: '||coalesce(x::text, 'không có x — '||r::text));
  perform pg_temp.ok((select count(*) filter (where e->>'bucket' = 'done') = 1 and count(*) filter (where e->>'bucket' = 'doing') = 1
      and bool_and(e->>'id' in (pg_temp.t('x')::text, pg_temp.t('w')::text)) from jsonb_array_elements(r) e),
    'U2: 1 xong (x) + 1 đang làm (w): '||r::text);
  r := public.work_directives_v1(pg_temp.u('u1'), pg_temp.d(-7), pg_temp.d(7));
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r->0->>'id' = pg_temp.t('z')::text and r->0->>'bucket' = 'doing',
    'U1: chỉ z — việc đã chuyển đi (x, w) không thuộc U1: '||r::text);
  -- Không truyền kỳ: nhóm Xong từ đầu tháng — x xong hôm qua (cùng tháng trừ ngày 1) vẫn hiện.
  r := public.work_directives_v1(pg_temp.u('u2'));
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r) e where e->>'id' = pg_temp.t('w')::text)
    and ((select today from wt_refs) = date_trunc('month', (select today from wt_refs))::date
      or exists (select 1 from jsonb_array_elements(r) e where e->>'id' = pg_temp.t('x')::text and e->>'bucket' = 'done')),
    'U2 không kỳ: '||r::text);
end $$;

-- ── 2. Toàn công ty / Phòng tôi: tính cho người làm cuối, không tính người đã chuyển đi ──────────────
do $$ declare b jsonb; u1 jsonb; u2 jsonb; m jsonb; begin
  perform pg_temp.as_('bld');
  b := public.work_company_board_v1(null, pg_temp.d(-7), pg_temp.d(7));
  select e into u1 from jsonb_array_elements(b->'units') e where e->>'id' = pg_temp.u('u1')::text;
  select e into u2 from jsonb_array_elements(b->'units') e where e->>'id' = pg_temp.u('u2')::text;
  perform pg_temp.ok((u2->'directives'->>'doneInPeriod')::int = 1 and (u2->'directives'->>'open')::int = 1
      and (u2->>'due')::int = 2 and (u2->>'ontime')::int = 1 and (u2->>'active')::int = 1,
    'U2: chỉ đạo xong trong kỳ 1, đến hạn 2 (x, w), đúng hạn 1: '||coalesce(u2::text, 'null'));
  perform pg_temp.ok((u1->'directives'->>'doneInPeriod')::int = 0 and (u1->'directives'->>'open')::int = 1
      and (u1->>'due')::int = 1 and (u1->>'ontime')::int = 0 and (u1->>'active')::int = 1,
    'U1: chỉ z (a đã chuyển x, w đi): '||coalesce(u1::text, 'null'));

  b := public.work_team_board_v1(pg_temp.u('u2'), null, pg_temp.d(-7), pg_temp.d(7));
  select e into m from jsonb_array_elements(b->'members') e where e->>'userId' = pg_temp.p('b')::text;
  perform pg_temp.ok((m->>'due')::int = 2 and (m->>'ontime')::int = 1 and (m->>'active')::int = 1, 'Phòng tôi U2 — b: '||coalesce(m::text, b::text));
  b := public.work_team_board_v1(pg_temp.u('u1'), null, pg_temp.d(-7), pg_temp.d(7));
  select e into m from jsonb_array_elements(b->'members') e where e->>'userId' = pg_temp.p('a')::text;
  perform pg_temp.ok((m->>'due')::int = 1 and (m->>'ontime')::int = 0 and (m->>'active')::int = 1, 'Phòng tôi U1 — a: '||coalesce(m::text, b::text));
end $$;

-- ── 3. Bản tin / báo cáo kỳ theo đơn vị ──────────────────────────────────────────────────────────────
do $$ declare r jsonb; begin
  r := app_private.work_period_digest(pg_temp.u('u2'), pg_temp.d(-7), pg_temp.d(7));
  perform pg_temp.ok(r->'directives' = '{"open":1,"late":0,"done":1}'::jsonb
    and r->'lines' @> jsonb_build_array('Chỉ đạo: 1 đang mở · 0 trễ · 1 xong trong kỳ'), 'bản tin U2: '||r::text);
  r := app_private.work_period_digest(pg_temp.u('u1'), pg_temp.d(-7), pg_temp.d(7));
  perform pg_temp.ok(r->'directives' = '{"open":1,"late":0,"done":0}'::jsonb, 'bản tin U1: '||(r->'directives')::text);
  -- Số người trong bản tin khớp Phòng tôi (đến hạn tính tới hôm nay ⇒ x hạn ngày mai chưa tính).
  perform pg_temp.ok((r->>'due')::int = 0 and (r->>'overdue')::int = 0, 'bản tin U1 đến hạn: '||r::text);
end $$;

-- ── 4. Việc của tôi + Tra việc + Việc của mục tiêu ───────────────────────────────────────────────────
do $$ declare r jsonb; begin
  perform pg_temp.as_('b');
  r := public.work_my_board_v1(null, pg_temp.d(-7), pg_temp.d(7));
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r->'tasks') e where e->>'id' = pg_temp.t('x')::text and e->>'status' = 'completed')
      and (r->'period'->>'due')::int = 2 and (r->'period'->>'ontime')::int = 1, 'Việc của tôi — b thấy x đã xong: '||r::text);
  perform pg_temp.as_('a');
  r := public.work_my_board_v1(null, pg_temp.d(-7), pg_temp.d(7));
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(r->'tasks') e where e->>'id' in (pg_temp.t('x')::text, pg_temp.t('w')::text))
      and (r->'period'->>'due')::int = 1 and (r->'period'->>'ontime')::int = 0, 'Việc của tôi — a không còn x, w: '||r::text);

  perform pg_temp.as_('bld');
  r := public.work_tasks_overview_v1(null, 'WDLA-U2', 'done_recent');
  perform pg_temp.ok((r->>'total')::int = 1 and r->'items'->0->>'id' = pg_temp.t('x')::text
    and r->'items'->0->'assignees' = jsonb_build_array(jsonb_build_object('userId', pg_temp.p('b'), 'name', 'Lã Văn Đông')),
    'Tra việc U2 xong gần đây: '||r::text);
  r := public.work_tasks_overview_v1(null, 'WDLA-U1', 'done_recent');
  perform pg_temp.ok((r->>'total')::int = 0, 'Tra việc U1 xong gần đây: '||r::text);
  r := public.work_tasks_overview_v1(pg_temp.p('a'), null, 'all');
  perform pg_temp.ok((r->>'total')::int = 1 and r->'items'->0->>'id' = pg_temp.t('z')::text, 'Tra việc theo a: '||r::text);
  r := public.work_tasks_overview_v1(pg_temp.p('b'), null, 'due', pg_temp.d(7), 30, pg_temp.d(-7));
  perform pg_temp.ok((r->>'total')::int = 2, 'Tra việc theo b đến hạn trong kỳ (x, w): '||r::text);

  r := public.work_goal_tasks_v1((select id from wt_goal));
  perform pg_temp.ok(r->'items'->0->'assignees' = jsonb_build_array(jsonb_build_object('userId', pg_temp.p('b'), 'name', 'Lã Văn Đông')),
    'Việc của mục tiêu: người làm cuối = b: '||r::text);
end $$;
