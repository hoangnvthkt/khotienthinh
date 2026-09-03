begin;

create or replace function app_private.has_governed_hrm_permission(
  p_user_id uuid,
  p_permission_code text,
  p_scope_type text default 'global',
  p_scope_id text default '*'
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      p_user_id, p_permission_code, p_scope_type, p_scope_id, now()
    ) source_row
    where not (
      source_row.permission_code like 'hrm.%'
      and source_row.source_type = 'LEGACY'
    )
    and (
      not app_private.is_hrm_template_only_permission(source_row.permission_code)
      or (source_row.source_type = 'ROLE' and source_row.source_code in ('HR','HR_MANAGE'))
    )
  );
$$;

do $$
declare v_definition text;
begin
  select pg_get_functiondef('app_private.get_effective_permission_sources_authorized(uuid)'::regprocedure)
  into v_definition;
  v_definition := replace(
    v_definition,
    'coalesce(v_target_is_admin, false)
      and source_row.permission_code like ''hrm.%''
      and source_row.source_type = ''LEGACY''',
    'source_row.permission_code like ''hrm.%''
      and source_row.source_type = ''LEGACY'''
  );
  execute v_definition;
  if pg_get_functiondef('app_private.get_effective_permission_sources_authorized(uuid)'::regprocedure)
    like '%coalesce(v_target_is_admin, false)%'
  then raise exception using errcode='55000', message='HRM_LEGACY_AUTHORIZED_RESOLVER_REWRITE_FAILED'; end if;

  select pg_get_functiondef('app_private.get_user_hr_authorization_impl(uuid)'::regprocedure)
  into v_definition;
  v_definition := replace(
    v_definition,
    'and not (v_target.role = ''ADMIN'' and source_row.source_type = ''LEGACY'')',
    'and not (source_row.source_type = ''LEGACY'')'
  );
  execute v_definition;
  if pg_get_functiondef('app_private.get_user_hr_authorization_impl(uuid)'::regprocedure)
    like '%v_target.role = ''ADMIN'' and source_row.source_type = ''LEGACY''%'
  then raise exception using errcode='55000', message='HRM_LEGACY_AUTHORIZATION_SUMMARY_REWRITE_FAILED'; end if;
end;
$$;

revoke all on function app_private.has_governed_hrm_permission(uuid,text,text,text) from public,anon,authenticated;

notify pgrst, 'reload schema';
commit;
