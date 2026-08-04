# Material PO Room Permission Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut over all six `material_po` actions to effective Project Room authorization, backfill exact PBAC grants safely, and enforce owner/assignment/status rules through frontend, RPC, trigger/RLS, and Cloud smoke evidence.

**Architecture:** `get_my_project_room_actions(project, site)` is the only frontend source for PO Room capabilities. Backend business commands use `project_actor_has_effective_room_action`, while recipient selection continues to use raw `project_user_has_room_action`; project PO tables and commands preserve company-procurement and WMS controls as separate gates.

**Tech Stack:** React 18, TypeScript 5.8, Vitest 4, Supabase JS 2.98, PostgreSQL/Supabase RLS, Supabase CLI.

## Global Constraints

- Work on branch `feature/phan-quyen-du-an-v4-03.08.2026` in the current workspace; do not create a worktree.
- Room `material_po` is the target source of truth; PBAC remains compatibility-only during the pilot.
- Complete `view`, `edit`, `delete`, `submit`, `approve`, and `confirm` together before user acceptance.
- A PO creator without Room `delete` cannot delete or archive their PO.
- `approve` covers approve and return/request revision, but a non-admin actor must be the assigned approver.
- `confirm` governs PO logistics; actual stock mutation still requires WMS/Keeper authorization.
- `project.material_po.manage` is reported as a PBAC exception and never implies every Room action.
- System Admin may override business actions but is never added to recipient lists by that override.
- Company-consolidated PO and WMS-specialized controls must not be widened by the project Room pilot.
- Create the migration with `supabase migration new`; do not invent its timestamp.
- Keep `project_room_pbac_fallback_enabled=true` throughout user acceptance.
- Do not promote PO actions to `enforced` until the user accepts the live pilot and fallback-only findings are resolved.

---

### Task 1: Define typed effective PO Room capabilities

**Files:**
- Modify: `lib/permissions/projectRoomEffectiveActions.ts`
- Modify: `lib/__tests__/projectRoomEffectiveActions.test.ts`

**Interfaces:**
- Consumes: `EffectiveProjectRoomAction` returned by `projectPermissionRoomService.listMyActions(projectId, constructionSiteId)`.
- Produces: `MaterialPoEffectiveCapabilities` and `getMaterialPoEffectiveCapabilities(actions)` for all frontend PO consumers.

- [ ] **Step 1: Write failing capability tests**

Add tests proving each action is independent and actions from other Rooms are ignored:

```ts
const capabilities = getMaterialPoEffectiveCapabilities([
  { roomCode: 'material_po', actionCode: 'edit', source: 'room', enforcementStatus: 'pilot' },
  { roomCode: 'material_po', actionCode: 'approve', source: 'pbac_fallback', enforcementStatus: 'pilot' },
  { roomCode: 'daily_log', actionCode: 'delete', source: 'room', enforcementStatus: 'pilot' },
]);

expect(capabilities).toEqual({
  canViewPo: false,
  canEditPo: true,
  canDeletePo: false,
  canSubmitPo: false,
  canApprovePo: true,
  canConfirmPo: false,
});
```

Add a second assertion that `edit` does not set `submit` or `delete`, and `approve` does not set `confirm`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run lib/__tests__/projectRoomEffectiveActions.test.ts
```

Expected: FAIL because `getMaterialPoEffectiveCapabilities` is not exported.

- [ ] **Step 3: Implement the typed mapper**

Add this public contract:

```ts
export interface MaterialPoEffectiveCapabilities {
  canViewPo: boolean;
  canEditPo: boolean;
  canDeletePo: boolean;
  canSubmitPo: boolean;
  canApprovePo: boolean;
  canConfirmPo: boolean;
}

export const getMaterialPoEffectiveCapabilities = (
  actions: readonly EffectiveProjectRoomAction[],
): MaterialPoEffectiveCapabilities => {
  const granted = new Set(actions
    .filter(action => action.roomCode === 'material_po')
    .map(action => action.actionCode));
  return {
    canViewPo: granted.has('view'),
    canEditPo: granted.has('edit'),
    canDeletePo: granted.has('delete'),
    canSubmitPo: granted.has('submit'),
    canApprovePo: granted.has('approve'),
    canConfirmPo: granted.has('confirm'),
  };
};
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit the capability contract**

```bash
git add lib/permissions/projectRoomEffectiveActions.ts lib/__tests__/projectRoomEffectiveActions.test.ts
git commit -m "test: define material PO room capabilities"
```

### Task 2: Make the material access hook use Room-only PO capabilities

**Files:**
- Modify: `lib/permissions/projectMaterialPermissions.ts`
- Modify: `hooks/project/material/useProjectMaterialAccess.ts`
- Modify: `pages/project/MaterialTab.tsx`
- Modify: `lib/__tests__/materialPermissions.phase3.test.ts`
- Create: `lib/__tests__/materialPoEffectiveRoomActionsUiContract.test.ts`

**Interfaces:**
- Consumes: `getMaterialPoEffectiveCapabilities(actions)` from Task 1.
- Produces: hook fields `canViewPo`, `canEditPo`, `canDeletePo`, `canSubmitPo`, `canApprovePo`, `canConfirmPo`; legacy `manage` remains available only to out-of-scope direct-purchase compatibility code.

