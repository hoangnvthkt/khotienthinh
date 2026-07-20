# VIOO Base-style User and Application Permission Model

> **Superseded on 2026-07-20:** The Application Administrator layer in this
> document is no longer approved. The replacement design is
> `2026-07-20-vioo-system-admin-member-permission-model-design.md`.

**Date:** 2026-07-20
**Status:** Approved by operator
**Scope:** Account roles, application access, application administration, scoped business permissions, pilot hard cutover from Legacy, administration UX, backend enforcement, and rollout sequencing.

## 1. Purpose

VIOO will adopt the simple user and application administration experience demonstrated by Base.vn while retaining VIOO's explicit action permissions, scopes, assignments, workflow checks, audit, and separation-of-duties controls.

The operator experience must answer four separate questions:

1. Is this account a normal member or a high-level administrator?
2. Which applications may this user open?
3. Which applications may this user configure?
4. What business data and actions may this user access inside each application?

These questions must not be collapsed into a single legacy `adminModules` or `adminSubModules` checkbox.

## 2. Approved Direction

The approved model is a hybrid of Base-style administration and the existing VIOO authorization architecture:

```text
Account role
  + Application membership
  + Application administration capability
  + Explicit business permission
  + Scope and subject assignment
  + Workflow state
  + Sensitive-action controls
  -> Authorization decision
```

The UI is deliberately simple and user-centered. The backend remains explicit and deny-by-default.

This design refines the UI and role boundaries described in the existing authorization and application-permission specifications. It does not remove scoped Direct Grants, effective-source evidence, backend enforcement, SoD, or audit requirements.

Because VIOO is still in pilot operation and has a small user population, the approved rollout is a **pilot hard cutover**. VIOO will rebuild the active users' permissions in the new model and disable Legacy authorization in one controlled maintenance event after enforcement verification. The product will not build a long-lived dual-mode migration experience or a Legacy conversion workbench.

## 3. Account Roles

VIOO has two canonical account roles.

### 3.1 High-level Administrator

The High-level Administrator:

- creates, updates, disables, and reactivates user accounts;
- grants and revokes application access;
- grants and revokes Application Administrator capability;
- is treated as Application Administrator for every application;
- can grant and revoke sensitive business permissions through governed commands;
- can access every application's customization area;
- is subject to last-administrator, self-grant, SoD, scope, assignment, and workflow controls.

The High-level Administrator does not automatically receive sensitive business approvals. It also does not automatically receive access to data inside a project, warehouse, department, or other scoped business subject when no assignment exists.

### 3.2 Member

The Member:

- opens only applications explicitly assigned to the account;
- cannot access an application's customization area unless separately assigned as Application Administrator;
- sees and creates business work only within an applicable own, assigned, project, warehouse, department, or other supported scope;
- receives edit, delete, approve, bulk-operation, and other elevated business actions only through explicit permission and assignment rules.

Legacy global account labels such as warehouse keeper must become business assignments or scoped permissions rather than permanent system-wide account roles.

## 4. Application Membership

Application membership answers only:

> May this user open this application?

For each user and application, the effective access level is:

```text
NONE | MEMBER | APP_ADMIN
```

Rules:

- `NONE` hides and blocks the application.
- `MEMBER` opens the application shell but does not grant access to all modules or business data.
- `APP_ADMIN` includes application membership and opens the application's customization area.
- Enabling `APP_ADMIN` automatically enables application membership.
- Application membership is a prerequisite for any business permission in that application.
- Removing application membership revokes Application Administrator capability and deactivates the application's Direct Grants through one governed command.
- Historical project, warehouse, department, workflow, and document relationships are retained for audit and record integrity but no longer create access.
- Re-adding the application does not silently restore previously revoked permissions.

High-level Administrators receive effective `APP_ADMIN` capability for all applications through the resolver; duplicate membership rows are not required.

## 5. Application Administrator

Application Administrator means permission to use the application's **Customization** area. It is not unrestricted CRUD access to all application data.

Application Administrator capabilities may include:

