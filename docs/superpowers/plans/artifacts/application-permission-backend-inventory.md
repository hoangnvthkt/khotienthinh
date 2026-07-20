# Application Permission Backend Inventory

## Scope

This inventory records the backend objects needed before promoting another application's permissions from `declared` to `enforced`.

Collected on 2026-07-20 against the linked Supabase project using local Supabase CLI `2.95.6`.

Only read-only metadata queries were run. No `db push`, migration repair, DDL, DML, or migration-history operation was executed for this inventory.

## HRM Candidate Actions

- `hrm.employee.view`
- `hrm.employee.create`
- `hrm.employee.edit`
- `hrm.attendance.view`
- `hrm.attendance.edit`
- `hrm.leave.view`
- `hrm.leave.approve`
- `hrm.payroll.view`
- `hrm.payroll.manage`
- `hrm.master_data.view`
- `hrm.master_data.manage`

Current registry readiness on the linked database:

| Permission | Module | Scope modes | Readiness |
| --- | --- | --- | --- |
| `hrm.employee.view` | `hrm.employee` | `global`, `own`, `department`, `assigned` | `declared` |
| `hrm.employee.create` | `hrm.employee` | `global`, `own`, `department`, `assigned` | `declared` |
| `hrm.employee.edit` | `hrm.employee` | `global`, `own`, `department`, `assigned` | `declared` |

## Tables

| Table | Existing RLS | Current policies | Required action checks | Notes |
| --- | --- | --- | --- | --- |
| `public.employees` | Enabled | `employees_active_actor_gate` (`ALL`, restrictive), `employees_select` (`SELECT true`), `employees_write` (`INSERT can_manage_hrm_employees()`), `employees_update` (`UPDATE can_manage_hrm_employees()`), `employees_delete` (`DELETE can_manage_hrm_employees()`) | `hrm.employee.view` for select, `hrm.employee.create` for insert, `hrm.employee.edit` for update. Delete needs an explicit product decision before backend promotion because the registry has no `hrm.employee.delete` action yet. | Primary HRM employee slice. Scope columns confirmed: `id uuid`, `user_id uuid`, `department_id uuid`, `org_unit_id uuid`, `status`, `created_at`, `updated_at`. Existing select is broad and existing writes still rely on legacy HRM admin semantics. |
| `public.users` | Enabled | `users_active_actor_gate`, `users_select`, `users_insert`, `users_update_admin`, `users_update_self_profile` | Do not couple employee CRUD to account admin. Self-profile update may update `users.name`, `users.phone`, `users.avatar` through RPC only. | Needed because employee records link to `users.id` through `employees.user_id`. |
| `public.hrm_attendance` | Enabled | `attendance_select`, `attendance_insert`, `attendance_update`, `attendance_delete`, `hrm_attendance_active_actor_gate` | `hrm.attendance.view`, `hrm.attendance.edit` | Separate slice. Do not promote with employee migration. |
| `public.hrm_attendance_proposals` | Enabled | `attendance_proposals_select`, `attendance_proposals_insert`, `attendance_proposals_update`, `attendance_proposals_delete`, `hrm_attendance_proposals_active_actor_gate` | `hrm.attendance.view`, `hrm.attendance.edit` plus proposal/self/location rules | Existing policies already encode proposer/target/location-manager rules; inventory before enforcement must preserve those semantics. |
| `public.hrm_leave_requests`, `public.hrm_leave_balances`, `public.hrm_leave_logs` | Enabled | Per-table select/insert/update/delete policies plus active actor gates | `hrm.leave.view`, `hrm.leave.approve` and possibly future create/edit actions | Leave needs a separate action model because request, approval, balance, and log updates are not the same operation. |
| `public.hrm_payrolls`, `public.hrm_payroll_templates`, `public.hrm_payroll_components`, `public.hrm_payroll_import_batches`, `public.hrm_payroll_import_rows`, `public.hrm_employee_compensation_assignments`, `public.hrm_compensation_plans`, `public.hrm_salary_history`, `public.hrm_salary_policies`, `public.hrm_3p_bands`, `public.hrm_3p_grade_band_rates`, `public.hrm_position_salary_mappings` | Enabled | Per-table CRUD policies plus active actor gates | `hrm.payroll.view`, `hrm.payroll.manage` | Payroll is sensitive and must not ride on `hrm.employee.edit`. Needs separate migration/test plan. |
| `public.hrm_areas`, `public.hrm_offices`, `public.hrm_employee_types`, `public.hrm_positions`, `public.hrm_position_groups`, `public.hrm_position_levels`, `public.hrm_org_blocks`, `public.hrm_work_schedules`, `public.hrm_shift_types`, `public.hrm_holidays`, `public.hrm_catalog_items`, `public.hrm_competency_groups`, `public.hrm_competency_levels`, `public.hrm_construction_sites` | Enabled | Mostly per-table CRUD policies plus active actor gates; several tables also have permissive read/all-authenticated policies. | `hrm.master_data.view`, `hrm.master_data.manage` | Master data is not the employee CRUD slice. Some permissive legacy policies must be reviewed table-by-table before marking enforced. |
| `public.hrm_doc_categories`, `public.hrm_documents` | Enabled | Both have active actor gates plus broad `Allow all access ...` policies | Likely `hrm.master_data.view/manage` or future document-specific actions | Broad all-access policies are a blocker for claiming backend-enforced HRM document permissions. |
| `public.hrm_employee_shifts`, `public.hrm_shift_types` | Enabled | Active actor gates plus broad `Allow all for authenticated users` policies | `hrm.attendance.*` or `hrm.master_data.*`, depending on final UX semantics | Must be separated before enforcement because shift assignment and shift type configuration are different operations. |

