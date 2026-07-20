# VIOO Manual Permission Matrix and Manage Action Split Design

**Date:** 2026-07-19
**Status:** Draft for operator written-spec review
**Scope:** Permission administration UX, legacy `manage` action split, all-module Direct Grant editing, backend enforcement contracts, and cleanup of the incorrect quick-template/project-only direction.

## 1. Operator Intent

The existing legacy permission administration model is the UX baseline. It is already understandable because it separates module view, submodule view, module administration, and submodule administration. The missing capability is not another role/template layer; the missing capability is splitting broad legacy administration rights into explicit action permissions that can be checked and enforced one by one.

The target operator workflow is:

1. Open a dedicated permission administration page.
2. Select one user from the left side.
3. Browse all applications/modules/submodules in a compact permission matrix.
4. Open a parent module row only when needed.
5. Tick or untick concrete permissions manually.
6. Copy one user's new Direct Grant draft.
7. Paste it onto another user, replacing that receiving user's new Direct Grant draft.
8. Preview and Save through the governed backend command.

The operator does not need quick templates, role presets, automatic user-right inference, or an `all projects` scope. Business Roles and Legacy permissions may still be displayed as effective-source evidence, but the primary workflow edits only new Direct Grants.

## 2. Superseded Direction

This spec supersedes the quick-template/project-only decisions in:

- `docs/superpowers/specs/2026-07-19-vioo-direct-user-permission-matrix-design.md`
- `docs/superpowers/plans/2026-07-19-vioo-direct-user-permission-matrix.md`

The following direction is no longer valid for the primary UX:

- no `Mẫu quyền` tab;
- no role/template quick preset editor;
- no project-only permission workspace;
- no custom quick-template storage as part of the next UI path;
- no static project role presets such as engineer/accountant/chief/warehouse keeper;
- no forcing the whole page to `scopeType = 'project'`.

The already-applied quick-template Cloud objects are not rolled back by this spec. They remain inert and unused unless the operator separately approves a dedicated rollback. No further Cloud mutation is authorized by this design.

## 3. Alignment With Approved Architecture

This design keeps the approved architecture:

```text
Principal - Permission - Scope - Assignment - Workflow - Notification
```

It aligns with the Phase 02 and Phase 03 roadmap as follows:

- Phase 02 effective sources remain `ROLE`, `DIRECT`, and `LEGACY`.
- The UI must show source badges so an unchecked Direct checkbox never implies a Role or Legacy source has disappeared.
- Direct Grant changes still go through governed Preview/Apply commands with audit, SoD checks, and backend actor derivation.
- Legacy permissions keep running in parallel until a later controlled legacy migration phase.
- Per-user/module/scope source-mode cutover remains Phase 03 and is not implemented here.
- Remediation C for Material Request provenance remains separate and must not be hidden inside this UX correction.

## 4. Permission Model

Each legacy broad administration permission must be treated as a compatibility source that maps to a set of explicit new action permissions. The new catalog must preserve the old module/submodule shape while adding concrete actions.

Minimum action pattern:

- `view`: basic module or submodule visibility;
- `create`: create a new subject;
- `edit` or `edit_own`: update allowed subject data;
- `delete`: delete or cancel where the module supports it;
- `confirm`, `approve`, `reject`, `return`, `verify`, `complete`, `mark_paid`, or equivalent workflow actions when the module has workflow;
- `export` where data extraction is a business permission;
- module-specific actions only when the module has a real distinct operation.

The catalog must not blindly create every action for every module. Each module/submodule gets only actions that correspond to real UI/backend behavior.

## 5. View First Rule

`view` is the first lock. A user must have effective `view` for the relevant module/submodule and scope before any child action can be used.

Rules:

1. UI child actions are disabled unless the draft or effective sources contain the required `view` for the same module/submodule and scope.
2. When the operator checks a child action and no effective `view` exists, the UI may add the matching Direct `view` draft automatically.
3. When the operator removes a Direct `view`, the UI must remove or block dependent Direct child grants for that same module/submodule and scope unless another effective source still provides `view`.
4. Backend checks for non-view actions must require both the requested action and the matching effective `view`.
5. Knowing a route, subject ID, notification link, or API endpoint never creates access.

This preserves the key-and-lock model: no view means no usable inner action, even if a stale link or direct API call is attempted.

## 6. Administration UX

The page is a single primary workflow:

- left side: searchable user list;
- main header: selected user, account status, aggregate source badges, Copy, Paste, Preview, Save;
- main body: compact permission tree grouped by application, module, and submodule;
- module row: parent `view` checkbox and summary counts;
- expanded module: concrete child action checkboxes;
- advanced details: Role/Legacy/effective-source evidence, SoD warning evidence, audit, and current governed Direct Grant panel when still needed for fallback.

The matrix must use the full permission registry, not only the Project application. Project is one application group among many.

The UI should be dense and familiar, closer to the old module permission table than to a new IAM product. It should avoid showing every action expanded at once. Parent rows stay collapsed by default.

## 7. Scope Behavior

Scope is action-specific:

- `global` actions use `global/*`;
- Project actions use a concrete project ID;
- warehouse, department, own, assigned, or other scopes appear only when the action supports them;
- construction site is not treated as the root Project permission scope in this design;
- there is no `all projects now and future` shortcut.