- [ ] **Step 1: Write the failing hook contract test**

Read `useProjectMaterialAccess.ts` as a source contract and assert:

```ts
expect(source).toContain('getMaterialPoEffectiveCapabilities');
expect(source).toContain("action.roomCode === 'material_po'");
expect(source).not.toMatch(/NON_ROOM_PBAC_ACTION_CODES[\s\S]*project\.material_po\.manage/);
```

Also extend `materialPermissions.phase3.test.ts` so a PBAC user with only
`project.material_po.manage` no longer receives `canEditPo`, `canDeletePo`,
`canSubmitPo`, `canApprovePo`, or `canConfirmPo`.

- [ ] **Step 2: Run the tests and verify RED**

```bash
npx vitest run lib/__tests__/materialPermissions.phase3.test.ts lib/__tests__/materialPoEffectiveRoomActionsUiContract.test.ts
```

Expected: FAIL because PO capabilities still come from PBAC aliases and `manage` implies all PO actions.

- [ ] **Step 3: Separate PBAC compatibility from Room PO capabilities**

In `projectMaterialPermissions.ts`:

- Replace PO fields `canCreatePo`, `canReceivePo`, and broad operational use of
  `canManagePo` with the six explicit fields produced by Task 1.
- Keep a clearly named `hasLegacyPoManageException` only where legacy Direct
  Purchase behavior still requires it; never fold it into Room PO fields.
- Keep exact PBAC mapping metadata for audit/backfill, but do not use it as a
  second frontend authorization check for pilot PO actions.

In `useProjectMaterialAccess.ts`, exclude both BOQ and PO PBAC codes from direct
`checkProjectAction` calls:

```ts
const EFFECTIVE_ROOM_PBAC_ACTION_CODES = new Set<ProjectMaterialActionCode>([
  'project.material_boq.view',
  'project.material_boq.edit',
  'project.material_boq.delete',
  'project.material_po.view',
  'project.material_po.create',
  'project.material_po.delete',
  'project.material_po.approve',
  'project.material_po.receive',
  'project.material_po.manage',
]);

const NON_ROOM_PBAC_ACTION_CODES = PROJECT_MATERIAL_ACTION_CODES.filter(
  permissionCode => !EFFECTIVE_ROOM_PBAC_ACTION_CODES.has(permissionCode),
);
```

Call `listMyActions` once, derive BOQ compatibility aliases as today, derive PO
capabilities directly with `getMaterialPoEffectiveCapabilities`, and merge both
into the final state. Do not call `checkProjectAction` separately for a PO code.

- [ ] **Step 4: Wire MaterialTab with six explicit PO capabilities**

Pass this shape to `SupplyChainTab`:

```tsx
poCapabilities={{
  canViewPo,
  canEditPo,
  canDeletePo,
  canSubmitPo,
  canApprovePo,
  canConfirmPo,
}}
```

The PO tab can be visible when the actor has `view` or a workflow action needed
to handle an assigned PO. Replace the PBAC-code toast with Room language:

```ts
toast.warning('Không có quyền tạo PO', 'Bạn cần quyền Sửa trong Room Đơn hàng PO.');
```

- [ ] **Step 5: Run focused tests and typecheck**

```bash
npx vitest run lib/__tests__/materialPermissions.phase3.test.ts lib/__tests__/materialPoEffectiveRoomActionsUiContract.test.ts lib/__tests__/materialBoqEffectiveRoomActionsUiContract.test.ts
npm run lint
```

Expected: all PASS.

- [ ] **Step 6: Commit the hook cutover**

```bash
git add lib/permissions/projectMaterialPermissions.ts hooks/project/material/useProjectMaterialAccess.ts pages/project/MaterialTab.tsx lib/__tests__/materialPermissions.phase3.test.ts lib/__tests__/materialPoEffectiveRoomActionsUiContract.test.ts
git commit -m "feat: load material PO access from room actions"
```

### Task 3: Enforce owner and assignment rules in PO UI policy

**Files:**
- Modify: `lib/purchaseOrderMutationState.ts`
- Modify: `lib/purchaseOrderUiPolicy.ts`
- Modify: `pages/project/SupplyChainTab.tsx`
- Modify: `components/project/PurchaseOrderCockpitDrawer.tsx`
- Modify: `lib/__tests__/purchaseOrderMutationState.test.ts`
- Modify: `lib/__tests__/purchaseOrderUiPolicy.test.ts`
- Modify: `lib/__tests__/purchaseOrderActualReceiptUiPolicy.test.ts`
- Modify: `lib/__tests__/purchaseOrderDrawerRegression.test.ts`

**Interfaces:**
- Consumes: six actor capabilities from Task 2 and `PurchaseOrder.submittedToUserId` / `createdById`.
- Produces: document-scoped helpers `canUserEditPurchaseOrder`, `canUserSubmitPurchaseOrder`, `canUserApprovePurchaseOrder`, and `canUserRemovePurchaseOrder`.

- [ ] **Step 1: Write failing owner/assignment tests**

