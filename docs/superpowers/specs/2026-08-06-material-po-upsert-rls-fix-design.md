# Material PO UPSERT RLS fix

Date: 2026-08-06

## Problem

After the Material PO Room authoritative cutover, creating a new PO fails for
non-admin Room members with PostgreSQL error `42501`. The frontend saves a PO
with `INSERT ... ON CONFLICT`, while `purchase_orders_select` delegates to
`app_private.purchase_order_can_view(id)`. During the new-row UPSERT check, the
helper cannot authorize the not-yet-visible row by id, so RLS rejects the row.
A plain `INSERT` using the same actor, scope, and payload succeeds.

## Decision

Keep Material PO Room authorization authoritative and change only the
`purchase_orders_select` policy. The policy will authorize the current row
directly from its columns:

- project PO: active row plus Room `material_po/view`, global WMS keeper, or
  keeper of the target warehouse;
- company-consolidated PO: company procurement management or visibility from
  linked project request lines;
- archived PO: never visible through the normal SELECT policy.

Dependent-table helpers will continue using
`app_private.purchase_order_can_view(p_purchase_order_id)`. No PBAC fallback,
admin bypass, frontend save behavior, or workflow rule will be added.

## Delivery

Add one forward-only SQL migration that drops and recreates
`purchase_orders_select` with the direct row predicate, then reloads the
PostgREST schema. Rollback is the previous policy definition:
`using (app_private.purchase_order_can_view(id))`.

## Tests

1. A migration contract test must fail until the new migration exists and must
   assert that the SELECT policy uses row columns rather than
   `purchase_order_can_view(id)`.
2. Existing authoritative Room migration tests must continue proving dependent
   records use the parent helper.
3. A linked-Cloud transaction test must impersonate a non-admin user with Room
   `view` and `edit`, UPSERT an allocated PO number, verify the row is visible,
   and roll everything back.
4. After apply, run the same smoke transaction and confirm the migration policy
   definition is live. No diagnostic PO may remain persisted.

## Success criteria

- A full-rights non-admin Room PO member can create a new draft PO through the
  existing UPSERT call.
- Removing Room `view` still removes project PO visibility.
- Existing PO, company procurement, WMS keeper, archived-row, and dependent
  record visibility semantics remain unchanged.
- Admin and existing update flows remain functional.

