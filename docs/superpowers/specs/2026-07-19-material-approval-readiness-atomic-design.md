# Material Approval Readiness Atomic Apply Design

**Date:** 2026-07-19
**Status:** Approved design; implementation plan pending review
**Phase:** Phase 02 - Business Role and Minimal SoD, Task 3 readiness prerequisite

## Goal

Close the next three Task 3 blocking permission codes with a single auditable
Cloud apply, while keeping the frontend permission matrix aligned with the
Cloud-verified readiness state.

The promoted codes are:

- `project.material_request.approve`
- `project.material_po.approve`
- `project.custom_material.approve`

## Scope

The tranche has four local deliverables:

1. Apply the already-reviewed state guards for Material Request, Purchase
   Order, and Custom Material approval transitions.
2. Create one new forward-only readiness migration with
   `node_modules/.bin/supabase migration new material_approval_readiness`.
   It promotes exactly the three codes above from active `declared` to
   `verified`, fails closed unless all three prerequisites are present, and
   makes no grants, principal, flag, or unrelated permission change.
3. Add rollback-only SQL smoke coverage for the readiness promotion and retain
   the existing Material runtime behavior smoke.
4. Update the local frontend readiness mapping and focused tests to represent
   all eight Cloud-verified codes at release time: the five Payment/Quantity
   codes already verified in Cloud plus these three Material approval codes.

The existing red Material assertion in
`lib/__tests__/permissionReadiness.test.ts` is intentional test-first coverage.
It becomes green only after the local mapping is updated. The release artifact
remains deployment-blocked until Cloud Gate A12 succeeds.

## Runtime Contracts

Material Request uses
`public.transition_project_material_request_status(text,text,text,text,text,text,text,jsonb)`.
Approval is permitted only for the scoped actor with
`project.material_request.approve`, a pending request, and an `APPROVED`
action.

Purchase Order uses
`public.transition_project_purchase_order_status(text,text,jsonb)`.
Approval is the `sent` to `confirmed` transition and requires
`project.material_po.approve`. A `cancelled` action remains outside this
approval permission: it belongs to the workflow/request rejection path, not a
PO approval control.

Custom Material uses
`public.transition_custom_material_request_status(uuid,text,uuid,text)`.
Approval is `submitted` to `approved` and requires
`project.custom_material.approve`; returned and rejected paths stay distinct.

The exact forward migrations already reviewed for these guards are:

- `20260718151157_material_request_approve_state_guard.sql`
- `20260718152445_purchase_order_approve_state_guard.sql`
- `20260718154050_custom_material_approve_state_guard.sql`

No applied migration is edited.

## Frontend Alignment

`lib/permissions/permissionReadiness.ts` is a local release-time mapping used
by the unified permission view model. Its value must match the Cloud readiness
record at deployment, not predict it.

The mapping and tests will include the five already-verified Payment/Quantity
codes and the three Material codes above. Tests will also assert that
unpromoted Material codes, including Material Request `confirm` and `verify`,
remain declared. No dynamic Cloud-read refactor is introduced in this tranche.

The local frontend change may be built and tested before Cloud Gate A12, but it
must not be deployed, rolled out, or used for a principal Save until A12 has
passed and post-apply evidence matches the mapping.

## Cloud Gate A12: Atomic Apply and Runtime Proof

Cloud Gate A12 is one explicitly approved mutation only after local tests,
diff review, migration hashes, and a read-only Cloud preflight are recorded.
It runs one outer transaction containing, in order:

1. The three exact state-guard migration SQL bodies.
2. The exact generated Material readiness migration SQL body.
3. A savepoint.
4. The existing Material runtime smoke body, with its top-level transaction
   wrapper removed.
5. The new readiness-promotion smoke body, also without its top-level
   transaction wrapper.
6. A rollback to the savepoint, then commit of only the migrations.

Both smoke scripts retain their own fixture and assertion behavior inside the
savepoint. A failed check aborts the outer transaction, so no guard or
readiness promotion is committed.

The Cloud bundle contains no principal preview, Save, direct grant, role
assignment, flag change, migration-history repair, or unrelated SQL.

Post-apply evidence is aggregate-only: three guard contracts persist, the
three Material codes are verified, the five Payment/Quantity codes remain
verified, Payment `mark_paid` remains declared, the named unpromoted Material
codes remain declared, active direct grants remain unchanged at 2282, and
sensitive-flag count remains zero. Identities, emails, tokens, grant rows, and
raw function bodies are never printed.

## Cloud Gate A13: History Repair Only

After A12 postchecks pass, a separate explicit approval may run migration
history repair for exactly the three guard migration versions and the generated
Material readiness migration version. This is metadata-only: it executes no
SQL bodies, applies no grants, and does not Save principals.

The postcheck requires history status `1/1` for only those four versions.

## Verification and Exit Criteria

Local verification includes focused Vitest tests for the frontend mapping and
new migration/smoke static contracts, plus the relevant existing Material guard
tests. SQL files must pass static structure checks and `git diff --check`.

Cloud verification is read-only except at explicitly approved A12 and A13.
After A13, recompute the Task 3 readiness aggregate without printing identity
data. The next blocker count is measured from Cloud evidence rather than
predicted locally.

Task 3 remains a prerequisite: no batch Save of the 12 principals, no partial
Save, and no Phase 03 rollout begins in this tranche.
