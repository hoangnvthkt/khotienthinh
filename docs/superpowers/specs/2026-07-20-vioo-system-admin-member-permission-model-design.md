# VIOO System Admin and Member Permission Model

**Date:** 2026-07-20

**Status:** Approved by operator

**Supersedes:** `2026-07-20-vioo-base-style-user-application-permission-model-design.md`

**Scope:** Account roles, application access, System Admin read/configuration authority, explicit business mutations, sensitive actions, pilot hard cutover, recovery, and administration UX.

## 1. Purpose

VIOO will use the smallest authorization administration model compatible with its pilot operation:

- exactly one active System Admin account controlled by the operator;
- every other account is a Member;
- no Application Administrator role, access level, capability, assignment, or UI control;
- Members receive application access and detailed business permissions directly;
- System Admin coordinates accounts, applications, configuration, and permissions;
- System Admin can view all business data but cannot mutate business data by role alone.

The backend remains explicit, scoped, audited, deny-by-default, and protected by RLS/RPC/private authorization helpers.

## 2. Approved Decision

The effective decision model is:

```text
Account role
  + Application membership (Member only)
  + Explicit business permission
  + Scope
  + Assignment or relationship
  + Workflow state
  + Sensitive-action controls
  -> Authorization decision
```

System Admin has two narrowly defined implicit capabilities:

```text
SYSTEM_ADMIN_VIEW
SYSTEM_ADMIN_CONFIGURATION
```

Neither capability implies business create, edit, delete, submit, confirm, approve, pay, close, adjust, import, export, bulk-process, or other business mutation.

## 3. Rejected Alternatives

### 3.1 Application Administrator per application

Rejected because the pilot has one central operator and does not need delegated application configuration. Keeping this layer would add membership states, resolver sources, UI toggles, audit cases, and migration work without a current business user.

### 3.2 System Admin unrestricted business-data authority

Rejected because role-based mutation bypass would defeat scope, workflow, assignment, audit, and separation-of-duties controls. It would also make sensitive approvals implicit.

### 3.3 Delegated configuration grants to Members

Rejected for this phase because it recreates Application Administrator under another name. If delegation becomes necessary later, it requires a separate approved design.

## 4. Account Roles

### 4.1 System Admin

VIOO has exactly one active System Admin account in normal operation.

System Admin may:

- create, update, disable, and reactivate Member accounts;
- assign and revoke Member application access;
- grant and revoke Member business permissions through governed commands;
- manage system parameters, templates, shared catalogs, workflow definitions, and permission configuration through an explicit configuration allowlist;
- open every active application;
- view all readable business data across every project, warehouse, department, assignment, and supported scope;
- inspect permission sources, audit evidence, health checks, and cutover status.

System Admin may not by role alone:

- create, edit, delete, submit, return, verify, confirm, approve, pay, close, adjust, receive, issue, import, export, or bulk-process business records;
- bypass workflow state, maker-checker, SoD, ownership, or other mutation preconditions;
- self-grant a sensitive business action;
- disable or demote the only active System Admin;
- create a second active System Admin through ordinary product UI or browser RPC.

System Admin can receive an explicit non-sensitive business mutation grant when operationally necessary. The grant follows the same scope, assignment, workflow, expiry, and audit rules as a Member grant. Because there is only one System Admin, sensitive business actions are assigned to eligible Members in normal operation; the System Admin account is not self-granted those actions.

### 4.2 Member

A Member:

- opens only applications explicitly assigned to the account;
- sees only business data allowed by the applicable view permission, scope, and relationship;
- creates or mutates data only with an explicit action permission and all required business preconditions;
- cannot access System Admin configuration or permission administration;
- may receive a sensitive business action only from System Admin through the governed grant flow.

Legacy global account labels such as warehouse keeper are business assignments and scoped permissions, not account roles.

## 5. Single-Admin Availability and Recovery

The single-admin rule is intentional but creates an availability risk. VIOO must enforce and mitigate it explicitly:

