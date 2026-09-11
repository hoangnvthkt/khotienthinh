-- Task 12.4: authoritative metadata for the module-first authorization editor.

alter table public.permission_actions
  add column direct_grant_allowed boolean not null default true;

update public.permission_actions
set direct_grant_allowed = false,
    updated_at = now()
where permission_code = any(array[
  'hrm.organization.manage',
  'hrm.staffing.manage',
  'hrm.staffing.assign',
  'hrm.staffing.set_manager',
  'hrm.employee.view_sensitive',
  'hrm.employee.edit_sensitive',
  'hrm.employee.import',
  'hrm.employee.export',
  'hrm.contract.view',
  'hrm.contract.manage',
  'hrm.document.view',
  'hrm.document.manage',
  'hrm.compensation.view',
  'hrm.compensation.manage',
  'hrm.payroll.view',
  'hrm.payroll.manage',
  'hrm.payroll.export',
  'hrm.master_data.manage'
]::text[]);

create table if not exists app_private.permission_application_default_view_grants (
  application_code text not null,
  permission_code text not null,
  default_scope_type text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint permission_application_default_view_grants_pkey
    primary key (application_code, permission_code),
  constraint permission_application_default_view_grants_application_fkey
    foreign key (application_code)
    references public.permission_applications(code)
    on update cascade on delete restrict,
  constraint permission_application_default_view_grants_permission_fkey
    foreign key (permission_code)
    references public.permission_actions(permission_code)
    on update cascade on delete restrict,
  constraint permission_application_default_view_grants_scope_check
    check (default_scope_type = any(array[
      'global', 'own', 'assigned', 'project', 'construction_site',
      'warehouse', 'department', 'direct_reports', 'org_unit', 'work_workspace'
    ]::text[]))
);

revoke all on table app_private.permission_application_default_view_grants
  from public;
revoke all on table app_private.permission_application_default_view_grants
  from anon;
revoke all on table app_private.permission_application_default_view_grants
  from authenticated;

create or replace function app_private.validate_permission_default_view_grant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_action public.permission_actions%rowtype;
  v_application_code text;
begin
  select action_row.*
  into v_action
  from public.permission_actions action_row
  where action_row.permission_code = new.permission_code;

  if v_action.id is not null then
    select coalesce(v_action.access_application_code, module_row.application_code)
    into v_application_code
    from public.permission_modules module_row
    where module_row.code = v_action.module_code;
  end if;

  if v_action.id is null
    or not v_action.is_active
    or not v_action.direct_grant_allowed
    or v_action.direct_grant_requires_expiry
    or new.default_scope_type <> all(v_action.scope_modes)
    or v_application_code is distinct from new.application_code
  then
    raise exception 'Invalid default-view permission: %', new.permission_code
      using errcode = '23514';
  end if;

  if v_action.action <> all(array[
    'view', 'access', 'view_own', 'view_directory', 'view_profile', 'view_related'
  ]::text[]) then
    raise exception 'Default bundle action is not a safe view: %', new.permission_code
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app_private.validate_permission_default_view_grant()
  from public, anon, authenticated;

drop trigger if exists trg_validate_permission_default_view_grant
  on app_private.permission_application_default_view_grants;
create trigger trg_validate_permission_default_view_grant
before insert or update
on app_private.permission_application_default_view_grants
for each row
execute function app_private.validate_permission_default_view_grant();

insert into app_private.permission_application_default_view_grants (
  application_code,
  permission_code,
  default_scope_type,
  sort_order
)
values
  ('procurement', 'system.procurement.view', 'global', 10),
  ('wms', 'wms.inventory.view', 'global', 10),
  ('wms', 'wms.request.view', 'global', 20),
  ('wms', 'wms.transaction.view', 'global', 30),
  ('hrm', 'hrm.employee.view_directory', 'global', 10),
  ('hrm', 'hrm.employee.view_profile', 'own', 20),
  ('hrm', 'hrm.organization.view', 'global', 30),
  ('hrm', 'hrm.staffing.view', 'global', 40),
  ('hrm', 'hrm.attendance.view', 'own', 50),
  ('hrm', 'hrm.leave.view', 'own', 60),
  ('hrm', 'hrm.master_data.view', 'global', 70),
  ('workflow', 'workflow.instance.view', 'own', 10),
  ('workflow', 'workflow.template.view', 'global', 20),
  ('request', 'request.instance.view_own', 'own', 10),
  ('request', 'request.category.view', 'global', 20),
  ('request', 'request.template.view', 'global', 30),
  ('work', 'work.module.access', 'global', 10),
  ('work', 'work.task.view_related', 'own', 20),
  ('expense', 'expense.budget.view', 'own', 10),
  ('expense', 'expense.expense_record.view_own', 'own', 20),
  ('asset', 'asset.catalog.view', 'global', 10),
  ('asset', 'asset.assignment.view', 'global', 20),
  ('asset', 'asset.maintenance.view', 'global', 30),
  ('asset', 'asset.audit.view', 'global', 40),
  ('contract', 'contract.partner.view', 'global', 10),
  ('contract', 'contract.customer.view', 'global', 20),
  ('contract', 'contract.supplier.view', 'global', 30),
  ('contract', 'contract.template.view', 'global', 40),
  ('contract', 'contract.cost_library.view', 'global', 50),
  ('chat', 'system.chat.view', 'global', 10),
  ('ai', 'ai.assistant.view', 'global', 10),
  ('ai', 'ai.executive.view', 'global', 20),
  ('ai', 'ai.report.view', 'global', 30),
  ('ai', 'system.tender_ai.view', 'global', 40),
  ('storage', 'storage.view', 'global', 10),
  ('kb', 'kb.view', 'global', 10),
  ('analytics', 'analytics.view', 'global', 10),
  ('analytics', 'system.custom_dashboard.view', 'global', 20),
  ('resource_booking', 'booking.vehicle.view_own', 'own', 10)