- managing application parameters and shared catalogs;
- creating and editing templates, forms, and fields;
- configuring workflow definitions and statuses;
- configuring automation;
- executing explicitly identified administrative or bulk operations;
- creating root containers such as a project, warehouse, department, or equivalent application object;
- configuring application membership or responsibility rules where the application permits it;
- accessing application help or operational guidance intended for administrators.

Each application must declare its customization permissions explicitly. Example permission codes include:

```text
project.master.create
project.settings.manage
project.template.manage
project.workflow.configure
wms.settings.manage
wms.master_data.manage
wms.warehouse.create
```

The final catalog must use names that correspond to real frontend and backend operations. A broad `project.manage` or similar umbrella must not silently imply every data action.

Application Administrator does not automatically grant:

- access to all existing projects, warehouses, departments, records, or documents;
- edit or delete access to another user's business data;
- approval, final confirmation, payment, payroll close, stock adjustment, or other sensitive business actions;
- bypass of assignment, scope, workflow state, maker-checker, or SoD rules.

Creating a project or warehouse does not automatically add the Application Administrator as a member. The administrator receives data access only after an explicit assignment or application-specific rule approved in a separate design.

## 6. Business Permissions and Assignments

Business permissions continue to use explicit permission codes and scopes. Examples:

```text
project.material_boq.view
project.material_boq.edit
project.material_boq.delete
project.payment.approve
```

Direct user exceptions continue to be stored in `user_permission_grants` with:

- `user_id`;
- `permission_code`;
- `scope_type`;
- `scope_id`;
- activation and expiry state;
- governed grant/revoke metadata and audit evidence.

Business subject access continues to depend on application-specific relationships, including:

- `project_staff` membership for project data;
- warehouse responsibility for WMS data;
- department and position relationships for HRM;
- creator, owner, assignee, watcher, and responsibility slots for workflows;
- other explicit application relationships introduced through reviewed module designs.

The authorization rule is:

```text
ALLOW =
  active account
  AND application membership
  AND effective action permission
  AND matching data scope
  AND required assignment or relationship
  AND valid workflow state
  AND no sensitive-action or SoD denial
```

Knowing a route, record ID, notification link, or API endpoint never grants access.

## 7. Sensitive Business Permissions

Sensitive permissions are separate from account role and Application Administrator capability.

Examples include:

- final payment approval;
- payroll closing or release;
- high-impact stock adjustment;
- sensitive financial confirmation;
- permission administration;
- other actions classified as `risk_level = sensitive`.

Rules:

- only a High-level Administrator may grant or revoke a sensitive permission;
- High-level Administrator status does not itself grant the permission;
- Application Administrator status does not grant the permission;
- a High-level Administrator cannot self-grant a sensitive permission;
- grants require a reason and may require expiry;
- Preview, SoD evaluation, last-administrator rules, audit, assignment, scope, and workflow state remain mandatory;
- backend RLS, RPC, triggers, or private authorization helpers remain the enforcement boundary.

## 8. Data Model

### 8.1 Canonical account role

The target account-role semantics are:

```text
SUPER_ADMIN | MEMBER
```

The implementation plan must inventory current `Role.ADMIN`, `Role.EMPLOYEE`, and `Role.WAREHOUSE_KEEPER` dependencies before deciding whether to rename stored enum values or introduce a compatibility adapter. The approved behavior is more important than an immediate enum rename.

### 8.2 Application membership

A dedicated relation is recommended:

```text
user_application_memberships
  id
  user_id
  application_code
  access_level       MEMBER | APP_ADMIN
  status             ACTIVE | REVOKED
  granted_by
  granted_reason
  granted_at
  revoked_by
  revoked_reason
  revoked_at
  created_at
  updated_at
```

Required properties:

- unique active membership per user/application;
- appendable audit evidence for grant and revoke;
- RLS enabled;
- browser writes only through governed commands;
- application codes reference the canonical application catalog;
- account disablement overrides all memberships.

### 8.3 Application customization catalog

The permission catalog must identify which action permissions are Application Administrator capabilities. This may be represented by a permission group or equivalent explicit metadata, for example:

```text
permission_group = 'app_admin'
```

