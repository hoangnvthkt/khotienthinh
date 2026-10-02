-- Run after authorization_p3_roles_to_personal_grants. Read-only checks, rolls back.
begin;

-- The backup used for rollback is unreadable by clients.
do $$
begin
  if has_table_privilege('authenticated', 'app_private.p3_roles_conversion_backup', 'select')
     or has_table_privilege('anon', 'app_private.p3_roles_conversion_backup', 'select') then
    raise exception 'conversion backup is readable by clients';
  end if;
end $$;

-- Every row the conversion touched has a backup row, so the rollback is exact.
do $$
declare v_missing int;
begin
  select count(*) into v_missing
  from public.user_permission_grants g
  where g.grant_reason like 'Chuyển từ vai trò % sang quyền riêng (P3, 28/09/2026)'
    and not exists (select 1 from app_private.p3_roles_conversion_backup b
      where b.user_id = g.user_id and b.permission_code = g.permission_code
        and b.scope_type = g.scope_type and b.scope_id = g.scope_id);
  if v_missing > 0 then raise exception '% converted grants have no backup row', v_missing; end if;
end $$;

-- Sensitive HR codes only work through the HR roles; they must never have become personal grants.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.user_permission_grants g
  where g.grant_reason like 'Chuyển từ vai trò % sang quyền riêng (P3, 28/09/2026)'
    and app_private.is_hrm_template_only_permission(g.permission_code);
  if v_bad > 0 then raise exception '% HR-only permissions were converted to personal grants', v_bad; end if;
end $$;

rollback;
