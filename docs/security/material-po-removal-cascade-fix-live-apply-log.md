# Material PO Removal Cascade Fix — Live Apply Log

**Environment:** Linked Supabase Cloud  
**Applied at:** 2026-08-06T09:47:14+07:00  
**Branch:** `feature/phan-quyen-du-an-v4-03.08.2026`  
**Implementation commit:** `e982177`

## Release scope

- Migration: `20260806024330_material_po_removal_delivery_cascade_fix.sql`
- Migration SHA-256: `42c71b8064bd8534aaac8d366dea4baaec3c04adfa4c3a16bcf8d9bddefb9f96`
- Smoke: `material_po_removal_delivery_cascade_fix_smoke.sql`
- Smoke SHA-256: `c9fec321db419aee788b7f8f16a338a289f0d021ae2014a1cc6ec700c9b92690`

The migration replaced only `public.remove_purchase_order_v1(text)`. It explicitly deletes delivery batches and delivery groups while the locked PO parent remains visible, then deletes the parent. No delivery guard function or trigger was replaced.

## Preflight

The migration and incident scenario were executed together in one rollback-only transaction:

- Fixture selected: `PO-313`
- Non-admin creator removal result: `deleted`
- Unauthorized actor direct batch deletion: zero rows deleted
- Transaction result: `material_po_removal_delivery_cascade_fix_smoke_passed`
- Rollback verification: PO count `1`, delivery batch count `1`, deployed function still had no explicit child deletion before the real apply

## Apply and post-apply smoke

The migration file was applied directly to the linked Cloud database. The standalone rollback-only smoke then passed again on `PO-313`.

Post-apply evidence:

- Removal function MD5: `f7f0cab011d729ed9594fe412e35199e`
- Delivery guard function MD5: `8ec98e6a19fe7a60269c58fead12381d`
- Explicit batch-delete position: `6514`
- Explicit group-delete position: `6720`
- Parent PO-delete position: `6864`
- Enabled delivery guard triggers: `2`
- `PO-313` active parent count after smoke rollback: `1`
- `PO-313` delivery batch count after smoke rollback: `1`
- `PO-313` delivery group count after smoke rollback: `0`

The positions confirm both guarded child deletes execute before the parent delete. The smoke transaction rolled back, so the incident PO remains available for user verification and no diagnostic fixture data was committed.

## Rollback

Restore the previous definition of `public.remove_purchase_order_v1(text)` from `20260713162403_po_full_permission_alignment.sql`. No data repair is required because the release changes function code only.
