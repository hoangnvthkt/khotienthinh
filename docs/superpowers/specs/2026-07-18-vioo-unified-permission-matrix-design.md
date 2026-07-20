# VIOO Unified Permission Matrix Design

**Date:** 2026-07-18

**Status:** Approved in design review

**Scope:** Permission administration experience, compatibility mapping, preview/save contract, and focused verification
**Cloud constraint:** No Cloud mutation, rollout-flag change, legacy cutover, or continuation of the paused sensitive regrant Task 4 is authorized by this design.

## 1. Context

The current user administration modal exposes three permission concepts as separate blocks:

1. legacy module and submodule visibility through `allowedModules` and `allowedSubModules`;
2. legacy module and submodule administration through `adminModules` and `adminSubModules`;
3. governed Direct Grants through the permission registry and permission matrix.

This is technically expressive but presents three apparent permission systems to an Admin. Source badges, scope selection, risk metadata, expiry, SoD, and legacy compatibility are all important, but they compete with the primary business decision: what may this person see and do in this part of the application?

The approved mental model is “gate and keys”:

- `View` is the gate into an application area;
- Create, Edit, Delete, Submit, Verify, Approve, and other actions are separate keys inside that area;
- access varies by module, submodule, and scope;
- the Admin chooses the intended access, while authorization governance still controls how sensitive changes may be applied.

This design simplifies the Admin experience without weakening backend authorization, scope enforcement, audit, expiry, or SoD.

## 2. Decision

Adopt one unified, source-aware permission matrix organized by:

```text
Application -> Module -> Submodule/permission module -> Supported actions
```

The main interface expresses business intent. Technical provenance and migration controls remain available in an Advanced area.

Two alternatives were rejected:

- Reordering the existing three blocks would be cheaper but would preserve the fragmented mental model.
- Replacing legacy permission sources immediately would be cleaner eventually but would bypass the controlled migration lifecycle and is not safe before module readiness and explicit cutover approval.

## 3. Information architecture

The Admin workflow is:

1. Select a user.
2. Select a scope when the chosen permission supports one, such as global, project, construction site, warehouse, department, own, or assigned.
3. Navigate an application/module/submodule tree.
4. Configure the supported actions for the selected permission module.
5. Review a human-readable change summary.
6. Preview the governed authorization decision.
7. Save the complete changeset once.

The main action area displays only actions supported by the selected permission module, for example:

```text
View | Create | Edit | Delete | Submit | Verify | Approve
```

It must not show a universal action list containing meaningless or unsupported choices.

The main screen does not lead with raw permission codes, Role/Direct/Legacy mechanics, source-mode controls, audit details, or SoD evidence. Those details remain accessible through an Advanced drawer named in business language, such as “Why does this user have this permission?”

## 4. View as the master access control

### 4.1 Admin interaction rules

- Selecting any mutation or workflow action automatically selects or derives `View` in a compatible scope.
- Clearing `View` selects all editable Direct Grants beneath it for removal in the same scope.
- Clearing a whole module selects its editable submodule visibility and Direct Grants for removal.
- An action scoped to Project A must not create global visibility or visibility in Project B.
- Unsupported actions do not appear.
- `Edit` never implies `Submit`, `Verify`, `Confirm`, `Approve`, or another neighboring workflow action.

### 4.2 Runtime authorization rule

`View` is the master navigation and presentation control, but it does not replace the backend check for an action. When a user performs an edit, the trusted backend checks the exact Edit permission, scope, assignment, object state, and any applicable SoD rule.

The runtime must not use View as a substitute for action authorization. It also must not create an unnecessary two-record dependency that denies an otherwise valid Role or Direct action source. An effective action may derive the minimum route visibility needed to reach that action, while the Admin UI ensures newly authored Direct Grants include or derive View consistently.

This preserves the existing authoritative-source principle: route visibility and business-action authorization are related but not interchangeable.

## 5. Source-aware effective state

Each displayed action distinguishes intended Direct state from effective access. The simplified states are:

| UI state | Meaning | Admin behavior |
|---|---|---|
| Empty | No current effective source | May add a Direct Grant if the action is grantable |
| Direct | Active Direct Grant in the selected scope | May remove or change it |
| Role | Effective permission inherited from a Business Role | Read-only here; edit the Role assignment or definition |
| Legacy | Effective access retained by legacy visibility or administration | Read-only as a granular source; use controlled migration/source-mode controls |
| Mixed | More than one effective source | Removing Direct does not claim that effective access is gone |

