-- P1.5 step 2: apply the owner's decisions of 27/09/2026 on legacy module
-- admins (see docs/security/authorization-remediation-rollout-log.md).
--   Workflow: all 23 get the WORKFLOW_USER business role (they processed
--     steps only through the admin flag); 7 keep system.wf.manage, 16 lose it.
--   Warehouse: all 22 lose system.wms.manage (keepers keep their role path).
--   Contract: all 7 lose system.hd.manage and contract.*.manage.
--   Asset: the only holder keeps system.ts.manage.
-- Legacy HD/WMS/WF/TS flags are inert since step 1 and are cleared.
-- Everything touched is backed up for app_private rollback.

create table if not exists app_private.p1_5_backup_20260927 (
  kind text not null,          -- 'grant' | 'assignment' | 'legacy_flags'
  ref_id uuid not null,        -- grant id, assignment id or user id
  payload jsonb not null,
  backed_up_at timestamptz not null default now(),
  primary key (kind, ref_id)
);
revoke all on table app_private.p1_5_backup_20260927 from public, anon, authenticated;

create temporary table p1_5_wf_keep (user_id uuid primary key) on commit drop;
insert into p1_5_wf_keep values
  ('a4a81a1c-0204-456b-961b-7ee14b519734'), ('7cc8e2f9-c2c8-4c7e-a3a1-4f0af46f676a'),
  ('248cd764-f22c-4b1b-ad10-e059692abc35'), ('357aef86-f287-44d8-b086-67de116dd7bf'),
  ('0012143c-db17-4fba-a285-201be6103799'), ('a59b7a10-cbfe-42bc-8fbd-ac832e1cab19'),
  ('38247bb6-00fb-46b6-aa1c-bc9fb67e7bf1');

create temporary table p1_5_flag_holders on commit drop as
select user_row.id, m.module
from public.users user_row
cross join (values ('HD'), ('WMS'), ('WF'), ('TS')) m(module)
where user_row.role <> 'ADMIN'
  and (m.module = any(coalesce(user_row.admin_modules, '{}'::text[])) or coalesce(user_row.admin_sub_modules, '{}'::jsonb) ? m.module);

-- 1. Workflow users keep processing their steps.
insert into app_private.p1_5_backup_20260927 (kind, ref_id, payload)
select 'assignment', gen_random_uuid(), jsonb_build_object('user_id', holder.id, 'template', 'WORKFLOW_USER')
from p1_5_flag_holders holder
where holder.module = 'WF'
  and not exists (
    select 1 from public.principal_role_assignments existing
    where existing.principal_type = 'user' and existing.principal_id = holder.id
      and existing.role_template_id = 'a61a803f-0faa-465c-8ad1-1dfe04d56712' and existing.status = 'ACTIVE'
  );

insert into public.principal_role_assignments (
  id, principal_type, principal_id, role_template_id, scope_type, scope_id, starts_at, status, assigned_reason
)
select backup.ref_id, 'user', (backup.payload ->> 'user_id')::uuid, 'a61a803f-0faa-465c-8ad1-1dfe04d56712',
  'global', '*', now(), 'ACTIVE', 'P1.5: thay cờ quản trị Quy trình legacy bằng vai trò Người dùng quy trình'
from app_private.p1_5_backup_20260927 backup
where backup.kind = 'assignment';

-- 2. Revoke module-admin grants per decision.
create temporary table p1_5_revoke (grant_id uuid primary key) on commit drop;
insert into p1_5_revoke
select grant_row.id
from public.user_permission_grants grant_row
join public.users user_row on user_row.id = grant_row.user_id and user_row.role <> 'ADMIN'
where grant_row.is_active and grant_row.revoked_at is null
  and (
    grant_row.permission_code = 'system.wms.manage'
    or (grant_row.permission_code = 'system.wf.manage' and grant_row.user_id not in (select user_id from p1_5_wf_keep))
    or (
      grant_row.user_id in (select id from p1_5_flag_holders where module = 'HD')
      and grant_row.permission_code in (
        'system.hd.manage', 'contract.customer.manage', 'contract.supplier.manage',
        'contract.partner.manage', 'contract.template.manage', 'contract.cost_library.manage'
      )
    )
  );

insert into app_private.p1_5_backup_20260927 (kind, ref_id, payload)
select 'grant', grant_row.id, to_jsonb(grant_row)
from public.user_permission_grants grant_row
where grant_row.id in (select grant_id from p1_5_revoke);

update public.user_permission_grants
set is_active = false,
    revoked_at = now(),
    revoked_reason = 'P1.5: chủ sản phẩm thu hồi quyền quản trị module (27/09/2026)',
    updated_at = now()
where id in (select grant_id from p1_5_revoke);

-- 3. Clear the inert legacy flags (audited, backed up).
insert into app_private.p1_5_backup_20260927 (kind, ref_id, payload)
select 'legacy_flags', user_row.id, jsonb_build_object('admin_modules', user_row.admin_modules, 'admin_sub_modules', user_row.admin_sub_modules)
from public.users user_row
where user_row.id in (select id from p1_5_flag_holders);

select set_config('app.authorization_legacy_migration', 'on', true);
alter table public.users disable trigger trg_users_prevent_privilege_self_update;
update public.users user_row
set admin_modules = (
      select coalesce(array_agg(value), '{}'::text[]) from unnest(coalesce(user_row.admin_modules, '{}'::text[])) value
      where value not in ('HD', 'WMS', 'WF', 'TS')
    ),
    admin_sub_modules = case when user_row.admin_sub_modules is null then null
      else user_row.admin_sub_modules - 'HD' - 'WMS' - 'WF' - 'TS' end
where user_row.id in (select id from p1_5_flag_holders);
alter table public.users enable trigger trg_users_prevent_privilege_self_update;
select set_config('app.authorization_legacy_migration', '', true);

insert into app_private.authorization_legacy_write_audit (actor_user_id, target_user_id, changed_columns, reason)
select null, backup.ref_id, array['admin_modules', 'admin_sub_modules'], 'P1.5: xóa cờ quản trị module HD/WMS/WF/TS legacy (đã chuyển sang capability)'
from app_private.p1_5_backup_20260927 backup
where backup.kind = 'legacy_flags';
