# Material PO Room authoritative cutover — Cloud apply log

Date: 2026-08-04 (Asia/Ho_Chi_Minh)

Branch: `feature/phan-quyen-du-an-v4-03.08.2026`

Migration: `20260804095711_material_po_room_authoritative_cutover.sql`

## Pre-apply snapshot

- Material PO Room: 77 active members, 224 active actions, 0 members with a workflow action but no `view`.
- Legacy PO PBAC retained for audit: 91 active grants, 20 inactive grants, 32 users.
- Six `material_po` bindings remained `pilot`; the per-action fallback column did not yet exist.
- Definition hashes:
  - `purchase_orders_select`: `5a71d179227f2cb088b7a12739ce71bf`
  - effective Room helper: `febb27d4136e37c5b1186489450e6d66`
  - delivery view helper: `18a04cec5d35da09b850abe0b7adef68`

## Validation and apply

- Migration-only Cloud transaction dry-run with rollback: passed.
- Migration + authoritative smoke Cloud transaction dry-run with rollback: passed.
- Applied with `supabase db query --linked` in an explicit transaction; migration history was intentionally not repaired because local/remote history remains divergent.
- Local reset was unavailable because Docker Desktop was not running.

## Post-apply verification

- Binding registry: 78 total actions.
- Pilot actions: 15 total, exactly 6 for `material_po`.
- PO per-action PBAC fallback disabled: 6/6; global fallback remains enabled for other Rooms.
- Material PO Room data unchanged: 77 active members, 224 active actions, 0 members missing `view`.
- Grant provenance now reports both `manual_room` and `pbac_backfill`.
- PO PBAC audit data unchanged: 91 active, 20 inactive, 32 users.
- Nguyễn Phương Thảo transaction test passed: after removing Room `view`, the effective helper denied access and an authenticated direct SELECT returned zero normal PO rows in the tested scope despite legacy PBAC/module access.
- Post-apply definition hashes:
  - `purchase_orders_select`: `73dcb4816f87f6ba361e88e37da2c04d`
  - effective Room helper: `4b270cda126551cb4fd8301ddc03b54d`
  - delivery view helper: `db4cce7a4328862609ea79bb0c50ca20`
- Security advisor completed with existing project-wide warnings (mutable search paths, exposed security-definer RPCs and extensions in `public`); no cutover smoke failure.
- Performance advisor completed: 108 existing findings; no PO/Room-specific finding was returned.