- the last/only active System Admin cannot be disabled, demoted, deleted, or stripped of account-administration authority through normal commands;
- the product cannot promote a Member to System Admin while another active System Admin exists;
- ordinary users and the System Admin cannot alter role fields directly;
- emergency recovery uses a service-role-only procedure outside the browser;
- emergency promotion or restoration requires a reason, change reference, operator identity, before/after snapshot, and audit event;
- recovery never grants business mutation or sensitive approval permissions automatically;
- after recovery, the system again contains exactly one active System Admin.

The implementation plan must include a tested recovery runbook before pilot hard cutover.

## 6. Application Access

Application membership answers only:

> May this Member open this application?

For Members the effective state is:

```text
NONE | MEMBER
```

Rules:

- `NONE` hides and blocks the application;
- `MEMBER` opens the application shell but does not grant all modules, records, or actions;
- application membership is a prerequisite for every Member permission in that application;
- removing membership atomically revokes the application's active Direct Grants;
- historical project, warehouse, department, workflow, and document relationships remain for audit but no longer create access;
- re-adding an application does not restore previously revoked grants;
- inactive accounts have no effective membership;
- System Admin receives effective access to every active application through the resolver and does not need membership rows.

The membership relation therefore does not need an access-level or App Admin column. It retains status and grant/revoke evidence:

```text
user_application_memberships
  id
  user_id
  application_code
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

Only Members receive rows under normal operation.

## 7. System Admin Universal View

System Admin has read-only global visibility for operational oversight.

### 7.1 View semantics

System Admin may:

- open all active applications and registered module routes;
- list and read records across all supported scopes;
- follow a valid deep link or notification to a readable record;
- access read-only dashboards, reports, audit views, and record details.

System Admin view bypasses project, warehouse, department, ownership, and assignment restrictions only for read operations.

It does not bypass:

- account activation and authentication;
- application/module registration;
- record existence and archival rules that are part of data integrity rather than authorization;
- field-level redaction explicitly required by a later privacy design;
- any insert, update, delete, state transition, side effect, export, or bulk command.

### 7.2 Read operation classification

Universal view applies only to operations classified as read-only in the permission catalog and backend contract. Normally these are permission actions with `action = 'view'` or `permission_group = 'access'`.

Operations named `report`, `download`, `export`, `summarize`, or `generate` are not assumed to be read-only. Each must be classified by actual side effects and data-exfiltration risk. Until classified and enforced, it is not included in implicit System Admin view.

### 7.3 Backend boundary

RLS SELECT policies and read-only RPCs may recognize the effective `SYSTEM_ADMIN_VIEW` capability. INSERT, UPDATE, DELETE, state-transition RPCs, Edge Functions, triggers, and storage mutations must not recognize it as mutation authority.

Frontend route visibility is not sufficient evidence; direct API behavior must match.

## 8. System Admin Configuration Authority

System Admin can configure VIOO without receiving a separate per-app administrator assignment.

Configuration authority is an explicit allowlist in the permission catalog, for example:

```text
system.accounts.manage
system.authorization.manage_grants
system.authorization.audit
system.settings.manage
project.settings.manage
project.template.manage
project.workflow.configure
wms.settings.manage
wms.master_data.manage
hrm.settings.manage
hrm.master_data.manage
workflow.template.manage
request.category.manage
request.template.manage
contract.template.manage
expense.master_data.manage
```

The final list must correspond to real frontend controls and backend operations. A permission is classified as configuration only when it changes shared system/application setup rather than a business transaction.

Configuration authority does not automatically include:

- creating a project, warehouse transaction, contract, purchase order, payment, employee business record, request instance, or workflow instance;
- editing/deleting another user's business record;
- operational imports/exports or bulk mutations;
- sensitive business actions.

Creation of root business objects such as projects or warehouses is a business mutation and requires an explicit permission code even for System Admin.

The permission catalog uses a dedicated group such as:

```text
permission_group = 'system_admin'
```

Only the canonical System Admin resolver may produce these permissions implicitly. Members cannot receive this group during the pilot.

## 9. Business Permissions, Scopes, and Assignments

Business actions remain explicit:

```text
project.material_boq.view
project.material_boq.edit
project.material_boq.delete
project.payment.approve
wms.transaction.complete
```

The mutation authorization rule for both Member and System Admin is:

```text
ALLOW_MUTATION =
  active account
  AND (System Admin OR active application membership)
  AND explicit action permission
  AND matching scope
  AND required assignment or relationship
  AND valid workflow state
  AND no sensitive-action or SoD denial