The Project module may show a project selector while the operator is editing Project-scoped actions. Other modules must not be hidden behind that selector.

Copy/paste keeps the copied scope values exactly. Pasting grants from Project A does not grant Project B.

## 8. Copy And Paste Contract

Copy/paste is a draft convenience only.

Copy captures:

- active new Direct Grant permission code;
- scope type;
- scope ID;
- expiry, when present.

Copy does not capture:

- principal identity;
- database row ID;
- granted actor;
- grant timestamp;
- audit payload;
- Role source;
- Legacy source;
- effective-source rows;
- warning acceptances;
- source-mode settings.

Paste replaces the receiving user's entire new Direct Grant draft with the copied Direct Grant set and rewrites only the `userId` to the receiving user. Paste never auto-saves. It clears Preview and SoD warning acceptances and requires a new backend Preview before Save.

## 9. Legacy Parallel Operation

Legacy remains active and visible during migration.

The matrix displays Legacy source badges when a permission is currently effective through the old module/submodule/admin fields. The operator may remove or add Direct Grants without claiming Legacy has changed.

This design does not:

- mutate legacy module/submodule fields;
- disable legacy fallback;
- implement source-mode toggles;
- auto-convert all users;
- infer a perfect new permission set from legacy;
- Save the blocked 12 principals or split those drafts into partial saves.

The operator will manually remove legacy and grant new permissions later, after each module's explicit permissions are mapped and enforced.

## 10. Backend Enforcement

UI visibility is not the security boundary. Every protected mutation and read that depends on permissions must be checked at the backend boundary.

For a newly grantable permission, the module must provide evidence that:

1. no effective permission denies the backend action;
2. correct `view` plus correct child action allows it;
3. wrong scope denies it;
4. direct route/API access denies without permission;
5. System Admin identity alone does not grant business approval;
6. workflow actions still check assignment and state where the module requires them.

Actions that are only declared in the catalog but not yet enforced remain visible as not-ready/legacy-only and cannot be newly granted through the primary matrix.

## 11. Module Catalog Work

The implementation plan must start from an inventory, not from UI assumptions:

1. list current legacy module/submodule view/admin rights;
2. map each legacy view right to the corresponding new `*.view` permission;
3. inspect each legacy admin/manage right and identify real actions used by that module;
4. create or align explicit permission codes for those actions;
5. classify risk/readiness for each action;
6. show the action in the matrix only when it has a registry/catalog entry;
7. allow granting only when readiness permits it.

The Project application receives extra care because it has many workflows, but it remains only one application group in the all-module matrix.

## 12. Current Implementation Correction

The next implementation must correct the current tranche-b UI direction:

- remove or hide the `Mẫu quyền` tab from `SettingsAuthorizationGovernance`;
- stop mounting `PermissionQuickTemplateEditor` in the primary page;
- stop loading `permissionQuickTemplateService` from the direct-user workflow;
- remove static Project permission templates from the direct-user workflow;
- remove `applicationFilter="project"` from the primary compact tree;
- replace the fixed Project scope with an adaptive scope selector;
- keep copy/paste draft helpers, but remove template-apply behavior from the primary path;
- keep governed Preview/Save and source badges;
- keep the narrow retired Material Request removal boundary in `PrincipalDirectGrantPanel`;
- do not edit applied migrations or roll back Cloud quick-template objects without separate approval.

## 13. Verification Direction

Verification must be focused and explainable, not broad for its own sake.

Required tests:

1. UI contract: the primary page has no `Mẫu quyền` tab and no quick-template editor.
2. UI contract: the matrix renders all applications/modules from the registry, not only Project.
3. UI contract: parent rows stay collapsed and child actions appear only when opened.
4. UI contract: child actions require effective `view`.
5. UI contract: copy/paste replaces the receiving Direct Grant draft and clears Preview.
6. Backend contract: Preview/Save uses governed RPCs and sends no browser actor payload.
7. Backend contract: no direct table mutation of grant, role assignment, audit, or source-mode tables from the browser.
8. Readiness contract: declared/legacy-only actions are shown but not newly grantable.
9. Scope contract: Project A grants do not apply to Project B.
10. Enforcement contract: for each action marked enforced/verified in the touched module set, prove deny without permission and allow with exact permission.

The plan should not attempt exhaustive automatic inference of every existing user's intended permissions.

## 14. Non-Goals

- No quick templates.
- No role presets as checkbox shortcuts.
- No `all projects` shortcut.
- No automatic legacy-to-new migration.
- No Phase 03 source-mode implementation.
- No negative grants or deny overrides.
- No Cloud mutation from this spec alone.
- No direct SQL mutation of grant tables.
- No local Supabase/Docker workflow.
- No editing dirty roadmap files or applied migrations.
- No change to Material Request provenance Remediation C except avoiding UI conflicts with its narrow repair action.

## 15. Implementation Gate

Implementation may start only after the operator approves this written spec.

After approval, use `superpowers:writing-plans` to create a new implementation plan that replaces the quick-template/project-only plan direction. The plan must use TDD, small checkpoints, and explicit commits. It must keep Remediation C separate unless the operator explicitly resumes it.