The main checkbox must never pretend that removing one source removed effective access when a Role or Legacy source remains.

Raw source records, expiry, scope identifiers, and permission codes are visible in Advanced details for investigation, not as the primary Admin workflow.

## 6. Compatibility mapping

During controlled migration, the unified interface presents these concepts:

| Business concept | Compatible sources |
|---|---|
| View | `allowedModules`, `allowedSubModules`, or an exact `*.view` permission source |
| Granular action | Exact registered Role or Direct permission in a compatible scope |
| Legacy administration | `adminModules` or `adminSubModules`, shown explicitly as a legacy umbrella |
| Governed authorization administration | Specific actions such as manage roles, manage grants, manage scopes, audit, or override |

Legacy administration must not be visually expanded into a fictional set of verified granular permissions. If a legacy `manage` source still covers an area, the UI labels it as an umbrella and explains that removing a Direct checkbox may not reduce effective authority.

A controlled replacement of legacy access follows this sequence:

1. Preview which new permissions cover the legacy source.
2. Identify permissions that would be lost and legacy behavior that is unmapped.
3. Add only the required new Role or Direct permissions.
4. Disable legacy for the exact user/module/scope through the governed source-mode workflow.
5. Save atomically with audit.
6. Verify effective access and focused negative canaries.

The UI must not perform bulk legacy cutover, silently restore legacy projection, or change rollout flags.

## 7. Granular action model

The permission vocabulary is grouped for comprehension, but each permission module declares only its real actions:

- Access: View.
- Data operations: Create, Edit own, Edit all, Delete own, Delete all.
- Workflow transitions: Submit, Return, Verify, Confirm, Approve.
- Domain actions: Export, Receive, Publish, Lock, Assign, Mark paid, and similarly specific operations.
- Governance actions: Manage roles, Manage grants, Manage scopes, Manage categories, Audit, Override.

Generic `manage` is not automatically equivalent to every action. It may remain only when it represents a real, separately guarded administrative capability. A generic legacy “do everything” meaning is an umbrella to migrate, not a shortcut for manufacturing granular checkboxes.

The current registry has different readiness levels:

- Project permission modules already declare many granular action codes.
- ERP permission modules are mixed between granular actions and `manage` umbrellas.
- route-derived system modules are largely generated as `view/manage` pairs.

Declaration alone is not proof that a permission is enforced end to end.

## 8. Action readiness

Each action presented for administration needs a readiness classification:

| Readiness | Meaning | Main-matrix behavior |
|---|---|---|
| Legacy | Only an old umbrella is authoritative | Show legacy status; do not invent granular grants |
| Declared | Permission code exists but enforcement is not yet proven | Hidden or disabled with an explanation |
| Enforced | Trusted backend checks the exact action and scope | Grantable for controlled verification |
| Verified | Positive and adjacent negative evidence exists | Grantable and eligible for rollout |

Only Enforced or Verified actions are grantable in the simple matrix. Advanced diagnostics may show Declared actions so developers and authorization reviewers can see what remains incomplete.

Readiness is determined from evidence, not naming. Evidence includes the trusted backend guard, scope handling, state and assignment rules where applicable, and focused tests.

## 9. Focused verification strategy

The goal is confidence in separation, not an exhaustive combinatorial test suite.

For each action introduced as Verified, provide:

1. one positive test proving the intended operation succeeds;
2. one or more adjacent negative tests proving neighboring authority is not inherited;
3. one scope-boundary negative test when the action is scoped;
4. an ownership negative test for `own` versus `all` actions when applicable.

The minimum manual progression for a module is:

1. Use an active test account without an umbrella Role.
2. Ensure the selected module/scope is not still covered by Legacy when testing new-only behavior.
3. Grant View and confirm read-only access.
4. Grant one action at a time.
5. Exercise the intended action and at least one adjacent denied action.
6. Record Pass or Fail next to the permission.
7. Correct the mapping or backend guard when evidence fails; do not restore generic `manage` merely to make a test pass.

For a workflow chain such as Edit -> Submit -> Verify -> Approve:

| Permission under test | Must allow | Must deny |
|---|---|---|
| Edit | Edit an eligible draft | Submit, Verify, Approve |
| Submit | Submit an eligible record | Verify, Approve, unrelated edits |
| Verify | Verify an assigned eligible record | Approve |
| Approve | Approve an eligible record | Verify or arbitrary data editing |

Possessing a permission does not bypass subject state, assignment, creator/approver separation, or SoD.