## Functions / RPC

| Function | Current execute grants | Required permission | Notes |
| --- | --- | --- | --- |
| `public.has_permission(permission_code, scope_type, scope_id)` | `authenticated`, `service_role`; revoked from public | N/A helper | Public wrapper around `app_private.has_permission(...)`. |
| `app_private.has_permission(p_user_id, p_permission_code, p_scope_type, p_scope_id)` | `authenticated` can execute; revoked from anon/public | N/A helper | Resolves direct, role, and legacy-compatible effective permission sources via `app_private.resolve_effective_permission_sources(...)`. |
| `app_private.hrm_has_action(p_permission_code, p_target_user_id, p_department_id, p_assigned_user_id, p_user_id)` | `authenticated` can execute; revoked from anon | HRM action helper | Supports `global`, `own`, `department`, and `assigned` scopes for `hrm.%` codes. It currently includes a compatibility branch `or public.is_module_admin('HRM')`; decide whether to keep it temporarily or replace it with explicit HRM admin permissions before calling HRM fully de-legacyed. |
| `app_private.can_manage_hrm_employees()` | `authenticated` can execute; revoked from anon | Legacy compatibility only | Existing employee insert/update/delete policies use this. It returns true for `users.role = 'ADMIN'`, legacy HRM app admin, or legacy HRM employee submodule admin. This is the main backend gap for the new workbench. |
| `public.update_my_employee_profile(p_patch jsonb)` | `authenticated`, `service_role`; revoked from public | Self-profile only | Wrapper for `app_private.update_my_employee_profile_impl(...)`; only updates `employees` row where `employees.user_id = current_app_user_id()` and then syncs `users.name`, `users.phone`, `users.avatar`. Keep this RPC as the own-profile path, separate from admin employee edit. |
| `app_private.hrm_employee_is_current_user(p_employee_id text)` | `authenticated`, `service_role`; anon execute currently true by metadata | Self identity helper | Used by attendance proposals. If reused, verify anon execute is intentional. |
| `public.get_next_employee_code()` | `authenticated`, `service_role`; revoked from anon | Employee create support | Sequence/helper used around employee creation. Should not grant create by itself; insert policy must still enforce `hrm.employee.create`. |
| `public.employee_camera_checkin_v1(...)` | `anon`, `authenticated` | Attendance/check-in specific | Out of employee CRUD scope. Needs separate hardening pass if attendance is promoted. |

## UI Mutation Flows

| Flow | UI file | Backend operation | Required permission | Scope source |
| --- | --- | --- | --- | --- |
| Open HRM employee list | `pages/hrm/Employees.tsx`, route `/hrm/employees` | Supabase `SELECT public.employees` via existing data load | `hrm.employee.view` | Route/menu checks use `canViewRoute(user, '/hrm/employees')`; backend still has `employees_select using true`, so RLS does not yet enforce the same gate. |
| Create one employee from modal | `components/hrm/EmployeeModal.tsx` -> `context/AppContext.tsx:addEmployee` | `supabase.from('employees').upsert(payload, { onConflict: 'email' })` | `hrm.employee.create` | UI/service layer uses `canPerform(user, 'hrm.employee.create')`. Backend currently permits only `can_manage_hrm_employees()`, not direct grant. |
| Import new employees | `pages/hrm/Employees.tsx:handleImportEmployees` and `handleConfirmEmployeeImport` -> `addEmployee` | Multiple `employees` upserts plus `addHrmItem('hrm_leave_balances', ...)` | `hrm.employee.create`; leave balance side effect also needs future `hrm.leave`/master-data decision | Global create check in UI. Backend employee insert still legacy; leave balance insert belongs to a separate table/slice. |
| Edit employee from modal/detail | `components/hrm/EmployeeModal.tsx`, `components/hrm/EmployeeDetailModal.tsx` -> `context/AppContext.tsx:updateEmployee` | `syncToSupabase('employees', e)` | `hrm.employee.edit` | Scope source is current/target `employee.departmentId`; own record uses `own/<current-user-id>`. If department changes, AppContext checks both old and new department scope. |
| Bulk update employees from import | `pages/hrm/Employees.tsx:handleConfirmEmployeeImport` -> `updateEmployee` | Multiple `employees` updates | `hrm.employee.edit` global | UI requires global edit for bulk update. Backend still legacy. |
| Delete employee | `pages/hrm/Employees.tsx` -> `context/AppContext.tsx:removeEmployee` | `supabase.from('employees').delete().eq('id', id)` | Currently guarded in UI/service by `hrm.employee.edit` with self-edit disabled | Backend has `employees_delete can_manage_hrm_employees()`. Do not promote delete as enforced until registry/product defines `hrm.employee.delete` or explicitly accepts `edit` as delete-equivalent. |
| Self-profile edit | `pages/hrm/Employees.tsx:onSelfUpdate` -> `lib/employeeSelfService.ts` | `rpc('update_my_employee_profile', { p_patch })` | Own-profile member capability, not admin edit | RPC enforces `employees.user_id = current_app_user_id()`. This should remain available to member for personal fields only. |

