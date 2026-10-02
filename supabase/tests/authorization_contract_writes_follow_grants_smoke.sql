-- Run after authorization_contract_writes_follow_grants. Rolls back.
begin;

create temporary table hd_context (emp_id uuid, emp_auth uuid, emp_email text, project_id text) on commit drop;
grant select on hd_context to authenticated;
create temporary table hd_out (k text, v text) on commit drop;
grant all on hd_out to authenticated;

insert into hd_context
select u.id, u.auth_id, u.email, (select id from public.projects order by created_at desc limit 1)
from public.users u
where u.is_active and u.account_status = 'ACTIVE' and u.role = 'EMPLOYEE' and u.auth_id is not null
  and not exists (select 1 from public.user_permission_grants g where g.user_id = u.id and g.permission_code like 'contract.%.manage' and g.is_active)
order by u.created_at limit 1;

create or replace function pg_temp.try(p_label text, p_sql text) returns void language plpgsql as $f$
declare v_err text;
begin
  execute p_sql;
  insert into hd_out values (p_label, 'ok');
exception when others then
  get stacked diagnostics v_err = returned_sqlstate;
  insert into hd_out values (p_label, v_err);
end $f$;

create or replace function pg_temp.as_employee(p_phase text) returns void language plpgsql as $f$
declare c hd_context%rowtype;
begin
  select * into c from hd_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', c.emp_auth, 'email', c.emp_email, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform pg_temp.try(p_phase || ':partner', format(
    $$insert into public.business_partners (id, code, name, classifications, is_active) values (%L, %L, 'Smoke partner', array['contractor'], true)$$,
    gen_random_uuid()::text, 'SMOKE-' || p_phase));
  perform pg_temp.try(p_phase || ':customer', format(
    $$insert into public.customer_contracts (id, code, name, customer_name, project_id, value, currency, status) values (%L, %L, 'Smoke', 'Smoke owner', %L, 1, 'VND', 'draft')$$,
    gen_random_uuid()::text, 'SMOKE-KH-' || p_phase, c.project_id));
  perform pg_temp.try(p_phase || ':subcontract', format(
    $$insert into public.subcontractor_contracts (id, code, name, subcontractor_name, project_id, value, currency, status, attachments) values (%L, %L, 'Smoke', 'Smoke sub', %L, 1, 'VND', 'draft', '[]'::jsonb)$$,
    gen_random_uuid()::text, 'SMOKE-TP-' || p_phase, c.project_id));
  execute 'reset role';
end $f$;

-- 1. View-only employee: every write refused.
select pg_temp.as_employee('none');

-- 2. Partner manager only: partners yes, contracts no.
insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_at)
select emp_id, 'contract.partner.manage', 'global', '*', true, now() from hd_context;
select pg_temp.as_employee('partner');

-- 3. Plus supplier manager: subcontracts yes, customer contracts still no.
insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_at)
select emp_id, 'contract.supplier.manage', 'global', '*', true, now() from hd_context;
select pg_temp.as_employee('supplier');

do $$
declare r jsonb;
begin
  if not exists (select 1 from hd_context where emp_id is not null) then raise exception 'fixture missing'; end if;
  select jsonb_object_agg(k, v) into r from hd_out;
  if r ->> 'none:partner' = 'ok' or r ->> 'none:customer' = 'ok' or r ->> 'none:subcontract' = 'ok' then
    raise exception 'view-only employee could write: %', r;
  end if;
  if r ->> 'partner:partner' <> 'ok' then raise exception 'partner manager cannot add a partner: %', r; end if;
  if r ->> 'partner:subcontract' = 'ok' or r ->> 'partner:customer' = 'ok' then raise exception 'partner manager wrote a contract: %', r; end if;
  if r ->> 'supplier:subcontract' <> 'ok' then raise exception 'supplier manager cannot add a subcontract: %', r; end if;
  if r ->> 'supplier:customer' = 'ok' then raise exception 'supplier manager wrote a customer contract: %', r; end if;
end $$;

rollback;
