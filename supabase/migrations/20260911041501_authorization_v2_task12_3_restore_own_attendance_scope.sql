-- Task 12.3: Phase 5 preserved legacy HR profiles exactly, but a legacy
-- module/submodule "view" did not mean company-wide attendance visibility.
-- Restore self-service semantics for migrated view-only profiles. Templates
-- that can edit/approve attendance remain global operators.

-- Schema-only previews have no actors or migrated HR profiles to reconcile.
-- Snapshot this narrow bootstrap condition once; a populated or partial
-- inventory must still satisfy every original reconciliation guard below.
create temporary table authorization_v2_hrm_bootstrap_context on commit drop as
select not exists (select 1 from auth.users)
  and not exists (select 1 from public.users)
  and not exists (select 1 from public.projects)
  and not exists (select 1 from public.project_staff)
  and not exists (select 1 from app_private.authorization_legacy_user_snapshots)
  and not exists (select 1 from public.role_permission_templates where code like 'LEGACY_HR_%')
  and not exists (select 1 from public.principal_role_assignments)
  and not exists (select 1 from public.user_permission_grants)
  as is_empty_bootstrap;

do $$
begin
  if not app_private.permission_hardening_flag('legacy_fallback_disabled') then
    raise exception 'Task 12.3 requires canonical-only authorization';
  end if;

  if (select is_empty_bootstrap from pg_temp.authorization_v2_hrm_bootstrap_context) then
    return;
  end if;

  if not exists (
    select 1
    from public.role_permission_templates template
    join public.role_permission_template_items view_item
      on view_item.template_id = template.id
     and view_item.permission_code = 'hrm.attendance.view'
     and view_item.scope_type = 'global'
     and view_item.scope_id = '*'
    where template.code like 'LEGACY_HR_%'
      and not exists (
        select 1
        from public.role_permission_template_items operator_item
        where operator_item.template_id = template.id
          and operator_item.permission_code in (
            'hrm.attendance.edit',
            'hrm.attendance.approve'
          )
      )
  ) then
    raise exception 'Task 12.3 found no migrated view-only HR profile to reconcile';
  end if;
end
$$;

-- Avoid a uniqueness conflict if an own-scope item was added manually after
-- cutover. The existing own row is already the desired canonical result.
delete from public.role_permission_template_items global_view
using public.role_permission_templates template
where global_view.template_id = template.id
  and template.code like 'LEGACY_HR_%'
  and global_view.permission_code = 'hrm.attendance.view'
  and global_view.scope_type = 'global'
  and global_view.scope_id = '*'
  and not exists (
    select 1
    from public.role_permission_template_items operator_item
    where operator_item.template_id = template.id
      and operator_item.permission_code in (
        'hrm.attendance.edit',
        'hrm.attendance.approve'
      )
  )
  and exists (
    select 1
    from public.role_permission_template_items own_view
    where own_view.template_id = template.id
      and own_view.permission_code = 'hrm.attendance.view'
      and own_view.scope_type = 'own'
      and own_view.scope_id = '*'
  );

update public.role_permission_template_items view_item
set scope_type = 'own'
from public.role_permission_templates template
where view_item.template_id = template.id
  and template.code like 'LEGACY_HR_%'
  and view_item.permission_code = 'hrm.attendance.view'
  and view_item.scope_type = 'global'
  and view_item.scope_id = '*'
  and not exists (
    select 1
    from public.role_permission_template_items operator_item
    where operator_item.template_id = template.id
      and operator_item.permission_code in (
        'hrm.attendance.edit',
        'hrm.attendance.approve'
      )
  );

do $$
begin
  if (select is_empty_bootstrap from pg_temp.authorization_v2_hrm_bootstrap_context) then
    return;
  end if;

  if exists (
    select 1
    from public.role_permission_templates template
    join public.role_permission_template_items view_item
      on view_item.template_id = template.id
     and view_item.permission_code = 'hrm.attendance.view'
     and view_item.scope_type = 'global'
     and view_item.scope_id = '*'
    where template.code like 'LEGACY_HR_%'
      and not exists (
        select 1
        from public.role_permission_template_items operator_item
        where operator_item.template_id = template.id
          and operator_item.permission_code in (
            'hrm.attendance.edit',
            'hrm.attendance.approve'
          )
      )
  ) then
    raise exception 'Task 12.3 left a view-only legacy HR profile at global scope';
  end if;

  if not exists (
    select 1
    from public.role_permission_templates template
    join public.role_permission_template_items view_item
      on view_item.template_id = template.id
     and view_item.permission_code = 'hrm.attendance.view'
     and view_item.scope_type = 'global'
     and view_item.scope_id = '*'
    where template.code like 'LEGACY_HR_%'
      and exists (
        select 1
        from public.role_permission_template_items operator_item
        where operator_item.template_id = template.id
          and operator_item.permission_code in (
            'hrm.attendance.edit',
            'hrm.attendance.approve'
          )
      )
  ) then
    raise exception 'Task 12.3 removed global attendance scope from all operators';
  end if;
end
$$;
