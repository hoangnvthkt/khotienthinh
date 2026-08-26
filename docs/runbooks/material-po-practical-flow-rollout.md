# Material PO practical flow rollout — 2026-08-26

## Release scope

- Branch: `fix/practical-material-po`
- Practical flow migration: `20260826080153_material_po_practical_flow.sql`
  - SHA-256: `503d51d880377e503206a12a8daed5de52c46963c3fab8d4421dd2c9878be8b7`
- Retirement migration: `20260826084704_retire_material_po_v3_v4_rpcs.sql`
  - SHA-256: `7f7ed32d55d481bb58ac669c431b61fc90d35f04cc9ebacfa0ee26beec4a6fa4`
- Both versions are recorded in `supabase_migrations.schema_migrations` on Supabase Cloud.

The linked project's migration ledger omits many old repository migrations. `db push --dry-run` correctly stopped because it would require `--include-all`. The release did not use that option. Each of the two reviewed PO migrations was applied alone with `psql`, inside its own transaction, and only its own version was recorded in the Cloud migration ledger.

## Pre-cutover facts

Read-only queries were run before `20260826080153`:

| PO | Flow | Status | Batches | WMS links | Important fact |
| --- | ---: | --- | ---: | ---: | --- |
| PO-211 | 4 | confirmed | 0 | 0 | No batch rows to invent or delete |
| PO-259 | 3 | confirmed | 3 | 1 | Batch 1 was quality-approved; accepted stock quantity was 8,024 |
| PO-414 | 4 | in_transit | 1 | 1 | Existing WMS was PENDING |

All four rejected-flow tables were empty before retirement:

- `purchase_order_master_estimates`: 0
- `purchase_order_master_estimate_versions`: 0
- `purchase_order_receipts`: 0
- `purchase_order_receipt_lines`: 0

Their only foreign-key dependencies were within those four tables or from them to existing PO/project/user/WMS tables. No external table depended on them.

## Post-cutover facts

| PO | Flow | Status | Batches | WMS links | Outcome |
| --- | ---: | --- | ---: | ---: | --- |
| PO-211 | 2 | confirmed | 0 | 0 | Preserved without fabricated batches |
| PO-259 | 2 | in_transit | 3 | 3 | All three original batches preserved; missing WMS links created |
| PO-414 | 2 | in_transit | 1 | 1 | Original batch and WMS preserved; QR repaired where missing |

PO-259 batch 1 remains WMS `APPROVED`, batch status `quality_approved`, with accepted stock quantity 8,024. Migration did not finalize it or change that quantity. PO-259 batches 2/3 and PO-414 batch 1 are WMS `PENDING`, ready for real SL/CL approval.

The four empty rejected-flow tables and their obsolete V1/V2/V3/V4 command surfaces were removed. The accepted legacy V2 warehouse-finance trigger was intentionally retained. No active application caller references the removed RPCs or tables.

## Acceptance evidence

`supabase/tests/material_po_practical_flow_smoke.sql` ran against Cloud inside `BEGIN ... ROLLBACK` after each migration.

Single-delivery scenario:

- Sent single order approved idempotently and produced one batch/WMS.
- Ordered 100, delivered 95, quality-accepted 90, with a reason.
- Quality approval moved WMS to `APPROVED` and left stock at 0.
- Finalization added exactly 90 and completed the single order despite the explained shortage.

Multiple-delivery scenario:

- Two batches were submitted and approved before receipt.
- Batch 1: quantity 100, unit price 10,000, VAT 10%; delivered 103 and accepted 101 with a reason.
- Batch 2: quantity 50, unit price 12,000, VAT 5%; delivered 48 and accepted 47 with a reason.
- Each quality approval left stock unchanged.
- Finalization added 101, then 47, for aggregate actual stock of 148.
- Replaying finalization did not add stock a second time.

## Verification

- TypeScript: passed.
- Vitest: 293 files, 1,413 tests passed before Cloud cutover.
- Production build: passed; only the existing Vite chunk-size warning remained.
- Cloud practical-flow smoke: passed after practical migration and after retirement migration.
- Supabase security advisor at `error` level: no issues.
- Supabase performance advisor at `error` level: no issues.
- Cloud lookup confirmed both migration versions, removal of obsolete tables/functions, and preservation of PO-211/259/414 facts.

## Rollback approach

If the UI release must be rolled back, redeploy the last accepted V2 frontend. Do not edit, subtract, or recreate already-completed stock movements. The practical receipt finalizer is idempotent, so completed WMS rows remain the source of truth. Diagnose and correct any future transaction with a new auditable WMS action; never rewrite completed stock history or edit the six historical V3/V4 migrations.
