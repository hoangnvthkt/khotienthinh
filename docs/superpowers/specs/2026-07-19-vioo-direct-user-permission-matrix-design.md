# VIOO Direct User Permission Matrix Design

**Date:** 2026-07-19
**Status:** Draft for operator written-spec review
**Scope:** Permission administration UX, quick permission templates, per-user Direct Grant editing, and conflict boundaries with active Phase 02 plans.

## 1. Operator Decisions

The permission administration experience is simplified around direct user editing:

1. A dedicated permission administration page selects a user from a left-side list.
2. The main area shows a compact permission tree, not all actions expanded at once.
3. Parent permissions reveal child actions. A parent action such as View is the basic access toggle; child actions remain independent.
4. For the Project module, scope is a specific project. There is no `all projects` scope in this design.
5. Permission templates are quick checkbox presets only. They are not live Business Role assignments.
6. Applying a template copies its checked permission set into the current draft. The Admin can then add or remove checkboxes and Save.
7. Copying one user's permissions and pasting onto another user replaces the receiving user's new Direct Grant draft. It does not auto-save.
8. Legacy permissions continue to run in parallel and remain visibly labeled; this design does not automatically migrate, disable, or infer each user's legacy access.

## 2. Current Plan and Phase Audit

This design was checked against the active roadmap and implementation plans in the tranche-b worktree.

### Completed or Available Foundations

- The architecture source of truth remains `Principal - Permission - Scope - Assignment - Workflow - Notification`.
- Phase 02 foundation has implemented Business Role tables, effective-source resolver seams, governed Direct Grant commands, SoD checks, audit surfaces, and account lifecycle integration.
- The current Settings authorization page already lists principals, Business Roles, effective sources, role assignments, direct grants, and audit evidence.
- The existing unified permission matrix model supports View master behavior, scope-aware Direct Grant drafts, source badges, readiness classification, and governed Preview/Apply.
- Project Organization already has static quick templates in `PROJECT_PERMISSION_TEMPLATES`. Those templates behave like checkbox presets, not live role assignments.
- Material Request retirement UI has been committed: the direct grant panel can remove the two retired codes, but cannot add them.
- The Remediation C spec for Material Request provenance exists at commit `9180141`; its implementation plan is present as an untracked plan file, but no Remediation C code/migration/test/RPC implementation has started in this worktree.

### Open Work and Blockers

- Closure Task 3 remains paused around the sensitive direct-grant/readiness stream until its exact gated evidence is clean.
- Resolver enablement, governance cutoff, business-approval cutoff, production promotion, and 24-hour observation are still pending.
- Daily Log assignment-first pilot exists, but end-to-end production UI confirmation and full notification/inbox assignment-first cleanup remain open.
- Material Request provenance Remediation C is separate from this UX simplification. It must not be hidden inside the permission-matrix work.
- Legacy permissions still exist through module/submodule fields and project staff permission data. They remain compatibility sources until a separate controlled migration/cutover phase.

## 3. Conflict Analysis

### Business Role vs Quick Template

Existing Phase 02 plans use `Business Role` as a real effective permission source through `principal_role_assignments`. The operator's new decision uses role-like labels only as quick checkbox presets.

Resolution: use the UI term **Mẫu quyền** for the new presets. Do not use these presets as `principal_role_assignments`, do not add them to the effective-source resolver, and do not let editing a preset change users already saved from it.

### Unified Matrix Source Awareness

The previous unified matrix design emphasizes Direct, Role, Legacy, and Mixed effective sources. The new UX should be simpler, but it cannot pretend effective access disappeared when a Legacy or Business Role source still exists.

Resolution: the primary checkboxes edit only Direct Grants. Effective Role/Legacy sources appear as read-only badges or advanced detail. Removing a Direct checkbox removes only that Direct draft row.

### Old Clipboard Removal vs New Copy/Paste

The previous plan removed an unsafe legacy permission clipboard because it could clone incomplete legacy/scope/SoD state. The operator now wants copy and paste for users with similar duties.

Resolution: implement copy/paste as an in-memory draft clone of new Direct Grants only. Paste replaces the receiving user's new Direct Grant draft, clears any stale Preview, requires a fresh backend Preview, and saves only through the governed Apply command. It must not copy legacy fields, raw effective sources, audit payloads, warning acceptances, or principal identity.

### Project Scope