Add cases with a normal employee, creator, assigned approver, unassigned
approver, and System Admin:

```ts
expect(canUserRemovePurchaseOrder(draftPo, creator, { canDeletePo: false })).toBe(false);
expect(canUserRemovePurchaseOrder(draftPo, creator, { canDeletePo: true })).toBe(true);
expect(canUserRemovePurchaseOrder(draftPo, otherUser, { canDeletePo: true })).toBe(false);

expect(canUserApprovePurchaseOrder(sentPo, assignedApprover, { canApprovePo: true })).toBe(true);
expect(canUserApprovePurchaseOrder(sentPo, otherApprover, { canApprovePo: true })).toBe(false);
expect(canUserApprovePurchaseOrder(sentPo, adminUser, { canApprovePo: false })).toBe(true);

expect(canUserSubmitPurchaseOrder(draftPo, creator, { canSubmitPo: true })).toBe(true);
expect(canUserSubmitPurchaseOrder(draftPo, creator, { canEditPo: true, canSubmitPo: false })).toBe(false);
```

In `purchaseOrderUiPolicy.test.ts`, prove edit never exposes submit/delete,
approve only exposes approve/return when the document-scoped flag is true, and
confirm alone exposes delivery/close actions.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run lib/__tests__/purchaseOrderMutationState.test.ts lib/__tests__/purchaseOrderUiPolicy.test.ts
```

Expected: FAIL because creator and `manage` are still independent authorization bypasses.

- [ ] **Step 3: Implement document-scoped helpers**

Use this contract:

```ts
export type PurchaseOrderMutationCapabilities = {
  canEditPo?: boolean;
  canDeletePo?: boolean;
  canSubmitPo?: boolean;
  canApprovePo?: boolean;
  canConfirmPo?: boolean;
};

const isAssigned = (po: PurchaseOrder, user?: User | null) =>
  Boolean(user && po.submittedToUserId && [user.id, user.authId].filter(Boolean).includes(po.submittedToUserId));

export const canUserRemovePurchaseOrder = (po, user, capabilities = {}) =>
  Boolean(user && (isAdmin(user) || (capabilities.canDeletePo && isPurchaseOrderCreator(po, user))));

export const canUserSubmitPurchaseOrder = (po, user, capabilities = {}) =>
  Boolean(user && ['draft', 'returned'].includes(po.status)
    && (isAdmin(user) || (capabilities.canSubmitPo && (isPurchaseOrderCreator(po, user) || isAssigned(po, user)))));

export const canUserApprovePurchaseOrder = (po, user, capabilities = {}) =>
  Boolean(user && po.status === 'sent'
    && (isAdmin(user) || (capabilities.canApprovePo && isAssigned(po, user))));
```

`canUserEditPurchaseOrder` uses `canEditPo`, `draft/returned`, and
creator/assignment. Remove creator-only and `canManagePo` bypasses from mutation
and removal helpers. Update Vietnamese block reasons to mention Room actions.

- [ ] **Step 4: Make the UI policy accept already-scoped booleans**

Replace broad inputs with:

```ts
canEditPoDocument?: boolean;
canDeletePoDocument?: boolean;
canSubmitPoDocument?: boolean;
canApprovePoDocument?: boolean;
canConfirmPo?: boolean;
```

Compute action gates only from those values. `canManageTab`, `canManagePo`,
`canMutatePoDocument`, and creator status must not imply submit, approve,
confirm, or delete.

- [ ] **Step 5: Wire SupplyChainTab and return semantics**

For every list row and the cockpit drawer, compute the document-scoped flags
with Task 3 helpers and pass them to `getPurchaseOrderUiPolicy`.

Replace guards with PO-aware versions:

```ts
ensureCanEditPo(po, action)
ensureCanSubmitPo(po, action)
ensureCanApprovePo(po, action)
ensureCanConfirmPo(action)
ensureCanDeletePo(po, action)
```

Change `request_revision` from `updatePoStatus(po.id, 'draft')` to
`updatePoStatus(po.id, 'returned')`. When returning, clear recipient fields so
the creator can revise and resubmit; do not reuse supplier-return handling,
which remains a separate logistics action after receipt.

Rename drawer props so `canConfirmPo` controls delivery/receipt/failed-delivery
cleanup and `canDeletePoDocument` controls removal of the PO itself. Preserve
WMS-only buttons and `canRunRestrictedPoActions` checks.

- [ ] **Step 6: Run PO frontend regression tests**

```bash
npx vitest run \
  lib/__tests__/purchaseOrderMutationState.test.ts \
  lib/__tests__/purchaseOrderUiPolicy.test.ts \
  lib/__tests__/purchaseOrderActualReceiptUiPolicy.test.ts \
  lib/__tests__/purchaseOrderDrawerRegression.test.ts
