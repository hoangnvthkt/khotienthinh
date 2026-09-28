-- Run after authorization_p1_5_owner_module_admin_decisions. Rolls back.
begin;
do $$
declare v_count int;
begin
  if exists (select 1 from public.users where role <> 'ADMIN' and is_active
             and ((admin_modules && array['HD','WMS','WF','TS']) or coalesce(admin_sub_modules, '{}'::jsonb) ?| array['HD','WMS','WF','TS'])) then
    raise exception 'legacy HD/WMS/WF/TS flags remain';
  end if;
  if exists (select 1 from public.user_permission_grants g join public.users u on u.id = g.user_id
             where g.is_active and u.role <> 'ADMIN' and g.permission_code in ('system.wms.manage', 'system.hd.manage')) then
    raise exception 'warehouse or contract module admin remains';
  end if;
  select count(distinct g.user_id) into v_count from public.user_permission_grants g join public.users u on u.id = g.user_id
  where g.is_active and u.role <> 'ADMIN' and g.permission_code = 'system.wf.manage';
  if v_count <> 7 then raise exception 'expected 7 workflow admins, found %', v_count; end if;
  select count(distinct g.user_id) into v_count from public.user_permission_grants g join public.users u on u.id = g.user_id
  where g.is_active and u.role <> 'ADMIN' and g.permission_code = 'system.ts.manage';
  if v_count <> 1 then raise exception 'asset admin changed: %', v_count; end if;
  -- Every former workflow admin can still act on assigned steps and start workflows.
  select count(*) into v_count
  from (select distinct (payload ->> 'user_id')::uuid id from app_private.p1_5_backup_20260927 where kind = 'assignment'
        union select ref_id from app_private.p1_5_backup_20260927 b where kind = 'legacy_flags'
          and (b.payload -> 'admin_modules' ? 'WF' or coalesce(b.payload -> 'admin_sub_modules', '{}'::jsonb) ? 'WF')) wf
  where not (app_private.has_permission(wf.id, 'workflow.instance.act_assigned', 'assigned', wf.id::text)
             and app_private.has_permission(wf.id, 'workflow.instance.create', 'own', wf.id::text));
  if v_count > 0 then raise exception '% workflow users lost everyday workflow rights', v_count; end if;
end $$;
rollback;
