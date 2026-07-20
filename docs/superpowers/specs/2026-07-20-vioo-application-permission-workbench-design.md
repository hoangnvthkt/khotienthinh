# Vioo Application Permission Workbench Design

## Purpose

This spec defines the target permission experience after reviewing the Base.vn-style model and the Asset permission work already shipped in commit `316be57`.

The administrator's goal must be simple:

> "Give employee A access to application X, modules/submodules B/C/D, actions such as view/create/edit/delete/approve/import/export, and the correct scope."

The UI must not require an administrator to understand internal source types such as Direct Grant, Business Role, Legacy, App Access, or backend readiness before they can perform this job safely.

## Problem

The current admin experience exposes too many technical layers:

- Legacy app/module access exists in `allowedModules`, `adminModules`, `allowedSubModules`, and `adminSubModules`.
- New direct grants exist in `user_permission_grants` and effective permission sources.
- Business Roles also contribute effective permissions.
- Some permissions are declared but not backend-enforced.
- The UI currently mixes "permission source explanation" and "grant editing" in one workflow.

That creates the exact confusion the user described: an admin has to set user/application rights in one place, then grant permissions again in another place, and still cannot clearly see where a user's current rights came from or where to revoke them.

## Base.vn Lessons

Base.vn separates "Member" and "App Admin", but the important lesson is not to copy the UX exactly. The useful pattern is the separation of responsibilities:

- **Member** uses an app within assigned work/project/data scope.
- **App Admin** has extra configuration and management capabilities for a specific app.
- **System/Account Admin** can manage user accounts, app access, company settings, security settings, and global permission assignment.

The weak point of that model is the multi-place workflow: assign App Admin in an account console, then configure detailed app permissions inside each app. Vioo should preserve the security separation but collapse the admin workflow into one permission workbench.

## Target Model

### 1. Account Administrator

Account Administrator is the system-level operator.

Allowed responsibilities:

- Create, update, disable, and reactivate user accounts.
- Assign and revoke application access.
- Assign and revoke application administration capabilities.
- Assign Direct Grants and Business Roles through governed flows.
- Review effective permissions and evidence.

Account Administrator must not automatically become the owner of all business data actions unless the backend resolver explicitly grants those actions.

### 2. Application Access

Application Access answers one question:

> Can this user open this application at all?

Application Access is not the same thing as "all actions in the app".

Target behavior:

- If a user receives any `view` permission in an application, the user is considered to have app access for that application.
- If a user loses all `view` permissions in an application, the UI should show that app as inaccessible.
- The admin UI may display an app-level access toggle, but saving that toggle must translate into explicit module `view` grants or explicit app-access records. It must not silently rely on legacy `allowedModules`.

### 3. Application Administrator

Application Administrator answers this question:

> Can this user configure or administer this application?

It is not equivalent to unrestricted data access.

Examples:

- HRM App Admin may configure HRM categories, policies, work schedules, document templates, and HRM permission templates.
- Asset App Admin may configure asset categories or maintenance settings.
- Workflow App Admin may configure templates and publish flows.

Target behavior:

- App Admin is represented by explicit `*.settings.manage`, `*.master_data.manage`, or other app-specific admin actions.
- App Admin actions must be shown in the same workbench as ordinary actions, but with a clear "Quản trị ứng dụng" group.
- App Admin actions must still have backend enforcement before they can be granted as Direct Grant.

### 4. Module and Submodule Actions

Module action permissions answer this question:

> What can this user do in this module or submodule?

Examples already present in the registry:

- HRM: `hrm.employee.view`, `hrm.employee.create`, `hrm.employee.edit`
- Asset Catalog: `asset.catalog.view`, `asset.catalog.create`, `asset.catalog.edit`, `asset.catalog.delete`, `asset.catalog.dispose`, `asset.catalog.import`, `asset.catalog.transfer_stock`
- Asset Assignment: `asset.assignment.view`, `asset.assignment.assign`, `asset.assignment.return`, `asset.assignment.transfer`
- Asset Maintenance: `asset.maintenance.view`, `asset.maintenance.create`, `asset.maintenance.complete`, `asset.maintenance.import`
- Asset Audit: `asset.audit.view`, `asset.audit.perform`, `asset.audit.export`

Target behavior:

- `view` is the mandatory gateway action for each module/submodule.
- Selecting any non-view action automatically selects `view`.
- A user cannot remove `view` while any non-view action remains selected for the same module/submodule and scope.
- The UI should display "why the user has this permission" from effective sources, but only Direct Grants can be revoked directly from this workbench.

### 5. Scope

Scope answers this question:

> Where does this permission apply?

Supported scope types are already defined by `UserPermissionGrant.scopeType`:

- `global`
- `own`
- `assigned`
- `project`
- `construction_site`
- `warehouse`
- `department`