npm run lint
```

Expected: all PASS.

- [ ] **Step 7: Commit frontend enforcement**

```bash
git add lib/purchaseOrderMutationState.ts lib/purchaseOrderUiPolicy.ts pages/project/SupplyChainTab.tsx components/project/PurchaseOrderCockpitDrawer.tsx lib/__tests__/purchaseOrderMutationState.test.ts lib/__tests__/purchaseOrderUiPolicy.test.ts lib/__tests__/purchaseOrderActualReceiptUiPolicy.test.ts lib/__tests__/purchaseOrderDrawerRegression.test.ts
git commit -m "feat: enforce PO room actions in the UI"
```

### Task 4: Register and backfill the PO pilot migration

**Files:**
- Create via CLI: migration whose basename ends with `_material_po_room_permission_pilot.sql`
- Create: `lib/__tests__/materialPoRoomPilotMigration.test.ts`
- Modify: `lib/projectPermissionRoomService.ts`
- Modify: `components/project/permissions/ProjectPermissionRoomDrawer.tsx`
- Modify: `lib/__tests__/projectPermissionRoomService.test.ts`
- Modify: `lib/__tests__/projectPermissionRoomsUiContract.test.ts`
- Modify: `supabase/audits/project_permission_room_action_matrix.sql`
- Modify: `supabase/tests/project_room_permission_audit_pilots_smoke.sql`

**Interfaces:**
- Consumes: `app_private.project_permission_room_action_bindings`, Room member/action tables, `permission_audit_events`.
- Produces: six `pilot` bindings with exact fallback mappings and a safe union backfill.

- [ ] **Step 1: Verify current Supabase CLI commands before creating a migration**

```bash
npx supabase --version
npx supabase migration --help
npx supabase migration new --help
```

Expected: help documents the installed command; do not proceed on an unknown flag.

Before writing RLS or SECURITY DEFINER SQL, verify the current official
Supabase documentation for Row Level Security, database functions, and CLI
migrations. Record the consulted official URLs in the implementation handoff;
do not authorize from user-editable JWT `user_metadata`.

- [ ] **Step 2: Write the failing migration contract test**

Find the migration by the exact suffix and assert:

```ts
expect(sql).toContain("where room_code = 'material_po'");
expect(sql).toContain("enforcement_status = 'pilot'");
expect(sql).toContain("array['project.material_po.create']::text[]");
expect(sql).toContain("'project.material_po.manage'");
expect(sql).toContain("'project_room_pbac_backfill'");
expect(sql).not.toMatch(/delete\s+from\s+public\.user_permission_grants/i);
expect(sql).not.toMatch(/user_permission_grants[\s\S]*is_active\s*=\s*false/i);
```

- [ ] **Step 3: Run the contract test and verify RED**

```bash
npx vitest run lib/__tests__/materialPoRoomPilotMigration.test.ts
```

Expected: FAIL because the migration does not exist.

- [ ] **Step 4: Create the migration with the CLI and capture its exact path**

```bash
npx supabase migration new material_po_room_permission_pilot
MIGRATION_FILE="$(find supabase/migrations -maxdepth 1 -name '*_material_po_room_permission_pilot.sql' -print | sort | tail -1)"
test -n "$MIGRATION_FILE"
```

Use `$MIGRATION_FILE` for every migration edit and verification in Tasks 4–6.

- [ ] **Step 5: Add six pilot bindings and exact compatibility mappings**

Update only `material_po`:

```sql
update app_private.project_permission_room_action_bindings
set legacy_permission_codes = case action_code
      when 'view' then array['project.material_po.view']::text[]
      when 'edit' then array['project.material_po.create']::text[]
      when 'delete' then array['project.material_po.delete']::text[]
      when 'submit' then array['project.material_po.create']::text[]
      when 'approve' then array['project.material_po.approve']::text[]
      when 'confirm' then array['project.material_po.receive']::text[]
      else '{}'::text[]
    end,
    enforcement_status = 'pilot',
    verified_at = now(),
    verified_source = 'material_po_room_pilot_2026_08_04',
    updated_at = now()
where room_code = 'material_po';
```

Provide action-specific relationship descriptions from the approved design.

- [ ] **Step 6: Add safe union backfill and audit event**

Build a temporary candidate table with exact mappings:

```sql
values
  ('project.material_po.view', 'view'),
  ('project.material_po.create', 'edit'),
  ('project.material_po.create', 'submit'),
  ('project.material_po.delete', 'delete'),
  ('project.material_po.approve', 'approve'),
  ('project.material_po.receive', 'confirm')