The resolver may produce understandable effective-source evidence such as `APP_ADMIN`, but must not translate Application Administrator into every action in the application.

### 8.4 Existing Direct Grants and assignments

`user_permission_grants` remains the canonical direct exception mechanism. Existing project, warehouse, department, and workflow assignment data remains canonical for subject relationships. This design does not replace those structures with application membership.

## 9. Administration Experience

The UI follows the Base.vn layout language: light modal or page surfaces, simple account fields, application chips/cards, searchable application selection, and separate commands for application use and application administration.

### 9.1 Create account

The account form contains:

- basic identity and contact fields;
- account role: Member or High-level Administrator;
- optional initial applications;
- account notification options when applicable.

The create-account form does not display the complete business permission matrix.

For a High-level Administrator, all applications and Application Administrator capability are effective automatically. Sensitive business permissions remain separate.

### 9.2 Application access

After account creation, the operator uses a dedicated **Application Access** command:

```text
Project       [Use application] [Application Administrator]
WMS           [Use application] [Application Administrator]
HRM           [Use application] [Application Administrator]
```

Applications may be added through a searchable list and shown as removable chips or cards, matching the Base-style interaction.

### 9.3 Detailed business permissions

Each assigned application exposes **Configure business permissions** only when detailed administration is required.

The detailed flow is:

1. choose a user;
2. choose an application;
3. choose the concrete project, warehouse, department, or supported scope;
4. choose a module or submodule;
5. select explicit actions;
6. Preview the backend decision;
7. enter the required reason and Apply.

Technical source evidence such as Direct, Role, assignment, or Application Administrator is shown in an advanced explanation area, not as the primary operator workflow. Legacy evidence is available only in the pre-cutover inventory and rollback snapshot; it is not part of the post-cutover administration experience.

### 9.4 Assignment inside an application

Project, warehouse, department, and workflow assignments remain managed within the owning application. The account administration page may summarize and deep-link to assignments but must not fabricate subject membership merely because application access was granted.

## 10. Governed Commands and Error Handling

Frontend code must not directly mutate application memberships, grants, role assignments, authorization audit tables, or Legacy source fields. The hard cutover is executed by a dedicated governed backend command or reviewed migration procedure, never by browser-side table updates.

The change sequence is:

```text
Preview
  -> validate actor authority and target status
  -> calculate affected app access and grants
  -> evaluate readiness, risk, scope, assignment, and SoD
  -> display warnings and hard denials
Apply atomically
  -> update membership and grant state
  -> append audit
  -> emit refresh/realtime signal
```

Required failure behavior:

- any failure rolls back the complete command;
- stale Preview fingerprints require reloading and Preview again;
- an Application Administrator toggle cannot remain active when membership is removed;
- the last High-level Administrator cannot be demoted or disabled;
- an actor cannot self-grant a sensitive permission;
- an inactive account cannot receive effective access;
- session authorization must refresh promptly after membership or grant changes;
- UI success is shown only after the governed Apply command succeeds.

## 11. Pilot Hard Cutover From Legacy

Legacy remains active only while the replacement authorization model is being completed and verified. It is not a supported operating mode after the pilot cutover.

The cutover deliberately rebuilds permissions rather than automatically translating broad Legacy administration:

- export a complete, immutable snapshot of every active user's `allowedModules`, `allowedSubModules`, `adminModules`, and `adminSubModules` before mutation;
- inventory current application access, project membership, warehouse responsibility, department relationships, and sensitive duties;
- manually define the intended application membership, Application Administrator capability, Direct Grants, scope, and assignments for every pilot user;
- do not automatically convert `adminModules` or `adminSubModules` to Application Administrator because Legacy administration represented broad data CRUD rather than application customization;
- do not build a product-facing Legacy conversion panel or maintain editable Legacy checkboxes in the new Base-style screens;
- verify every action required by pilot users as `enforced` or `verified` before the cutover;
- treat `declared` and `legacy` actions as cutover blockers when an active pilot workflow depends on them;
- apply new memberships and grants, revoke Legacy arrays, enable `legacy_fallback_disabled`, append audit evidence, and trigger authorization refresh in one controlled maintenance event;
- require the final post-cutover resolver to produce no `LEGACY` effective sources;
- retain the snapshot for emergency rollback for a defined short retention period, without keeping Legacy enabled during normal operation.