```

System Admin's universal view is not inserted into `ALLOW_MUTATION`.

Canonical relationships continue to include:

- `project_staff` for project data;
- warehouse responsibility for WMS mutations;
- department/position relationships for HRM mutations;
- owner, creator, assignee, watcher, and workflow responsibility slots;
- other reviewed application-specific relationships.

Knowing a route, record ID, notification link, or API endpoint never grants mutation authority.

## 10. Sensitive Business Permissions

Sensitive actions remain separate from System Admin role and configuration authority.

Examples include:

- final payment approval or release;
- payroll close/release;
- high-impact stock adjustment;
- sensitive financial confirmation;
- permission-governance overrides;
- other actions marked `risk_level = sensitive`.

Rules:

- only System Admin may grant or revoke a sensitive permission for an eligible Member;
- System Admin status does not itself grant the business action;
- the sole System Admin cannot self-grant a sensitive permission;
- grants require reason, audit, and expiry when the permission policy requires it;
- Preview, SoD, maker-checker, assignment, scope, and workflow checks remain mandatory;
- readiness must be `enforced` or `verified` before grant;
- emergency service-role recovery does not grant sensitive actions;
- every sensitive allow and denial produces appropriate evidence.

## 11. Effective Permission Sources

The resolver may emit understandable evidence types:

```text
SYSTEM_ADMIN_VIEW
SYSTEM_ADMIN_CONFIGURATION
DIRECT
ROLE
LEGACY       (pre-cutover only)
```

There is no `APP_ADMIN` source.

Required behavior:

- System Admin receives global read sources for reviewed read-only operations;
- System Admin receives configuration sources only for the explicit allowlist;
- business mutation sources come from explicit grants/approved role templates, not System Admin role;
- Members receive no implicit configuration source;
- Legacy sources disappear after cutover;
- inactive accounts receive no effective sources.

## 12. Administration Experience

The UI keeps Base-style simplicity without Application Administrator controls.

### 12.1 Create or edit account

The form contains:

- identity/contact fields;
- role: Member or System Admin;
- optional initial application assignments for a Member;
- notification options where applicable.

Only one active System Admin is allowed. For the existing System Admin, role controls that would create zero or two admins are disabled and enforced by backend commands.

### 12.2 Application access

For a Member:

```text
Project       [Use application]
WMS           [Use application]
HRM           [Use application]
```

There is no Application Administrator checkbox, badge, chip, access level, filter, or command.

For System Admin, the UI states that every application and every read-only view is available automatically. It does not create membership rows.

### 12.3 Detailed permissions

The operator flow is:

1. select Member;
2. assign application use;
3. select application;
4. select concrete scope and subject assignment;
5. select explicit business actions;
6. Preview;
7. enter reason and required sensitive metadata;
8. Apply atomically.

When inspecting the System Admin account, the matrix shows implicit global view and configuration evidence as read-only. Business mutation checkboxes remain governed explicit grants. Sensitive mutation self-grant controls remain unavailable.

### 12.4 Legacy UI

Legacy module/submodule administration and conversion controls are not part of the final product. Legacy is inventory/snapshot data before cutover and recovery data during the retention window only.

## 13. Governed Commands and Failure Behavior

Browser clients do not directly mutate account roles, memberships, grants, audit rows, rollout flags, or Legacy fields.

The command sequence is:

```text
Preview
  -> authenticate canonical System Admin
  -> validate exactly-one-admin invariant
  -> validate target and application membership
  -> validate readiness, action, scope, assignment, risk, and SoD
  -> calculate affected memberships/grants
Apply atomically
  -> compare preview fingerprint
  -> update membership/grants
  -> append audit
  -> emit authorization refresh
