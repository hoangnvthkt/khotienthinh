# Material Request Room cutover release — 2026-08-05

Branch: `feature/phan-quyen-du-an-v4-03.08.2026`

Migration: `20260805105313_material_request_room_authoritative_cutover.sql`

## Cloud snapshot before apply

- Registry: 78 bindings; 15 actions at `pilot`.
- Material Request: eight bindings at `audit_only`; fallback enabled for all.
- Active PBAC under `project.material_request.*`: 236 grants.
- Active Room actions: 987 (`manual_room`: 887, `pbac_backfill`: 100).
- Relevant policy hash: `fe681c1fdf740800bb3da8fb1a7ee3fc`.
- Relevant function hash: `8455fbf9fbe2fd15fc5ce89e9f49f757`.

The migration passed three linked-Cloud transaction dry-runs before apply.

## Cloud verification after apply

- Registry: 78 bindings; 22 actions at `pilot`.
- Material Request: exactly seven actions at `pilot`, with per-action PBAC
  fallback disabled: `view`, `edit`, `delete`, `submit`, `approve`, `confirm`,
  `view_available_stock`.
- `verify` remains `audit_only`, with fallback enabled.
- Every Material Request mutation action requires `view`.
- The Room has no save-time required recipient actions and can be empty.
- Active PBAC under `project.material_request.*` remains exactly 236 grants;
  these records are retained for audit and do not authorize the seven pilot
  actions.
- Active Material Request Room actions: 367 (`manual_room`: 269,
  `pbac_backfill`: 98).
- Relevant policy hash: `16e3e646ecbda6558de888f1b2f73a1e`.
- Relevant function hash: `7c398d66c5185cd2a70db3346f317ab5`.
- Linked SQL smoke completed successfully and rolled back its transaction.
- Linked `db lint` reported no issue in the new cutover helpers/projections.
  The database still has pre-existing lint findings in unrelated legacy
  functions; they were not changed in this release.

Local Supabase reset was unavailable because the local Docker daemon was not
running. Linked-Cloud dry-run, apply and post-apply smoke were used instead.

## Rollback switch

Set `pbac_fallback_enabled = true` for the seven Material Request pilot
bindings and restore the policy/function snapshot above. Keep Room actions,
PBAC grants and grant sources intact for traceability.