The roadmap mentions both project and construction-site scopes. The operator clarified that construction site is only a location inside a project and initial administration should grant per project.

Resolution: Project module UX defaults to `project` scope only. Construction-site scope remains a future module-specific enhancement and is not exposed in this first simplified flow.

### Readiness and Backend Enforcement

The operator wants the full permission catalog, matrix granting, and proof each permission works independently in UI and backend. Existing plans require that only Enforced or Verified actions are newly grantable.

Resolution: the matrix may display the catalog, but newly grantable actions must keep readiness gating. Declared or legacy-only actions are labeled as not ready or legacy, not silently grantable.

## 4. Proposed User Experience

The dedicated page has two main tabs:

1. **Phân quyền user**
   - Left side: searchable user list.
   - Main top bar: selected user, legacy-source summary, Copy, Paste, Preview, Save.
   - Main body: compact permission tree by application/module.
   - Project module: project selector first, then the permission tree for that project.
   - Parent rows stay collapsed by default. Selecting or opening a parent reveals child actions.

2. **Mẫu quyền**
   - List of reusable quick templates such as `Kỹ sư`, `Kế toán`, `Chỉ huy trưởng`, `Thủ kho`.
   - Each template stores a set of permission codes and default action checks.
   - Editing a template uses the same compact permission tree.
   - Saving a template does not affect any user.

Applying a template:

1. Admin selects a user.
2. For Project permissions, Admin selects one project.
3. Admin selects a template.
4. The template checks are copied into the user's draft for the selected scope.
5. Admin adjusts checkboxes.
6. Admin previews and saves.

Copy/paste user permissions:

1. Admin opens User A and chooses Copy.
2. Admin opens User B and chooses Paste.
3. User B's new Direct Grant draft is replaced by the copied new Direct Grants.
4. Preview is cleared and must be rerun.
5. Admin can edit checkboxes and then Save.

## 5. Backend and Data Boundaries

The saved user permissions remain Direct Grants stored and enforced through existing governed commands. The browser does not write grant tables directly.

Permission templates are not authorization sources. They should use separate storage from Business Role assignments, or an explicitly isolated mode that is never consumed by the effective-source resolver. The safer implementation direction is separate template tables such as:

- `permission_quick_templates`
- `permission_quick_template_items`

These tables are administration data only. They do not grant access until their items are copied into a user's Direct Grant draft and saved through the governed permission command.

The existing Business Role implementation remains available for Phase 02 compatibility, recovery, and governance evidence. This UX does not remove it, but it should not be the primary path for the operator's direct user-permission workflow.

## 6. Legacy Parallel Operation

Legacy permissions are preserved. The matrix shows them as compatibility/effective badges, not editable granular children unless a separate controlled legacy workflow is approved.

The first implementation must not:

- disable legacy fallback;
- mutate legacy source-mode settings;
- edit applied migrations;
- run `supabase db push`;
- directly update grant tables;
- auto-migrate users from legacy to new permissions;
- infer a perfect new permission set for every user.

## 7. Verification Direction

Verification should stay focused and explainable:

1. UI contract: parent rows stay collapsed, child actions reveal only when opened.
2. UI contract: applying a quick template changes only the current draft.
3. UI contract: paste replaces the receiving user's new Direct Grant draft and clears Preview.
4. Backend contract: Save still calls governed Preview/Apply, not direct SQL or table writes.
5. Backend contract: readiness gating still blocks unverified newly added actions.
6. Project scope contract: permissions copied for Project A do not silently grant Project B.
7. Legacy contract: removing Direct access does not claim legacy or Business Role access is gone.

Manual verification should prove one permission at a time with positive and adjacent negative checks for modules that are marked Enforced or Verified. This design does not require exhaustive automatic inference of every current user's intended permissions.

## 8. Non-Goals

- No all-projects scope.
- No negative grants, deny overrides, or inheritance exceptions.
- No live role assignment behavior for quick templates.
- No automatic bulk migration from legacy to new permissions.
- No Phase 03 source-mode implementation.
- No Cloud mutation or rollout flag change from this design alone.
- No change to Material Request provenance Remediation C, except that later UI work must not break its narrow direct-grant panel boundary.

## 9. Implementation Planning Gate

Implementation may start only after the operator approves this written spec. The next plan should be a new focused plan for the direct user permission matrix and quick templates, while keeping the existing Remediation C provenance plan separate unless the operator explicitly resumes it.