on conflict (application_code, permission_code) do update
set default_scope_type = excluded.default_scope_type,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

create or replace function app_private.get_permission_admin_catalog_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_catalog jsonb;
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_grants'
  );

  select jsonb_build_object(
    'generatedAt', statement_timestamp(),
    'applications', coalesce(jsonb_agg(application_item.payload order by application_item.sort_order, application_item.code), '[]'::jsonb)
  )
  into v_catalog
  from (
    select
      application_row.code,
      application_row.sort_order,
      jsonb_build_object(
        'code', application_row.code,
        'label', application_row.name,
        'description', application_row.description,
        'sortOrder', application_row.sort_order,
        'hasDefaultViewBundle', exists (
          select 1
          from app_private.permission_application_default_view_grants bundle_row
          where bundle_row.application_code = application_row.code
            and bundle_row.is_active
        ),
        'modules', (
          select coalesce(jsonb_agg(module_item.payload order by module_item.sort_order, module_item.code), '[]'::jsonb)
          from (
            select
              module_row.code,
              module_row.sort_order,
              jsonb_build_object(
                'code', module_row.code,
                'label', module_row.name,
                'description', module_row.description,
                'sortOrder', module_row.sort_order,
                'actions', (
                  select coalesce(jsonb_agg(
                    jsonb_build_object(
                      'action', action_row.action,
                      'label', action_row.label,
                      'permissionCode', action_row.permission_code,
                      'description', action_row.description,
                      'scopeTypes', to_jsonb(action_row.scope_modes),
                      'sortOrder', action_row.sort_order,
                      'riskLevel', action_row.risk_level,
                      'grantReadiness', action_row.grant_readiness,
                      'directGrantAllowed', action_row.direct_grant_allowed,
                      'directGrantRequiresExpiry', action_row.direct_grant_requires_expiry,
                      'isDefaultView', coalesce(bundle_row.is_active, false),
                      'defaultScopeType', case when bundle_row.is_active then bundle_row.default_scope_type else null end
                    )
                    order by action_row.sort_order, action_row.permission_code
                  ), '[]'::jsonb)
                  from public.permission_actions action_row
                  left join app_private.permission_application_default_view_grants bundle_row
                    on bundle_row.application_code = application_row.code
                   and bundle_row.permission_code = action_row.permission_code
                  where action_row.module_code = module_row.code
                    and action_row.is_active
                    and coalesce(action_row.access_application_code, module_row.application_code) = application_row.code
                )
              ) as payload
            from public.permission_modules module_row
            where module_row.is_active
              and exists (
                select 1
                from public.permission_actions action_row
                where action_row.module_code = module_row.code
                  and action_row.is_active
                  and coalesce(action_row.access_application_code, module_row.application_code) = application_row.code
              )
              and module_row.code <> all(array[
                'system.da', 'system.wms', 'system.ep', 'system.wf', 'system.rq',
                'system.ex', 'system.ts', 'system.hd', 'system.ai', 'system.storage',
                'system.kb', 'system.analytics'
              ]::text[])
          ) module_item
        )
      ) as payload
    from public.permission_applications application_row
    where application_row.is_active
      and application_row.member_assignable
      and exists (
        select 1
        from public.permission_modules module_row
        join public.permission_actions action_row
          on action_row.module_code = module_row.code
        where module_row.is_active
          and action_row.is_active
          and coalesce(action_row.access_application_code, module_row.application_code) = application_row.code
          and module_row.code <> all(array[
            'system.da', 'system.wms', 'system.ep', 'system.wf', 'system.rq',
            'system.ex', 'system.ts', 'system.hd', 'system.ai', 'system.storage',
            'system.kb', 'system.analytics'
          ]::text[])
      )
  ) application_item;

  return v_catalog;
end;
$$;

create or replace function public.get_permission_admin_catalog()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_permission_admin_catalog_impl();
$$;

revoke all on function app_private.get_permission_admin_catalog_impl()
  from public, anon, authenticated;
grant execute on function app_private.get_permission_admin_catalog_impl()
  to authenticated, service_role;

revoke all on function public.get_permission_admin_catalog()
  from public;
revoke all on function public.get_permission_admin_catalog()
  from anon;
revoke all on function public.get_permission_admin_catalog()
  from authenticated;
grant execute on function public.get_permission_admin_catalog()
  to authenticated, service_role;