Target behavior:

- Scope must be selected before saving a Direct Grant.
- The UI must not apply `global/*` by default for permissions whose natural domain is warehouse, department, project, own, or assigned.
- Route visibility may use broad app/module view checks, but data actions must evaluate against the actual record scope.
- Asset stock transfer must check both source and destination scope.

### 6. Permission Sources

Effective permission sources must be visible and understandable:

- **Direct**: explicitly granted to the user in the current workbench.
- **Role**: inherited through Business Role assignment.
- **Legacy**: inherited from old module/submodule arrays.

Target behavior:

- A "Current permissions" panel lists every effective permission by app, module, action, scope, and source.
- Direct sources show a revoke affordance.
- Role sources link to the role assignment.
- Legacy sources show "Thu hồi legacy" and "Chuyển sang quyền mới" affordances.
- The workbench must make it obvious when a permission is effective but not directly editable because it comes from Role or Legacy.

### 7. Legacy Compatibility and Retirement

Legacy should remain readable and revocable, but it should not be a primary grant path.

Rules:

- Legacy module/submodule access maps to `view` only.
- Legacy admin module/submodule access maps only to the exact actions that legacy historically allowed.
- Legacy must not automatically unlock all modern actions in an application.
- New legacy grants must not be created from the new workbench.
- The UI may offer a conversion action that creates modern Direct Grants matching the legacy effect, then removes the legacy source after preview and confirmation.

### 8. Readiness and Enforcement

Actions have different readiness states:

- `declared`: visible in registry but not backend-enforced.
- `legacy`: managed by old compatibility only.
- `verified`: validated by migration/test evidence.
- `enforced`: backend and frontend both enforce.

Target behavior:

- Direct Grant can be added only for actions that are not `legacy`.
- High-risk or sensitive actions require preview evidence and reason.
- The UI must not present a "saved successfully" feeling for a permission unless backend enforcement exists or the action is clearly marked as compatibility/read-only.
- Asset actions implemented by `20260720100000_asset_action_operation_guards.sql` are the reference implementation for backend-enforced module action permissions.

## Target User Experience

The workbench should be organized around one sentence:

> "User này được làm gì, ở đâu, vì nguồn nào?"

Recommended layout:

1. **Principal column**
   - user search
   - user status
   - direct/role/legacy source counters
   - current scope selector

2. **Current permissions panel**
   - searchable table grouped by application
   - columns: App, Module, Action, Scope, Source, Revoke/Go to source
   - direct revoke inline
   - role and legacy sources explained without pretending they are direct grants

3. **Grant editor**
   - Application selector
   - Module/submodule selector
   - Action matrix with `view` gateway behavior
   - Scope picker
   - Preview button
   - Save button enabled only when draft is valid and preview matches draft

4. **Legacy conversion panel**
   - list legacy module/submodule grants
   - show mapped modern actions
   - convert one group at a time
   - revoke legacy after conversion succeeds

## Acceptance Criteria

- Admin can pick a user and see all effective permissions with source and scope.
- Admin can grant an enforced module action and `view` is automatically included.
- Admin cannot remove `view` while sibling actions remain.
- Admin can revoke direct grants from the current permissions list.
- Admin can see legacy permissions and remove them without creating new legacy grants.
- Admin can convert legacy permissions into modern grants through preview and save.
- Asset permissions keep working exactly as implemented in the Asset permission rollout.
- HRM permissions follow the same UX pattern before deeper HRM-specific backend hardening.
- No new workflow relies on `allowedModules` or `adminModules` as the primary grant path.
- No frontend-only permission is treated as secure unless there is backend enforcement or explicit compatibility labeling.

## Non-Goals

- This spec does not redesign Business Role authoring.
- This spec does not remove the existing legacy columns immediately.
- This spec does not claim every HRM action is backend-enforced yet.
- This spec does not replace the already verified Asset migration baseline.

## Implementation Notes

Current files that already matter:

- `lib/permissions/erpPermissionRegistry.ts` defines application/module/action registry.
- `lib/permissions/permissionReadiness.ts` defines readiness and direct-grant availability.
- `lib/permissions/permissionService.ts` evaluates frontend route/action checks and legacy fallback.
- `lib/permissions/unifiedPermissionViewModel.ts` already contains `toggleUnifiedDirectGrant`, `buildCurrentPermissionOverview`, and legacy catalog helpers.
- `components/permissions/DirectUserPermissionWorkspace.tsx` is the current admin workspace surface.
- `components/permissions/UnifiedPermissionMatrix.tsx` renders the action matrix.
- `supabase/migrations/20260720100000_asset_action_operation_guards.sql` is the reference for backend-enforced action guards.

The next implementation plan should extend the current workspace instead of introducing a second permission admin screen.
