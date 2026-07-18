# Phase 02 Task 3 Permission Readiness Matrix

Scope: Phase 02 Business Role and Minimal SoD readiness prerequisite before
Closure Task 3 resumes. This matrix contains permission codes and aggregate
evidence only; it contains no principal, account, grant-row, or manifest data.

Read-only Cloud confirmation on 2026-07-18:

- Pending approved rows: `318` across `12` principals.
- Ready pending rows: `27`.
- Declared blocking rows: `291` across exactly `21` permission codes.
- Blocked principals: `12`.
- Every listed code is `sensitive`, requires direct-grant expiry, and supports
  `global`, `project`, and `construction_site` scopes.

`CANDIDATE` means that an implementation-level backend entry point and an
intended-allow smoke already exist, but it remains `declared` until all missing
negative evidence is added and passes. `MISMATCH` and `BLOCKED` both remain
`declared`; neither status permits a Direct Grant promotion.

| Permission code | Backend entry point | Intended allow | Scope denial | State/ownership denial | Adjacent-action denial | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `project.contract.approve` | missing | catalog-only smoke | missing | missing | missing | `BLOCKED` |
| `project.custom_material.approve` | `public.transition_custom_material_request_status(...)` | `phase3_material_permissions_smoke.sql` | missing | missing | missing | `CANDIDATE` |
| `project.daily_log.confirm` | missing | missing | missing | missing | missing | `BLOCKED` |
| `project.material_po.approve` | `public.transition_project_purchase_order_status(...)` | `phase3_material_permissions_smoke.sql` | missing | missing | existing Approve-to-Receive denial | `CANDIDATE` |
| `project.material_request.approve` | `public.transition_project_material_request_status(...)` | `phase3_material_permissions_smoke.sql` | missing | missing | partial Create-to-Submit denial | `CANDIDATE` |
| `project.material_request.confirm` | modern handler uses `project.material_request.confirm_fulfillment` | mismatched catalog code | missing | missing | missing | `MISMATCH` |
| `project.material_request.verify` | missing | missing | missing | missing | missing | `BLOCKED` |
| `project.payment.approve` | missing | catalog-only smoke | missing | missing | missing | `BLOCKED` |
| `project.payment.confirm` | missing | catalog-only smoke | missing | missing | missing | `BLOCKED` |
| `project.payment.mark_paid` | missing | client/service test only | missing | missing | missing | `BLOCKED` |
| `project.payment.verify` | missing | catalog-only smoke | missing | missing | missing | `BLOCKED` |
| `project.quality.approve` | missing | catalog-only smoke | missing | missing | missing | `BLOCKED` |
| `project.quality.confirm` | missing | missing | missing | missing | missing | `BLOCKED` |
| `project.quality.verify` | missing | catalog-only smoke | missing | missing | missing | `BLOCKED` |
| `project.quantity_acceptance.approve` | missing | catalog-only smoke | missing | missing | missing | `BLOCKED` |
| `project.quantity_acceptance.verify` | missing | catalog-only smoke | missing | missing | missing | `BLOCKED` |
| `project.safety.approve` | missing | missing | missing | missing | missing | `BLOCKED` |
| `project.safety.verify` | missing | missing | missing | missing | missing | `BLOCKED` |
| `project.subcontract.approve` | missing | missing | missing | missing | missing | `BLOCKED` |
| `project.weekly_progress.approve` | missing | missing | missing | missing | missing | `BLOCKED` |
| `project.weekly_progress.verify` | missing | missing | missing | missing | missing | `BLOCKED` |

## Promotion Rule

Only a code with an intended backend allow, wrong-scope denial, valid
state/ownership denial, and adjacent-action denial may move from `CANDIDATE`
to a readiness migration. A failed or absent assertion keeps the code
`declared`; no Direct Grant draft may be partially saved to bypass that result.

## Next Evidence Gate

The three Material candidates require additions to
`supabase/tests/phase3_material_permissions_smoke.sql`. The smoke must run on
the linked Cloud project inside its existing `BEGIN`/`ROLLBACK` wrapper after
explicit Cloud Gate A approval. Only a passing rollback-only smoke may unlock
creation of a new forward readiness migration.