```

Reuse the existing uniqueness rules: active user, active non-expired grant,
scope `project` or `construction_site`, exactly one matching active
`project_staff`. Upsert Room membership and member actions by union. Insert one
`permission_audit_events` batch with `event_type` and metadata source
`project_room_pbac_backfill`. Do not update or delete PBAC grants.

- [ ] **Step 7: Report the `manage` exception and unlock only PO**

Redefine `get_my_project_room_pbac_exceptions` to include:

```sql
('material_po'::text, 'project.material_po.manage'::text)
```

Extend `get_project_permission_room` legacy-code aggregation and Room health so
active `manage` grants appear as an unmapped/broad PBAC exception. Keep other
Room action statuses unchanged.

Extend `list_project_room_staff_candidates` with a Room-code argument and a
`legacy_permission_codes text[]` result. For `material_po`, aggregate exact
mapped PBAC codes plus `project.material_po.manage`, including for a candidate
who is not yet a Room member. Map that field to
`ProjectRoomStaffCandidate.legacyPermissionCodes` and render the **PBAC ngoại
lệ** badge from the candidate rather than requiring `member` to exist. Add
service/UI tests proving a manage-only non-member displays the badge without
receiving a Room action.

- [ ] **Step 8: Update audit and existing pilot expectations**

In the audit matrix, mark `material_po` frontend evidence by the new hook/policy
contracts, backend evidence by the effective-action command functions, and
database evidence by PO and delivery policies. Update the historical pilot
smoke from 9 to 15 pilot actions and allow only `daily_log`,
`material_planning`, and `material_po` as pilot Rooms.

- [ ] **Step 9: Run contract tests and commit registry/backfill**

```bash
npx vitest run lib/__tests__/materialPoRoomPilotMigration.test.ts lib/__tests__/projectRoomAuditPilotsMigration.test.ts lib/__tests__/projectPermissionRoomService.test.ts lib/__tests__/projectPermissionRoomsUiContract.test.ts
git add "$MIGRATION_FILE" lib/__tests__/materialPoRoomPilotMigration.test.ts lib/projectPermissionRoomService.ts components/project/permissions/ProjectPermissionRoomDrawer.tsx lib/__tests__/projectPermissionRoomService.test.ts lib/__tests__/projectPermissionRoomsUiContract.test.ts supabase/audits/project_permission_room_action_matrix.sql supabase/tests/project_room_permission_audit_pilots_smoke.sql
git commit -m "feat: register and backfill material PO room pilot"
```

### Task 5: Enforce PO Room actions in RPCs, helpers, and RLS

**Files:**
- Modify: migration created in Task 4
- Modify: `lib/__tests__/materialPoRoomPilotMigration.test.ts`

**Interfaces:**
- Consumes: `project_actor_has_effective_room_action` for business actors and raw `project_user_has_room_action` for recipients.
- Produces: effective PO authorization across base PO, package V2, supplemental approval, delivery commands, and direct Data API policies.

- [ ] **Step 1: Add failing SQL contract assertions**

Resolve the CLI-created migration path for this task:

```bash
MIGRATION_FILE="$(find supabase/migrations -maxdepth 1 -name '*_material_po_room_permission_pilot.sql' -print | sort | tail -1)"
test -n "$MIGRATION_FILE"
```

Assert the migration redefines all of these functions/policies:

```text
app_private.material_has_action
app_private.project_actor_has_effective_room_action
public.transition_project_purchase_order_status
public.remove_purchase_order_v1
app_private.purchase_order_delivery_can_view
app_private.purchase_order_delivery_can_mutate
app_private.purchase_order_can_receive
app_private.purchase_order_supplemental_can_view
app_private.purchase_order_supplemental_can_create
app_private.purchase_order_supplemental_can_approve
public.approve_purchase_order_supplemental_approval
public.reject_purchase_order_supplemental_approval
app_private.create_delivery_batch_with_wms_qr_v2
app_private.approve_purchase_package_and_prepare_single_batch_v2
app_private.cancel_unreceived_delivery_batch_v2
app_private.close_purchase_package_short_v2
purchase_orders_select / insert / update / delete
po_delivery_batches_* / po_delivery_lines_*
po_supplemental_approvals_*
purchase_order_request_lines_project_access
```

Also assert `project.material_po.manage` is absent from any implication branch.

- [ ] **Step 2: Run the migration test and verify RED**

```bash
npx vitest run lib/__tests__/materialPoRoomPilotMigration.test.ts
```

Expected: FAIL on the missing enforcement definitions.

- [ ] **Step 3: Align the compatibility helper without `manage → all`**

First make rollback semantics real in
`project_actor_has_effective_room_action`:

- `pilot/enforced`: allow admin override, Room grant, then exact PBAC fallback.
- `audit_only`: ignore Room grants, but allow exact mapped PBAC fallback while
  `project_room_pbac_fallback_enabled=true`; allow System Admin override only
  for actions with a verified non-empty legacy mapping.
- fallback disabled: no `audit_only` business action is effective.

This keeps audit-only checkboxes locked while a rolled-back frontend can still
receive effective PBAC compatibility actions. Raw recipient checks remain Room
only and never use this fallback.

Then align the material compatibility helper.

For PO permission codes, make `material_has_action` resolve as follows:

```sql
project.material_po.view    -> material_po/view
project.material_po.create  -> material_po/edit
project.material_po.delete  -> material_po/delete
project.material_po.approve -> material_po/approve
project.material_po.receive -> material_po/confirm
```

Call `project_actor_has_effective_room_action` for those exact mappings.
`project.material_po.manage` may still be detected as an exception for health
reporting, but it must not satisfy another PO permission. Preserve existing
behavior for non-PO material namespaces.

- [ ] **Step 4: Redefine the main transition RPC with a strict matrix**

For non-company-consolidated project PO:

```sql
sent      => action submit,  prior status in (draft, returned), actor owner/assignee
confirmed => action approve, prior status sent, actor assigned approver
returned  => action approve, prior status sent, actor assigned approver
in_transit/partial/delivered/closed => action confirm, valid logistics transition
```

System Admin bypasses action/assignment but not invalid state transitions.
Validate a submitted target with raw `project_user_has_room_action(...,
'material_po', 'approve')`; admin and fallback alone are not eligible
recipients. Reject caller-supplied actor mismatches. Keep company-consolidated
and WMS-specific branches explicit.

- [ ] **Step 5: Require owner plus delete for removal**

At the top of `remove_purchase_order_v1`, replace the creator/permission OR
with:

```sql
v_has_permission := public.is_admin()
  or (
    nullif(v_po.created_by_id, '') = public.current_app_user_id()::text
    and app_private.project_actor_has_effective_room_action(
      public.current_app_user_id(),
      v_po.project_id::text,
      v_po.construction_site_id::text,
      'material_po',
      'delete'
    )
  );
