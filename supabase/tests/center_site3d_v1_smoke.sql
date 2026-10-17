-- Công trường 3D: vcc_site3d_v1 + kho site-models. Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261017220000_center_site3d_v1.sql \
--   --smoke supabase/tests/center_site3d_v1_smoke.sql
-- Persona: boss (Admin) · viewer (center.site3d.view) · plain (vào Center, không có quyền) · nocenter.
-- Đọc số liệu thật của DA29 / SMB-2026 (chỉ đọc), không chèn dữ liệu nghiệp vụ.
create temporary table s3d_people(name text primary key, id uuid default gen_random_uuid(),
  email text default ('s3d-test-'||gen_random_uuid()||'@invalid.local'), role text default 'EMPLOYEE');
insert into s3d_people(name, role) values ('boss','ADMIN'),('viewer','EMPLOYEE'),('plain','EMPLOYEE'),('nocenter','EMPLOYEE');
insert into public.users(id,name,username,email,role)
  select id,'S3D rollback '||name,'s3d-'||id,email,role::public.user_role from s3d_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select id,'center.module.access','global','*','S3D rollback test' from s3d_people where name <> 'nocenter';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select id,'center.site3d.view','global','*','S3D rollback test' from s3d_people where name = 'viewer';
insert into app_private.center_rollout_actors(user_id,expires_at,reason)
  select id, now()+interval '1 day', 'Thử Công trường 3D' from s3d_people where name <> 'nocenter';
grant select on s3d_people to authenticated, anon;

create function pg_temp.s3d_as(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text
    from s3d_people where name = p_name), true);
end $$;
create function pg_temp.s3d_assert(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'Site3D test failed: %', message; end if;
end $$;

-- Kho riêng tư, có đủ chính sách.
do $$ begin
  perform pg_temp.s3d_assert((select not public from storage.buckets where id = 'site-models'), 'bucket private');
  perform pg_temp.s3d_assert((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'site_models_%') = 4, '4 policies');
end $$;

set local role authenticated;

select pg_temp.s3d_as('nocenter');
do $$ begin perform pg_temp.s3d_assert(public.vcc_site3d_v1() ->> 'reason' = 'no_center', 'nocenter'); end $$;

select pg_temp.s3d_as('plain');
do $$ declare r jsonb := public.vcc_site3d_v1('DA29'); begin
  perform pg_temp.s3d_assert(r ->> 'access' = 'false' and r ->> 'reason' = 'no_permission', 'plain denied: ' || r::text);
  perform pg_temp.s3d_assert(not app_private.site3d_can_view_v1(public.current_app_user_id()), 'plain cannot read models');
end $$;

select pg_temp.s3d_as('viewer');
do $$ declare r jsonb := public.vcc_site3d_v1(); d jsonb; s jsonb; begin
  perform pg_temp.s3d_assert(r ->> 'access' = 'true' and r ->> 'canManage' = 'false', 'viewer access, no manage: ' || r::text);
  perform pg_temp.s3d_assert(exists (select 1 from jsonb_array_elements(r -> 'projects') p where p ->> 'code' = 'DA29'), 'project list has DA29');
  perform pg_temp.s3d_assert(app_private.site3d_can_view_v1(public.current_app_user_id()), 'viewer can read models');
  d := public.vcc_site3d_v1('DA29');
  perform pg_temp.s3d_assert(d -> 'project' ->> 'code' = 'DA29' and jsonb_array_length(d -> 'tasks') > 300, 'DA29 tasks: ' || jsonb_array_length(d -> 'tasks'));
  perform pg_temp.s3d_assert(jsonb_typeof(d -> 'series') = 'object' and jsonb_array_length(d -> 'logs') > 50, 'DA29 series/logs');
  perform pg_temp.s3d_assert((select count(*) from (select l ->> 0 from jsonb_array_elements(d -> 'logs') l group by 1 having count(*) > 1) x) = 0, 'one log per day');
  perform pg_temp.s3d_assert(exists (select 1 from jsonb_array_elements(d -> 'stock') st where st ->> 0 like 'Cọc ly tâm%'), 'DA29 stock');
  perform pg_temp.s3d_assert(exists (select 1 from jsonb_array_elements(d -> 'tasks') t where t ->> 0 = '4.3.1'), 'has 4.3.1');
  s := public.vcc_site3d_v1('SMB-2026');
  perform pg_temp.s3d_assert(jsonb_array_length(s -> 'tasks') > 300 and jsonb_array_length(s -> 'stock') > 20, 'SMB data');
  perform pg_temp.s3d_assert(public.vcc_site3d_v1('NOPE-X') ->> 'reason' = 'not_found', 'not found');
end $$;

select pg_temp.s3d_as('boss');
do $$ begin perform pg_temp.s3d_assert(public.vcc_site3d_v1() ->> 'canManage' = 'true', 'admin can manage'); end $$;

-- ── Đo nhanh: thời gian và cỡ JSON ──
create function pg_temp.s3d_measure() returns table(code text, ms numeric, tasks int, series int, logs int, stock int, json_bytes int)
language plpgsql as $$ declare t0 timestamptz; r jsonb; c text; begin
  foreach c in array array['DA29', 'SMB-2026'] loop
    t0 := clock_timestamp(); r := public.vcc_site3d_v1(c);
    return query select c, round(extract(epoch from clock_timestamp() - t0) * 1000), jsonb_array_length(r -> 'tasks'),
      (select count(*)::int from jsonb_object_keys(r -> 'series')), jsonb_array_length(r -> 'logs'), jsonb_array_length(r -> 'stock'), octet_length(r::text);
  end loop;
end $$;
select * from pg_temp.s3d_measure();