Emergency rollback restores the snapshot and the fallback flag only when the cutover validation fails. Rollback is an operational recovery procedure, not a second permission administration mode.

## 12. Rollout Sequence

### Phase 1 — Account and application foundation

- introduce the two-role account experience;
- introduce application membership and Application Administrator assignment;
- implement the Base-style account/application UI;
- keep Legacy unchanged and read-only while replacement work is in progress;
- enforce membership as an application-access prerequisite.

### Phase 2 — Application customization permissions

- inventory the customization area of every application;
- declare explicit settings, template, catalog, automation, bulk-operation, and root-container actions;
- enforce those actions in frontend and backend;
- allow Application Administrator assignment to resolve only these actions.

### Phase 3 — Detailed business actions

- define real actions for every pilot workflow previously relying on Legacy module/submodule administration;
- enforce each action in UI and backend;
- separate edit from delete;
- promote actions to `enforced` or `verified` only with evidence;
- keep declared or legacy-only actions non-grantable;
- configure the complete target membership, grant, scope, and assignment set for every pilot user in a cutover draft;
- run positive, adjacent-negative, wrong-scope, and sensitive-action tests against that draft.

### Phase 4 — Single pilot hard cutover

- freeze permission administration for the maintenance window;
- export and verify the Legacy snapshot and rollback artifact;
- atomically activate the approved application memberships and explicit grants;
- atomically clear or revoke `allowedModules`, `allowedSubModules`, `adminModules`, and `adminSubModules` as active authorization sources;
- enable `legacy_fallback_disabled` globally;
- refresh active authorization sessions and realtime listeners;
- verify every pilot user against the approved access checklist;
- monitor denial logs, permission health, and audit events;
- use the emergency rollback procedure only if the cutover validation fails.

## 13. Verification Requirements

Every application must prove:

1. a user without application membership cannot open the application;
2. a Member can open the application shell but cannot access unassigned business data;
3. a Member can view or create work only within supported own or assigned scope;
4. an Application Administrator can access the customization area;
5. an Application Administrator cannot access business data outside assignment and scope;
6. an Application Administrator cannot perform a sensitive business action without an explicit sensitive grant;
7. a High-level Administrator can configure every application but cannot bypass sensitive permission, assignment, scope, workflow, or SoD checks;
8. edit does not imply delete unless an action contract explicitly and visibly states otherwise;
9. wrong project, warehouse, department, or record relationship is denied by the backend;
10. removing application membership takes effect in the active session;
11. re-adding an application does not silently restore revoked grants;
12. no Legacy source contributes to effective authorization after the hard cutover;
13. direct API, guessed route, or known record ID does not bypass enforcement;
14. every grant, revoke, role change, membership change, and sensitive decision has audit evidence.

Tests must cover frontend visibility and backend denial/allow behavior. Frontend-only hiding is never sufficient evidence.

## 14. Non-goals

This design does not introduce:

- unrestricted Application Administrator access to application data;
- automatic sensitive approvals for High-level Administrators;
- automatic project or warehouse membership for object creators;
- a single broad `manage` permission as a replacement for legacy administration;
- automatic translation of Legacy administration rights;
- a long-lived dual-mode Legacy/new permission experience;
- a product-facing Legacy conversion workbench;
- direct browser mutation of authorization tables;
- negative-grant policy language;
- multi-tenant authorization;
- a general-purpose external IAM or GRC product.

## 15. Success Criteria

The design is successful when an operator can:

1. create a Member or High-level Administrator through a simple Base-style account form;
2. assign application use independently from application customization;
3. assign Application Administrator capability without granting unrestricted business data access;
4. grant exact business actions at the correct scope;
5. understand why access exists without learning internal authorization implementation details;
6. prove that sensitive, cross-scope, and unassigned actions are denied by the backend;
7. complete one controlled pilot hard cutover with verified replacement permissions, no post-cutover Legacy effective sources, and a tested emergency rollback artifact.
