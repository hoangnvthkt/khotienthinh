-- Bảng điều khiển — chứng từ của từng chỉ số (get_center_metric_docs_v1). Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261010150000_center_metric_docs.sql \
--   --smoke supabase/tests/center_metric_docs_smoke.sql
-- Kiểm: với Admin, mọi chỉ số tiền của mỗi dự án = tổng chứng từ (cùng dự án, có liên kết mở chứng từ); số theo tháng khớp;
-- Mua hàng (không xem tiền) bị chặn; tham số lạ bị từ chối.
create temporary table cmd_test_people(name text primary key, id uuid default gen_random_uuid(),
  email text default ('cmd-test-'||gen_random_uuid()||'@invalid.local'), role text);
insert into cmd_test_people(name, role) values ('boss', 'ADMIN'), ('buyer', 'EMPLOYEE');
insert into public.users(id, name, username, email, role)
  select id, 'Docs rollback '||name, 'cmd-'||id, email, role::public.user_role from cmd_test_people;
insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_at)
  select id, 'system.procurement.view', 'global', '*', true, now() from cmd_test_people where name = 'buyer';
grant select on cmd_test_people to authenticated, anon;

create function pg_temp.cmd_as(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text
    from cmd_test_people where name = p_name), true);
end $$;
create function pg_temp.cmd_assert(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'Metric docs test failed: %', message; end if;
end $$;

select pg_temp.cmd_assert(not has_function_privilege('anon', 'public.get_center_metric_docs_v1(text, text, text, text)', 'execute'), 'anon cannot read documents');

set local role authenticated;

select pg_temp.cmd_as('boss');
do $$ declare r jsonb; p jsonb; f jsonb; d jsonb; k record; checked int := 0; m jsonb; t0 timestamptz := clock_timestamp(); begin
  r := public.get_center_dashboard_v1();
  for p in select value from jsonb_array_elements(r -> 'projects') where jsonb_typeof(value -> 'finance') = 'object' loop
    f := p -> 'finance';
    for k in select * from (values
        ('contract', f ->> 'contractValue'), ('budget', f ->> 'budget'), ('accepted', f ->> 'accepted'), ('received', f ->> 'received'), ('cost', f ->> 'cost'),
        ('ar_requested', f -> 'ar' ->> 'requested'), ('ar_outstanding', f -> 'ar' ->> 'outstanding'), ('ar_overdue', f -> 'ar' ->> 'overdue'),
        ('ar_retention', f -> 'ar' ->> 'retention'), ('ar_advance', f -> 'ar' ->> 'advance'), ('ar_recovered', f -> 'ar' ->> 'advanceRecovered'),
        ('ap_requested', f -> 'ap' ->> 'requested'), ('ap_outstanding', f -> 'ap' ->> 'outstanding'), ('ap_overdue', f -> 'ap' ->> 'overdue'),
        ('ap_retention', f -> 'ap' ->> 'retention'), ('ap_paid', f -> 'ap' ->> 'paid'), ('ap_advance', f -> 'ap' ->> 'advance'),
        ('sub_total', f -> 'ap' -> 'subcontract' ->> 'total'), ('sub_paid', f -> 'ap' -> 'subcontract' ->> 'paid'),
        ('sup_total', f -> 'ap' -> 'supplier' ->> 'total'), ('sup_paid', f -> 'ap' -> 'supplier' ->> 'paid')) v(metric, board) loop
      d := public.get_center_metric_docs_v1(k.metric, p ->> 'id');
      perform pg_temp.cmd_assert(abs(coalesce((d ->> 'total')::numeric, 0) - coalesce(k.board::numeric, 0)) < 1,
        k.metric || ' documents add up to the board for ' || (p ->> 'code') || ': ' || coalesce(k.board, 'null') || ' vs ' || (d ->> 'total'));
      perform pg_temp.cmd_assert(not exists (select 1 from jsonb_array_elements(d -> 'rows') x
        where x.value ->> 'projectId' <> p ->> 'id' or x.value ->> 'linkType' is null or x.value ->> 'linkId' is null), k.metric || ' rows link to a document');
      checked := checked + 1;
    end loop;
    -- Chi phí theo nhóm.
    for k in select key, value from jsonb_each_text(f -> 'costByCategory') loop
      d := public.get_center_metric_docs_v1('cost', p ->> 'id', null, k.key);
      perform pg_temp.cmd_assert(abs((d ->> 'total')::numeric - k.value::numeric) < 1, 'cost ' || k.key || ' documents add up for ' || (p ->> 'code'));
    end loop;
  end loop;
  -- Theo tháng: doanh thu, chi phí, tiền vào, tiền ra.
  for m in select value from jsonb_array_elements(r -> 'months') where (value ->> 'cost')::numeric > 0 or (value ->> 'revenue')::numeric > 0 limit 6 loop
    for k in select * from (values ('accepted', m ->> 'revenue'), ('cost', m ->> 'cost'), ('cash_in', m ->> 'cashIn'), ('cash_out', m ->> 'cashOut')) v(metric, board) loop
      d := public.get_center_metric_docs_v1(k.metric, m ->> 'projectId', m ->> 'month');
      perform pg_temp.cmd_assert(abs((d ->> 'total')::numeric - k.board::numeric) < 1, k.metric || ' for month ' || (m ->> 'month') || ' adds up: ' || k.board || ' vs ' || (d ->> 'total'));
    end loop;
  end loop;
  perform pg_temp.cmd_assert(checked > 0, 'at least one project with money was checked');
  perform pg_temp.cmd_assert(clock_timestamp() - t0 < interval '60 seconds', 'all checks run in reasonable time');
  begin
    perform public.get_center_metric_docs_v1('nope');
    raise exception 'unknown metric must be rejected';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Mua hàng: không xem tiền dự án → không đọc được chứng từ tiền.
select pg_temp.cmd_as('buyer');
do $$ declare r jsonb; pid text; begin
  r := public.get_center_dashboard_v1();
  pid := r -> 'projects' -> 0 ->> 'id';
  perform pg_temp.cmd_assert(public.get_center_metric_docs_v1('cost') -> 'rows' = '[]'::jsonb, 'buyer sees no money documents');
  if pid is not null then
    begin
      perform public.get_center_metric_docs_v1('cost', pid);
      raise exception 'buyer must not read a project''s money documents';
    exception when insufficient_privilege then null;
    end;
  end if;
end $$;