## Enforcement Gaps

| Gap | Risk | Proposed fix |
| --- | --- | --- |
| `employees_select` is `USING (true)` while route/menu UI requires `hrm.employee.view`. | Users without view could still read employee rows through direct API access if authenticated and active. | Replace/select-split policy with `app_private.hrm_employee_has_action('hrm.employee.view', department_id, user_id)` or equivalent, preserving self-profile needs through dedicated RPC. |
| Employee insert/update/delete policies still call `app_private.can_manage_hrm_employees()` instead of direct grants. | New workbench grants `hrm.employee.create/edit` may appear selected but fail backend, while old legacy App Admin can still mutate without explicit direct grant. | Migration should drop `employees_write` and `employees_update`, create operation-specific policies using `hrm.employee.create/edit`, and promote only `hrm.employee.view/create/edit` to `enforced`. |
| `app_private.hrm_has_action(...)` includes `public.is_module_admin('HRM')`. | Legacy HRM admin remains an implicit override, which can make “de-legacyed” behavior appear broader than direct grants. | Accept as temporary compatibility bridge in first HRM migration or remove/replace with explicit `hrm.*.manage` only after admin migration plan. Document whichever choice is taken in the migration header. |
| Registry has no `hrm.employee.delete` action, but UI currently uses `hrm.employee.edit` for delete. | Delete can be over-granted if edit is treated as destructive permission. | Add explicit `hrm.employee.delete` before backend delete enforcement, or leave delete under legacy admin until product approves edit-as-delete. |
| Employee import creates `hrm_leave_balances` side effects. | Granting employee create may accidentally require or bypass leave-balance permissions. | Keep first backend migration scoped to `employees`; handle leave-balance creation with a dedicated RPC or separate `hrm.leave` migration. |
| Several HRM master/document/shift tables still have broad authenticated/all-access policies. | Cannot truthfully label HRM master data or documents as backend-enforced while broad policies remain. | Inventory and migrate master data, document, and attendance slices separately. |
| `update_my_employee_profile` also updates `public.users` fields. | Self-service profile changes could be confused with admin employee edit or account management. | Keep self-profile RPC separate, test allowed fields only, and avoid granting `hrm.employee.edit` for ordinary personal info changes. |

## Read-Only Evidence Commands

```bash
npx supabase --version
npx supabase db query --help
npx supabase db query --linked --agent=no --output csv "select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and (c.relname like 'hrm_%' or c.relname in ('employees','users')) order by c.relname;"
npx supabase db query --linked --agent=no --output csv "select tablename, cmd, count(*) as policy_count, string_agg(policyname, ' | ' order by policyname) as policies from pg_policies where schemaname = 'public' and (tablename like 'hrm_%' or tablename in ('employees','users')) group by tablename, cmd order by tablename, cmd;"
npx supabase db query --linked --agent=no --output csv "select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and (table_name like 'hrm_%' or table_name in ('employees','users')) and column_name in ('id','user_id','employee_id','department_id','org_unit_id','warehouse_id','scope_type','scope_id','created_by','updated_by','created_at','updated_at','status') order by table_name, ordinal_position;"
npx supabase db query --linked --agent=no --output csv "select n.nspname as schema_name, p.proname as function_name, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app_private') and (p.proname ilike '%hrm%' or p.proname ilike '%employee%' or p.proname ilike '%permission%' or p.proname ilike '%asset%') order by 1, 2, 3;"
```

The only repeated warning was the Supabase CLI update notice: local `v2.95.6`, newer `v2.109.1` available. The CLI was not upgraded.
