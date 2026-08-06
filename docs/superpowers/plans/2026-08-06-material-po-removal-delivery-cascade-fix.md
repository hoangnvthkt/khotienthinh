# Material PO Removal Delivery Cascade Fix Implementation Plan

> **For Codex:** Execute this plan directly on the current branch. Follow test-driven development and stop before Cloud apply if the rollback preflight fails.

**Goal:** Allow an authorized creator to hard-delete a safe draft/returned Material PO that has delivery children, without weakening the existing delivery mutation guard.

**Architecture:** Replace only `public.remove_purchase_order_v1`. In its existing no-stock-impact branch, explicitly delete `purchase_order_delivery_batches` and `purchase_order_delivery_groups` while the locked parent PO still exists, then delete the PO. Existing authorization, pending-work, stock-impact, archive, and child-delete guard logic remains unchanged.

**Tech stack:** PostgreSQL/PLpgSQL, Supabase migrations and linked database CLI, Vitest migration contract tests.

---

## Task 1: Add a failing migration contract test

**Files:**

- Create: `lib/__tests__/materialPoRemovalCascadeFixMigration.test.ts`

1. Read the future migration by the suffix `_material_po_removal_delivery_cascade_fix.sql`.
2. Assert that it replaces `public.remove_purchase_order_v1(text)`.
3. Assert that explicit deletes for both delivery tables appear before the parent `purchase_orders` delete.
4. Assert that the existing creator/Room authorization and the pending-work and stock-impact helpers remain in the function.
5. Assert that the migration does not replace `app_private.guard_purchase_order_delivery_delete` or `app_private.purchase_order_delivery_can_mutate`.
6. Run `npx vitest run lib/__tests__/materialPoRemovalCascadeFixMigration.test.ts` and confirm RED because the migration does not exist.

## Task 2: Create the minimal function migration

**Files:**

- Create with CLI: `supabase/migrations/<timestamp>_material_po_removal_delivery_cascade_fix.sql`
- Reference: `supabase/migrations/20260713162403_po_full_permission_alignment.sql`

1. Run `npx supabase migration new material_po_removal_delivery_cascade_fix`.
2. Copy the latest complete definition of `public.remove_purchase_order_v1` into the generated migration.
3. In the no-stock-impact branch, after existing dependent cleanup and before deleting `purchase_orders`, explicitly delete:
   - `purchase_order_delivery_batches` for the locked PO;
   - `purchase_order_delivery_groups` for the locked PO.
4. Keep the parent row present until both guarded deletes complete. Do not add a bypass flag or change the guard functions.
5. Preserve function revoke/grant statements from the latest definition.
6. Run the focused Vitest test and confirm GREEN.
7. Run existing Material PO migration tests to check adjacent contracts.

## Task 3: Add a rollback-only Cloud smoke test

**Files:**

- Create: `supabase/tests/material_po_removal_delivery_cascade_fix_smoke.sql`

1. Begin a transaction and select a non-admin creator-owned `draft` or `returned` PO with Room `edit` and `delete`, at least one delivery child, no pending work, and no stock impact. Prefer PO-313 when it still matches the safety criteria.
2. Record parent, delivery-batch, and delivery-group counts in a temporary fixture table accessible to `authenticated`.
3. Set authenticated JWT claims for the creator and call `public.remove_purchase_order_v1`.
4. Assert action `deleted` and zero target parent/child rows inside the transaction.
5. Add a negative guard check for an actor who does not satisfy `purchase_order_delivery_can_mutate`, using an exception block or savepoint-safe PL/pgSQL assertion.
6. Reset the role, emit a pass marker, and roll back.
7. Confirm outside the transaction that PO-313 and its delivery children remain unchanged.

## Task 4: Preflight the migration against Cloud

**Files:**

- Modify if needed: migration and smoke SQL only

1. Load the linked Supabase environment without printing secrets.
2. Execute `BEGIN + migration + smoke assertions + ROLLBACK` as one linked-database query.
3. If any assertion fails, inspect the exact constraint/trigger path, update the test first where needed, and repeat the rollback-only preflight.
4. Confirm the migration function body and incident fixture are unchanged after rollback.

## Task 5: Apply and verify on Cloud

**Files:**

- Create: `docs/security/material-po-removal-cascade-fix-live-apply-log.md`

1. Apply only the new migration to the linked database.
2. Run the rollback-only smoke test again against the applied function.
3. Query and record the function definition hash, child guard trigger/function presence, and PO-313 state.
4. Confirm no diagnostic rows or committed fixture changes remain.
5. Record timestamps, commands, results, and rollback notes in the live apply log without secrets.

## Task 6: Full verification and commits

**Files:**

- All files above

1. Run `git diff --check`.
2. Run `npx vitest run --exclude '.worktrees/**'`.
3. Run `npm run build`.
4. Re-run the post-apply Cloud smoke and evidence queries.
5. Inspect `git status --short` and ensure only intended files changed.
6. Commit implementation/tests and release evidence intentionally on the current branch.
7. Hand off the exact verification counts, Cloud result, commit IDs, and remaining branch integration options.