```

Retain pending-work, stock-impact, safe-delete, and safe-archive checks. Direct
table DELETE stays denied; archive mutation is only performed inside this RPC.

- [ ] **Step 6: Align package, supplemental, and logistics commands**

- Package approval and supplemental approve/reject require effective `approve`
  plus matching `submitted_to_user_id` for non-admin actors.
- Creating/cancelling operational delivery batches and closing short require
  effective `confirm`, not `submit` or `create`.
- Package approval may create its automatic first pending WMS delivery as part
  of the approved command; it does not post stock.
- Creating or updating draft/returned PO schedules uses effective `edit` plus
  owner/assignment.
- Actual receipt/ledger mutation keeps WMS module-admin or warehouse-keeper
  checks in addition to PO `confirm` where the project actor initiates it.

- [ ] **Step 7: Replace permissive PO and child-table RLS**

For project PO rows:

- SELECT: company/WMS special access, effective Room `view`, or owner/assigned
  document visibility.
- INSERT: effective `edit`, active staff, valid project/site, non-company source.
- UPDATE: effective `edit`, `draft/returned`, owner/assigned; specialized WMS
  branches remain limited to receipt fields/statuses guarded by transition
  triggers.
- DELETE: `using (false)`.
- Drop `purchase_orders_archive_update` so direct authenticated archive cannot
  bypass `remove_purchase_order_v1`.

For request links and draft delivery rows, require the parent PO to satisfy the
same edit relationship. For operational delivery rows use `confirm` or the
existing WMS/Keeper branch. Supplemental selection follows parent visibility;
creation follows the correct edit/confirm state; decisions use the assigned
`approve` RPC. Preserve RLS on every exposed `public` table and keep explicit
authenticated grants no broader than the policies.

- [ ] **Step 8: Lock function privileges and reload PostgREST**

Keep explicit-actor helpers private where they are not required by RLS. Public
RPCs grant EXECUTE only to `authenticated`, revoke from `public` and `anon`, and
end the migration with:

```sql
notify pgrst, 'reload schema';
```

- [ ] **Step 9: Run contract tests and commit database enforcement**

```bash
npx vitest run lib/__tests__/materialPoRoomPilotMigration.test.ts lib/__tests__/projectRoomWorkflowEnforcementMigration.test.ts
git add "$MIGRATION_FILE" lib/__tests__/materialPoRoomPilotMigration.test.ts
git commit -m "feat: enforce material PO room actions in database"
```

### Task 6: Add end-to-end SQL allow/deny smoke coverage

**Files:**
- Create: `supabase/tests/material_po_room_permission_pilot_smoke.sql`
- Modify: `supabase/tests/project_room_permission_audit_pilots_smoke.sql`
- Modify: `supabase/tests/phase3_material_permissions_smoke.sql`

**Interfaces:**
- Consumes: migration from Tasks 4–5.
- Produces: transaction-rolled-back proof for Room, fallback, assignment, owner, scope, RLS, package, delivery, and admin behavior.

- [ ] **Step 1: Create fixture actors and scopes inside one transaction**

Create System Admin, editor, submitter, assigned approver, unassigned approver,
confirmer, owner-deleter, non-owner-deleter, fallback-only, manage-only, wrong-site,
and expired-staff users. Create one project, two sites, active/expired staff,
Room memberships, actions, PBAC grants, draft/returned/sent/confirmed PO rows,
and supplemental/delivery fixtures. Start with `begin;` and end with
`rollback;`.

- [ ] **Step 2: Assert registry, fallback, and backfill behavior**

Verify exactly six PO bindings are `pilot`, `create` backfills both `edit` and
`submit`, `manage` creates no Room action, fallback source is reported as
`pbac_fallback`, and toggling `project_room_pbac_fallback_enabled` removes only
fallback-derived actions.

Temporarily set the six PO bindings to `audit_only` inside the smoke
transaction and verify: a Room-only actor is denied, an exact mapped PBAC actor
continues through `pbac_fallback`, System Admin still has an actor override,
recipient lookup remains Room-only, and the Room configuration RPC refuses
changes. Restore the bindings to `pilot` before the remaining assertions.

- [ ] **Step 3: Assert owner, assignment, and state transitions**

Use authenticated JWT fixtures and assert:

- editor can insert/update own draft but cannot submit/delete;
- submitter can send own draft/returned but cannot approve;
- assigned approver can approve and return;
- unassigned approver is denied both actions;
- return produces `returned` and clears recipient assignment;
- confirmer can create/manage delivery and close valid PO states;
- `manage`-only actor cannot perform a PO Room action;
- expired/wrong-site actors are denied;
- System Admin can act but raw recipient lookup excludes the admin.

- [ ] **Step 4: Assert delete and direct API denial**

Verify owner + `delete` succeeds through `remove_purchase_order_v1`; owner
without `delete` and non-owner with `delete` are denied. Direct DELETE, direct
archive, direct workflow-field update, and direct child-table mutation beyond
the actor's action return zero rows or `42501`.

- [ ] **Step 5: Assert WMS separation and company regression**

Confirm PO `confirm` can create a pending logistics/WMS command but cannot post
stock without Keeper/WMS authorization. Confirm company-consolidated PO remains
controlled by company-procurement helpers and is not opened by project Room
membership.

Update the legacy Phase 3 assertions that expected `project.material_po.manage`
to imply view, update, and delete. The new assertions must deny those three
operations and require the grant to appear as a PBAC exception instead.

- [ ] **Step 6: Run local reset and both smoke scripts**

First discover exact supported flags:

```bash
npx supabase db reset --help
npx supabase db query --help
```

Then run:

```bash
npx supabase db reset --local
npx supabase db query --local --file supabase/tests/project_room_permission_audit_pilots_smoke.sql
npx supabase db query --local --file supabase/tests/material_po_room_permission_pilot_smoke.sql
npx supabase db query --local --file supabase/audits/project_permission_room_action_matrix.sql
```

Expected: reset succeeds, both smoke scripts finish without an exception, audit
shows all six PO actions fully wired and only intended fallback-only findings.

- [ ] **Step 7: Commit smoke coverage**

```bash
git add supabase/tests/material_po_room_permission_pilot_smoke.sql supabase/tests/project_room_permission_audit_pilots_smoke.sql supabase/tests/phase3_material_permissions_smoke.sql
git commit -m "test: cover material PO room pilot authorization"
```

### Task 7: Run full local verification and database advisors

**Files:**
- Modify only files required by concrete verification failures in the PO pilot scope.

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: evidence that the branch is ready for Cloud pilot deployment.

- [ ] **Step 1: Run targeted tests together**

```bash
npx vitest run \
  lib/__tests__/projectRoomEffectiveActions.test.ts \
  lib/__tests__/materialPermissions.phase3.test.ts \
  lib/__tests__/materialPoEffectiveRoomActionsUiContract.test.ts \
  lib/__tests__/materialPoRoomPilotMigration.test.ts \
  lib/__tests__/projectPermissionRoomService.test.ts \
  lib/__tests__/projectPermissionRoomsUiContract.test.ts \
  lib/__tests__/purchaseOrderMutationState.test.ts \
  lib/__tests__/purchaseOrderUiPolicy.test.ts \
  lib/__tests__/purchaseOrderActualReceiptUiPolicy.test.ts \
  lib/__tests__/purchaseOrderDrawerRegression.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run the full frontend verification suite**

