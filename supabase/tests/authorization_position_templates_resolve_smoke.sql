-- Every position template, given to a real employee, is recognised item by item by the server.
-- Read-only in effect: grants are written inside the transaction and rolled back.
begin;

create temporary table tpl_persona on commit drop as
select u.id, u.auth_id, u.email from public.users u
where u.is_active and u.account_status = 'ACTIVE' and u.role = 'EMPLOYEE' and u.auth_id is not null
  and not exists (select 1 from public.principal_role_assignments a where a.principal_id = u.id and a.status = 'ACTIVE')
order by u.created_at limit 1;

create temporary table tpl_result (template_code text, permission_code text, scope_type text, ok boolean) on commit drop;

do $$
declare p record; t record; i record; v_scope_id text;
begin
  select * into p from tpl_persona;
  if p.id is null then raise exception 'fixture missing: plain employee'; end if;
  for t in select code, items from public.user_permission_templates where is_active order by sort_order loop
    -- exactly this template, nothing else
    update public.user_permission_grants set is_active = false, revoked_at = now() where user_id = p.id and is_active;
    insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_at, expires_at)
    select p.id, x."permissionCode", x."scopeType", '*', true, now(),
      case when x."expiresInDays" is not null then now() + make_interval(days => x."expiresInDays") end
    from jsonb_to_recordset(t.items) x("permissionCode" text, "scopeType" text, "expiresInDays" int)
    on conflict (user_id, permission_code, scope_type, scope_id) do update
      set is_active = true, revoked_at = null, expires_at = excluded.expires_at;
    for i in select x."permissionCode" code, x."scopeType" scope from jsonb_to_recordset(t.items) x("permissionCode" text, "scopeType" text) loop
      v_scope_id := case when i.scope = 'own' then p.id::text else '*' end;
      insert into tpl_result values (t.code, i.code, i.scope, app_private.has_permission(p.id, i.code, i.scope, v_scope_id));
    end loop;
  end loop;
end $$;

do $$
declare v_bad text;
begin
  select string_agg(template_code || ':' || permission_code || '@' || scope_type, ', ') into v_bad
  from (select * from tpl_result where not ok order by 1, 2 limit 30) x;
  if v_bad is not null then raise exception 'template items not recognised: %', v_bad; end if;
end $$;

select jsonb_build_object('templates', count(distinct template_code), 'items', count(*), 'recognised', count(*) filter (where ok)) r from tpl_result;
rollback;