```

Required failures:

- any failure rolls back the complete command;
- stale fingerprints require a new Preview;
- Member application removal revokes that app's grants in the same transaction;
- re-adding membership does not restore revoked grants;
- the only System Admin cannot be disabled/demoted;
- a second active System Admin cannot be created by ordinary commands;
- System Admin cannot self-grant sensitive business permission;
- inactive accounts cannot receive effective access;
- UI success appears only after backend Apply succeeds;
- authorization changes refresh active sessions promptly.

## 14. Pilot Hard Cutover

The approved pilot hard-cutover direction remains unchanged, with App Admin removed from the target manifest.

Before cutover:

- export an immutable encrypted snapshot of every active user's role, warehouse compatibility field, and four Legacy authorization fields;
- inventory application access, project membership, warehouse responsibility, departments, workflows, and sensitive duties;
- define every Member's target application memberships, explicit grants, scopes, and assignments;
- define the sole System Admin account;
- verify all required mutation actions as `enforced` or `verified`;
- verify System Admin read-only global access for every active pilot read workflow;
- verify all configuration allowlist operations;
- rehearse exact Apply and rollback.

Atomic cutover:

- convert active `WAREHOUSE_KEEPER` accounts to Member;
- install Member application memberships and explicit grants;
- preserve canonical assignments;
- clear `allowedModules`, `allowedSubModules`, `adminModules`, and `adminSubModules`;
- enable `legacy_fallback_disabled` and disable administrator business-approval bypass;
- append audit and emit authorization refresh;
- require zero effective `LEGACY` and `APP_ADMIN` sources.

Rollback restores the exact snapshot only within the approved recovery window and only if post-cutover state has not drifted.

## 15. Verification Requirements

The system must prove:

1. exactly one active System Admin exists;
2. normal commands cannot create zero or two active System Admins;
3. System Admin can open every application;
4. System Admin can read records across projects, warehouses, departments, ownership, and assignments;
5. `SYSTEM_ADMIN_VIEW` cannot insert, update, delete, transition, export, or trigger side effects;
6. System Admin can execute only configuration operations on the explicit allowlist;
7. System Admin cannot create/edit/delete business data without an explicit action grant;
8. System Admin cannot self-grant or implicitly perform a sensitive action;
9. Member without application membership cannot open or call the application;
10. Member with membership but without action/scope/assignment cannot access business data;
11. correct Member action + scope + assignment allows the intended operation;
12. wrong project/warehouse/department/ownership/workflow state is denied by backend;
13. edit does not imply delete;
14. removing membership revokes app grants and updates the active session;
15. re-adding membership does not restore grants;
16. no keeper-role, module-admin, broad-admin mutation, Legacy, or App Admin source remains after cutover;
17. every role, membership, grant, revoke, sensitive decision, cutover, and recovery change has audit evidence;
18. emergency single-admin recovery restores administration only, not business mutations.

Tests include frontend visibility plus direct backend allow/deny evidence. Frontend hiding alone is never sufficient.

## 16. Non-goals

This design does not introduce:

- Application Administrator or delegated app configuration;
- unrestricted System Admin business mutations;
- implicit sensitive approvals;
- automatic project/warehouse/department assignment from app access;
- automatic root-business-object creation authority;
- a long-lived Legacy/new dual mode;
- product-facing Legacy conversion;
- direct browser writes to authorization tables;
- multi-tenant IAM;
- an external IAM/GRC platform.

## 17. Success Criteria

The design succeeds when:

1. the operator is the sole active System Admin;
2. all other active accounts are Members;
3. no App Admin concept exists in database target state, resolver, commands, UI, or cutover manifest;
4. System Admin can view all business data safely and globally;
5. System Admin configuration authority is explicit and auditable;
6. all business mutations require explicit permission, including for System Admin;
7. sensitive actions are granted separately to eligible Members and never implied by System Admin;
8. Members receive only assigned applications/actions/scopes/relationships;
9. the pilot hard cutover ends with no Legacy authorization source and a tested recovery artifact.
