-- Run after asset_audit_sessions. Rolls back.
begin;

create temporary table aa_ctx on commit drop as
select u.id, u.auth_id, u.email,
  (select a.id from public.users a where a.role = 'ADMIN' and a.is_active and a.account_status = 'ACTIVE' and a.auth_id is not null order by a.created_at limit 1) admin_id
from public.users u
where u.is_active and u.account_status = 'ACTIVE' and u.role = 'EMPLOYEE' and u.auth_id is not null
  and not exists (select 1 from public.user_permission_grants g where g.user_id = u.id and g.permission_code like 'asset.audit.%' and g.is_active)
order by u.created_at limit 1;
create temporary table aa_out (k text, v text) on commit drop;
grant select on aa_ctx to authenticated;
grant all on aa_out to authenticated;

create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $f$
declare u record;
begin
  select auth_id, email into u from public.users where id = p_user;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u.auth_id, 'email', u.email, 'role', 'authenticated')::text, true);
end $f$;

create or replace function pg_temp.try(p_label text, p_sql text) returns void language plpgsql as $f$
declare v_state text;
begin
  execute p_sql;
  insert into aa_out values (p_label, 'ok');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  insert into aa_out values (p_label, v_state);
end $f$;

-- one existing audit (by an Admin) so readers have something to see
do $d$ declare c aa_ctx%rowtype; begin
  select * into c from aa_ctx;
  if c.id is null or c.admin_id is null then raise exception 'fixture missing'; end if;
  perform pg_temp.as_user(c.admin_id);
  execute 'set local role authenticated';
  insert into public.asset_audit_sessions (auditor_user_id, auditor_name, items, total_items, total_good, total_damaged, total_lost, total_wrong_location)
  values (c.admin_id, 'Admin', '[{"assetId":"a1","actualCondition":"good"}]'::jsonb, 1, 1, 0, 0, 0);
  execute 'reset role';
end $d$;

-- 1. No asset audit permission: sees nothing, cannot record.
do $d$ declare c aa_ctx%rowtype; n int; begin
  select * into c from aa_ctx;
  perform pg_temp.as_user(c.id);
  execute 'set local role authenticated';
  select count(*) into n from public.asset_audit_sessions; insert into aa_out values ('none:read', n::text);
  perform pg_temp.try('none:insert', $$insert into public.asset_audit_sessions (auditor_user_id, auditor_name, items, total_items, total_good, total_damaged, total_lost, total_wrong_location)
    select id, 'x', '[{"assetId":"a1","actualCondition":"good"}]'::jsonb, 1, 1, 0, 0, 0 from aa_ctx$$);
  execute 'reset role';
end $d$;

-- 2. View only: reads history, cannot record.
insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_at)
select id, 'asset.audit.view', 'global', '*', true, now() from aa_ctx;
do $d$ declare c aa_ctx%rowtype; n int; begin
  select * into c from aa_ctx;
  perform pg_temp.as_user(c.id);
  execute 'set local role authenticated';
  select count(*) into n from public.asset_audit_sessions; insert into aa_out values ('view:read', n::text);
  perform pg_temp.try('view:insert', $$insert into public.asset_audit_sessions (auditor_user_id, auditor_name, items, total_items, total_good, total_damaged, total_lost, total_wrong_location)
    select id, 'x', '[{"assetId":"a1","actualCondition":"good"}]'::jsonb, 1, 1, 0, 0, 0 from aa_ctx$$);
  execute 'reset role';
end $d$;

-- 3. Perform: records; auditor is forced to the signed-in person; bad totals refused; no edit, no delete.
insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_at, expires_at)
select id, 'asset.audit.perform', 'global', '*', true, now(), now() + interval '30 days' from aa_ctx;
do $d$ declare c aa_ctx%rowtype; v_row public.asset_audit_sessions; begin
  select * into c from aa_ctx;
  perform pg_temp.as_user(c.id);
  execute 'set local role authenticated';
  insert into public.asset_audit_sessions (auditor_user_id, auditor_name, items, total_items, total_good, total_damaged, total_lost, total_wrong_location)
  values (c.admin_id, 'Giả mạo', '[{"assetId":"a1","actualCondition":"good"},{"assetId":"a2","actualCondition":"lost"}]'::jsonb, 2, 1, 0, 1, 0)
  returning * into v_row;
  insert into aa_out values ('perform:auditor_is_self', (v_row.auditor_user_id = c.id and v_row.auditor_name <> 'Giả mạo')::text);
  perform pg_temp.try('perform:bad_totals', $$insert into public.asset_audit_sessions (auditor_user_id, auditor_name, items, total_items, total_good, total_damaged, total_lost, total_wrong_location)
    select id, 'x', '[{"assetId":"a1","actualCondition":"good"}]'::jsonb, 1, 0, 0, 0, 0 from aa_ctx$$);
  perform pg_temp.try('perform:update', $$update public.asset_audit_sessions set note = 'sửa' where true$$);
  insert into aa_out select 'perform:update_rows', count(*)::text from public.asset_audit_sessions where note = 'sửa';
  perform pg_temp.try('perform:delete', $$delete from public.asset_audit_sessions where true$$);
  insert into aa_out select 'perform:rows_after_delete', count(*)::text from public.asset_audit_sessions;
  execute 'reset role';
end $d$;

do $d$ declare r jsonb; begin
  select jsonb_object_agg(k, v) into r from aa_out;
  if (r ->> 'none:read') <> '0' or r ->> 'none:insert' = 'ok' then raise exception 'no-permission user saw or wrote audits: %', r; end if;
  if (r ->> 'view:read')::int < 1 or r ->> 'view:insert' = 'ok' then raise exception 'view-only user wrong: %', r; end if;
  if r ->> 'perform:auditor_is_self' <> 'true' then raise exception 'auditor not stamped from the account: %', r; end if;
  if r ->> 'perform:bad_totals' = 'ok' then raise exception 'inconsistent totals accepted: %', r; end if;
  if (r ->> 'perform:update_rows') <> '0' then raise exception 'an audit was edited: %', r; end if;
  if (r ->> 'perform:rows_after_delete')::int < 2 then raise exception 'a non-admin deleted an audit: %', r; end if;
end $d$;
rollback;
