# Material PO Removal Delivery Cascade Fix

**Date:** 2026-08-06
**Status:** Proposed for implementation
**Incident:** PO-313, created and removed by Bùi Quang Chung

## Problem

`public.remove_purchase_order_v1` authorizes PO removal correctly, verifies that the PO has no pending work or stock impact, and then deletes the parent row from `purchase_orders`. The foreign-key cascade subsequently deletes rows from `purchase_order_delivery_batches` and `purchase_order_delivery_groups`.

Both delivery tables have a `BEFORE DELETE` guard. During the parent cascade, `app_private.purchase_order_delivery_can_mutate(old.purchase_order_id)` can no longer resolve the parent PO, so it returns `false` for a normal authenticated user. The guard then raises the misleading error that `confirm` permission is required. This affects a valid draft-PO creator even when that user has Room `edit` and `delete` permissions.

The failure is caused by deletion order, not by missing Room permissions.

## Decision

Change only the no-stock-impact hard-delete branch of `public.remove_purchase_order_v1`:

1. Keep the existing PO authorization, pending-work check, and stock-impact check unchanged.
2. After all existing dependent-data cleanup succeeds, explicitly delete delivery rows that reference the PO while the locked parent PO still exists.
3. Delete `purchase_order_delivery_batches` and `purchase_order_delivery_groups` in a dependency-safe order determined from the current schema.
4. Delete the parent `purchase_orders` row last.

The existing delivery delete guard remains enabled. Because the parent still exists during explicit child deletion, it can evaluate the actor against the real PO state:

- Admin, WMS-authorized actors, or Room actors with `confirm` continue to pass.
- The creator of a `draft` or `returned` PO continues to pass only when they also have Room `edit`.
- A user without the required delivery mutation authority remains blocked.
- An approved PO still requires the existing elevated delivery authority; this hotfix does not grant a bypass.

No special session flag, trigger bypass, or broader permission is introduced.

## Safety boundaries

- Preserve the current `v_has_permission` calculation, including admin, creator, and `project.material_po.delete` paths.
- Preserve `app_private.project_po_has_pending_work_v1` as a hard stop.
- Preserve `app_private.project_po_has_stock_impact_v1` and perform explicit delivery cleanup only in the no-stock-impact branch.
- Preserve the archive branch and its permission/status rules unchanged.
- Preserve `app_private.guard_purchase_order_delivery_delete` and `app_private.purchase_order_delivery_can_mutate` unchanged.
- Let existing foreign keys clean up delivery-line descendants where applicable; do not manually broaden the deletion scope beyond the target PO.
- Keep the whole RPC operation transactional so any child-delete or parent-delete failure rolls back all cleanup.

## Verification

### Automated contract test

Add a migration contract test that fails before the migration exists and then verifies:

- The migration replaces `public.remove_purchase_order_v1`.
- Explicit delivery child deletion occurs before parent PO deletion.
- The existing permission, pending-work, and stock-impact gates remain present.
- The migration does not replace or weaken the delivery delete guard.

### Cloud rollback smoke test

Run the migration and smoke scenario inside a transaction that is always rolled back:

1. Select a non-admin creator-owned `draft` or `returned` PO with Room `edit` and `delete`, no pending work, no stock impact, and at least one safe delivery child; PO-313 is the incident fixture when still available.
2. Impersonate that creator through authenticated JWT claims.
3. Call `public.remove_purchase_order_v1` and assert the result is `deleted`.
4. Assert the parent and its delivery children are absent inside the transaction.
5. Roll back and confirm the fixture is unchanged.

Also retain a negative assertion that direct delivery deletion is still rejected for an actor who lacks the authority required by the existing guard.

## Rollback

Restore the prior definition of `public.remove_purchase_order_v1`. No schema or data migration is required. Because the release changes only function code and all validation writes are rolled back, rollback does not require data repair.