## 10. Draft and preview behavior

Checkbox changes remain local draft state until Preview and Save. The interface must not write one checkbox at a time.

Preview communicates business effects:

- modules and submodules becoming visible or hidden;
- actions being granted or revoked;
- scopes affected;
- View automatically included or derived;
- effective access remaining through Role or Legacy;
- legacy rights covered, missing, or unmapped;
- expiry and reason requirements;
- hard SoD conflicts and warning acknowledgements.

Preview is authoritative server evaluation. Client-side validation may improve responsiveness but may not replace it.

The draft is bound to one principal. Switching principal, closing the editor, or receiving fresh effective-source data must not apply the previous principal's draft. If relevant permission data changes between Preview and Save, Save must fail stale rather than overwrite another administrator's update.

## 11. Warning language

Warnings use three severity levels.

### Information

- View was included automatically with an action.
- The user already has this permission from a Business Role.
- The draft does not change effective access.

### Warning

- Legacy still covers the area.
- A permission will expire soon.
- The proposed combination triggers a warning-level SoD rule and requires valid independent control evidence.

### Blocking

- The action is not Enforced or Verified.
- The requested scope is invalid.
- A hard SoD rule is violated.
- The target account is not active.
- The draft is stale.
- Required expiry or reason is missing.
- No eligible independent control owner exists for a required warning acceptance.

The last condition must be expressed plainly: “No eligible independent control owner is available; this sensitive permission change cannot be saved.” The UI must not offer a service-role, direct SQL, rollout-flag, or self-approval bypass.

## 12. Save contract

Save submits one complete changeset through a governed command. The trusted backend must:

1. resolve and authorize the active actor;
2. lock and revalidate the active target;
3. reject a stale preview or stale before-state;
4. validate every permission code, readiness, scope, expiry, reason, and SoD decision;
5. apply all approved changes or roll back all of them;
6. revoke removed grants without deleting history;
7. append before/after audit evidence, actor, target, reason, and decision metadata;
8. return the authoritative effective state for UI refresh.

The existing governed Direct Grant preview and replacement commands remain the base for direct-only changes. A unified changeset that also alters legacy visibility or source mode must not be simulated by unrelated frontend writes that can partially succeed. It requires a transactional command boundary or a deliberately staged workflow whose partial states are explicit and recoverable.

Sensitive Direct Grants continue to require governed expiry, reason, and SoD evidence. This UI redesign does not relax current authorization controls.

## 13. Delivery boundaries

The first implementation increment includes:

- one unified application/module/submodule permission flow;
- View master-control behavior;
- source-aware Direct, Role, Legacy, and Mixed states;
- action readiness filtering;
- human-readable preview and change summary;
- preservation of governed authorization, expiry, audit, and SoD behavior;
- focused tests for UI dependencies and exact backend separation where an action is marked Verified.

It does not include:

- automatically decomposing every generic `manage` permission;
- declaring registry entries verified without backend evidence;
- bulk legacy disablement or permission cutover;
- rollout-flag changes;
- Cloud mutation;
- resuming the paused sensitive regrant Task 4;
- changing effective production access merely to reorganize the UI.

Modules should progress in bounded waves: low-risk modules with existing exact enforcement first, workflow transitions next, and payment, authorization administration, and other sensitive areas only after their stronger evidence and SoD gates are ready.

## 14. Acceptance criteria

The design is implemented correctly when:

1. An Admin can understand intended access without reading permission codes.
2. The three existing permission concepts are presented as one source-aware workflow rather than three competing systems.
3. Granting an action ensures compatible View behavior without broadening scope.
4. Clearing View handles editable Direct Grants consistently and never conceals remaining Role or Legacy access.
5. Edit does not imply Submit, Verify, Confirm, Approve, or another neighboring action.
6. Actions lacking backend enforcement evidence are not grantable as completed permissions.
7. Preview matches the authoritative result returned after Save.
8. Stale or invalid Save attempts fail without partial state.
9. Every Verified action has focused positive and adjacent negative evidence.
10. No Cloud state, rollout flag, legacy source mode, or sensitive Task 4 checkpoint changes as a side effect of implementing the local design increment.

## 15. Implementation planning gate

This document records the approved design only. Code implementation begins after:

1. this written specification is reviewed;
2. the current component/RPC boundaries are converted into an executable implementation plan;
3. the plan identifies which existing actions are Enforced or Verified instead of assuming registry completeness;
4. any Cloud mutation or production cutover receives a separate explicit approval checkpoint.