```bash
npm test
npm run lint
npm run build
```

Expected: all commands exit 0. Record pre-existing unrelated warnings
separately; do not suppress new PO errors.

- [ ] **Step 3: Run local SQL regression suites**

```bash
npx supabase db query --local --file supabase/tests/phase3_material_permissions_smoke.sql
npx supabase db query --local --file supabase/tests/po_master_release_supplemental_approval_smoke.sql
npx supabase db query --local --file supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql
npx supabase db query --local --file supabase/tests/material_po_room_permission_pilot_smoke.sql
```

Update historical assertions that intentionally expected `manage → all`; the
new expected result is that `manage` is reported but grants no Room action.

- [ ] **Step 4: Run database advisors**

Discover flags first:

```bash
npx supabase db advisors --help
```

Then run the local security and performance advisors using supported flags.
Resolve new warnings caused by this migration, especially exposed
`security definer` functions, missing RLS, overly broad grants, and policy
performance regressions.

- [ ] **Step 5: Review the final diff against the approved design**

```bash
git diff origin/feature/phan-quyen-du-an-v4-03.08.2026...HEAD --stat
git diff --check
git status --short --branch
```

Confirm all six actions, owner delete, assigned approve/return, WMS separation,
PBAC exception reporting, rollback, and non-PO Room locking have evidence.

- [ ] **Step 6: Commit verification-only corrections**

If verification required scoped corrections, commit only those files:

