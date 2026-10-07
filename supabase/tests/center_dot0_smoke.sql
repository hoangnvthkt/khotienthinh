-- Trung tâm điều hành PR-A. Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261008138000_center_dot0_foundation.sql --smoke supabase/tests/center_dot0_smoke.sql
-- Persona: pilot (quyền + bật), viewer (chỉ quyền truy cập + bật), granted (quyền, chưa bật),
-- expired (quyền, hết hạn bật), outsider (được bật nhưng không có quyền).
create temporary table center_test_people(name text primary key, id uuid default gen_random_uuid(),
  email text default ('center-test-'||gen_random_uuid()||'@invalid.local'));
insert into center_test_people(name) values ('pilot'),('viewer'),('granted'),('expired'),('outsider');
insert into public.users(id,name,username,email,role)
  select id,'Center rollback '||name,'center-'||id,email,'EMPLOYEE'::public.user_role from center_test_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select id,'center.module.access','global','*','Center rollback test' from center_test_people where name<>'outsider';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select id,'center.layout.manage','own','*','Center rollback test' from center_test_people where name in ('pilot','granted','expired');
grant select on center_test_people to authenticated, anon;

create function pg_temp.center_as(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text
    from center_test_people where name = p_name), true);
end $$;
create function pg_temp.center_assert(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'Center test failed: %', message; end if;
end $$;

-- Bật theo người: bắt buộc lý do, có hạn, ghi audit_trail.
do $$ begin
  begin
    insert into app_private.center_rollout_actors(user_id,expires_at,reason)
      select id, now()+interval '30 days', ' ' from center_test_people where name='pilot';
    raise exception 'Unexpected rollout without reason';
  exception when check_violation then null; end;
  begin
    insert into app_private.center_rollout_actors(user_id,starts_at,expires_at,reason)
      select id, now(), now()-interval '1 day', 'ngược hạn' from center_test_people where name='pilot';
    raise exception 'Unexpected rollout ending before start';
  exception when check_violation then null; end;
end $$;
insert into app_private.center_rollout_actors(user_id,expires_at,reason)
  select id, now()+interval '30 days', 'Thí điểm PR-A' from center_test_people where name in ('pilot','viewer','outsider');
insert into app_private.center_rollout_actors(user_id,starts_at,expires_at,reason)
  select id, now()-interval '2 days', now()-interval '1 day', 'Đã hết hạn' from center_test_people where name='expired';
do $$ begin
  perform pg_temp.center_assert((select count(*) from public.audit_trail a join center_test_people p on a.record_id=p.id::text
    where a.table_name='center_rollout_actors' and a.module='CENTER' and a.action='INSERT' and a.context->>'reason' is not null)=4,
    'every rollout insert is audited with its reason');
  begin
    update app_private.center_rollout_actors set mode='read_only' where user_id=(select id from center_test_people where name='pilot');
    raise exception 'Unexpected rollout change without a new reason';
  exception when invalid_parameter_value then null; end;
  perform set_config('app.center_rollout_reason','Chuyển chỉ xem để thử',true);
  update app_private.center_rollout_actors set mode='read_only' where user_id=(select id from center_test_people where name='pilot');
  perform set_config('app.center_rollout_reason','',true);
  update app_private.center_rollout_actors set mode='on', reason='Bật lại đầy đủ' where user_id=(select id from center_test_people where name='pilot');
  perform pg_temp.center_assert((select count(*) from public.audit_trail a join center_test_people p on a.record_id=p.id::text
    where a.table_name='center_rollout_actors' and p.name='pilot' and a.action='UPDATE')=2, 'rollout updates are audited');
end $$;

set local role authenticated;

select pg_temp.center_as('pilot');
do $$ declare r jsonb; begin
  r := public.get_center_access_v1();
  perform pg_temp.center_assert((r->>'enabled')::boolean and r->>'mode'='on', 'pilot is enabled: '||r::text);
  r := public.get_center_layout_v1();
  perform pg_temp.center_assert((r->>'version')::int=0 and r->'layout'='{}'::jsonb and (r->>'canManage')::boolean, 'empty default layout: '||r::text);
  r := public.save_center_layout_v1('{"widgets":["project","hrm"]}');
  perform pg_temp.center_assert((r->>'version')::int=1, 'first save creates version 1');
  r := public.save_center_layout_v1('{"widgets":["hrm"],"inboxHidden":true}');
  perform pg_temp.center_assert((r->>'version')::int=2, 'second save bumps version');
  r := public.get_center_layout_v1();
  perform pg_temp.center_assert(r->'layout'='{"widgets":["hrm"],"inboxHidden":true}'::jsonb, 'layout reads back');
  begin perform public.save_center_layout_v1('["hrm"]'); raise exception 'Unexpected array layout';
  exception when invalid_parameter_value then null; end;
  begin perform public.save_center_layout_v1(jsonb_build_object('pad', repeat('x', 17000))); raise exception 'Unexpected oversize layout';
  exception when invalid_parameter_value then null; end;
  begin perform count(*) from public.center_user_layouts; raise exception 'Unexpected direct table read';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from app_private.center_rollout_actors; raise exception 'Unexpected rollout table read';
  exception when insufficient_privilege then null; end;
end $$;

select pg_temp.center_as('viewer');
do $$ declare r jsonb; begin
  r := public.get_center_layout_v1();
  perform pg_temp.center_assert(not (r->>'canManage')::boolean, 'viewer cannot manage layout');
  begin perform public.save_center_layout_v1('{}'); raise exception 'Unexpected viewer layout save';
  exception when insufficient_privilege then null; end;
end $$;

select pg_temp.center_as('granted');
do $$ declare r jsonb; begin
  r := public.get_center_access_v1();
  perform pg_temp.center_assert(not (r->>'enabled')::boolean and r->>'reason'='not_in_rollout', 'granted but not enabled: '||r::text);
  begin perform public.get_center_layout_v1(); raise exception 'Unexpected layout read outside rollout';
  exception when insufficient_privilege then null; end;
  begin perform public.save_center_layout_v1('{}'); raise exception 'Unexpected layout save outside rollout';
  exception when insufficient_privilege then null; end;
end $$;

select pg_temp.center_as('expired');
do $$ declare r jsonb; begin
  r := public.get_center_access_v1();
  perform pg_temp.center_assert(not (r->>'enabled')::boolean and r->>'reason'='not_in_rollout', 'expired rollout is off: '||r::text);
  begin perform public.save_center_layout_v1('{}'); raise exception 'Unexpected layout save after expiry';
  exception when insufficient_privilege then null; end;
end $$;

select pg_temp.center_as('outsider');
do $$ declare r jsonb; begin
  r := public.get_center_access_v1();
  perform pg_temp.center_assert(not (r->>'enabled')::boolean and r->>'reason'='no_permission', 'rollout alone is not access: '||r::text);
  begin perform public.get_center_layout_v1(); raise exception 'Unexpected layout read without permission';
  exception when insufficient_privilege then null; end;
end $$;

set local role anon;
do $$ begin
  begin perform public.get_center_access_v1(); raise exception 'Unexpected anonymous access';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select 'center_dot0_smoke ok' as result;