```bash
MIGRATION_FILE="$(find supabase/migrations -maxdepth 1 -name '*_material_po_room_permission_pilot.sql' -print | sort | tail -1)"
test -n "$MIGRATION_FILE"
git add lib/permissions/projectRoomEffectiveActions.ts lib/permissions/projectMaterialPermissions.ts hooks/project/material/useProjectMaterialAccess.ts lib/purchaseOrderMutationState.ts lib/purchaseOrderUiPolicy.ts lib/projectPermissionRoomService.ts pages/project/MaterialTab.tsx pages/project/SupplyChainTab.tsx components/project/PurchaseOrderCockpitDrawer.tsx components/project/permissions/ProjectPermissionRoomDrawer.tsx lib/__tests__/materialPoEffectiveRoomActionsUiContract.test.ts lib/__tests__/materialPoRoomPilotMigration.test.ts lib/__tests__/projectRoomEffectiveActions.test.ts lib/__tests__/projectPermissionRoomService.test.ts lib/__tests__/projectPermissionRoomsUiContract.test.ts lib/__tests__/materialPermissions.phase3.test.ts lib/__tests__/purchaseOrderMutationState.test.ts lib/__tests__/purchaseOrderUiPolicy.test.ts lib/__tests__/purchaseOrderActualReceiptUiPolicy.test.ts lib/__tests__/purchaseOrderDrawerRegression.test.ts supabase/audits/project_permission_room_action_matrix.sql supabase/tests/material_po_room_permission_pilot_smoke.sql supabase/tests/project_room_permission_audit_pilots_smoke.sql supabase/tests/phase3_material_permissions_smoke.sql "$MIGRATION_FILE"
git commit -m "fix: close material PO pilot verification gaps"
```

If no corrections were needed, do not create an empty commit.

### Task 8: Apply the Cloud pilot transactionally and hand off acceptance

**Files:**
- No tracked source files; Cloud database state and temporary snapshots only.

**Interfaces:**
- Consumes: verified CLI-generated migration and Cloud direct database URL supplied through the existing secure process.
- Produces: Cloud Room PO pilot with post-apply audit/smoke evidence; does not promote to `enforced`.

- [ ] **Step 1: Confirm migration identity and existing Cloud prerequisites**

```bash
MIGRATION_FILE="$(find supabase/migrations -maxdepth 1 -name '*_material_po_room_permission_pilot.sql' -print | sort | tail -1)"
test -n "$MIGRATION_FILE"
npx supabase migration list --linked
```

Query the live schema to confirm migrations `20260803081928` and
`20260803084812` effects still exist: 78 registry bindings before PO rollout,
9 existing pilot actions, effective-action RPCs present, and the Daily Log
explicit-actor helper not executable by `authenticated`.

- [ ] **Step 2: Create a temporary, non-repository snapshot**

```bash
PILOT_SNAPSHOT_DIR="$(mktemp -d)"
test -n "$PROJECT_DB_URL"
pg_dump "$PROJECT_DB_URL" --schema-only \
  --table=app_private.project_permission_room_action_bindings \
  --table=public.project_permission_room_members \
  --table=public.project_permission_room_member_actions \
  --table=public.user_permission_grants \
  --table=public.purchase_orders \
  --file "$PILOT_SNAPSHOT_DIR/material-po-room-preapply-schema.sql"
```

Export scoped Room/action/grant rows and `pg_get_functiondef`/`pg_policies`
results into the same temporary directory. Do not print credentials or commit
the snapshot.

- [ ] **Step 3: Apply the migration in one transaction**

Because local/remote migration history is not synchronized, use the existing
direct-query process rather than repairing migration history:

```bash
psql "$PROJECT_DB_URL" --set ON_ERROR_STOP=1 --single-transaction --file "$MIGRATION_FILE"
```

Expected: exit 0; any SQL error rolls back the whole migration.

- [ ] **Step 4: Run Cloud post-apply verification**

Use read-only direct queries to verify:

- 78 total registry bindings and 15 pilot bindings;
- exactly six `material_po` bindings are `pilot` with verified source
  `material_po_room_pilot_2026_08_04`;
- Room PO Drawer RPC accepts edits while another audit-only Room rejects them;
- fallback/backfill counts and `manage` exceptions are visible;
- assigned approver can approve/return, unassigned approver cannot;
- owner without `delete` cannot remove a PO;
- project `confirm` cannot bypass WMS stock authorization;
- company-consolidated PO controls are unchanged.

Run the Cloud-safe, rollback-wrapped PO smoke file through the direct query
connection and rerun `project_permission_room_action_matrix.sql`.

- [ ] **Step 5: Hand off user acceptance without enforcing**

Prepare and validate this rollback runbook without executing it during a
healthy pilot:

```sql
begin;

insert into app_private.permission_hardening_settings (key, value)
values ('project_room_pbac_fallback_enabled', 'true'::jsonb)
on conflict (key) do update set value = excluded.value;

update app_private.project_permission_room_action_bindings
set enforcement_status = 'audit_only',
    updated_at = now()
where room_code = 'material_po';

commit;
```

After rollback, rerun the actor-source smoke: exact PBAC users must receive
`pbac_fallback`, Room-only users must be denied, and Drawer actions must be
locked. Preserve all Room/backfill/audit rows.

Report:

- branch/commit IDs and migration basename;
- local test, lint, build, reset, smoke, and advisor results;
- Cloud registry/action counts;
- fallback-only and `project.material_po.manage` exception users requiring
  review;
- the exact test path: create/edit → submit → approve or return → delivery →
  close, plus owner delete denial without Room `delete`.

Keep all six actions at `pilot` and fallback enabled while the user checks.
After explicit acceptance, create a separate reviewed migration to move PO to
`enforced`; do not combine that promotion with this pilot deployment.
