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
| `project.custom_material.approve` | `public.transition_custom_material_request_status(...)` | Cloud Gate A5 passed intended allow | Cloud Gate A5 passed wrong-project denial | Cloud Gate A5 passed `draft -> approved` denial | Cloud Gate A5 passed Approve-to-Create denial | `CANDIDATE` |
| `project.daily_log.confirm` | missing | missing | missing | missing | missing | `BLOCKED` |
| `project.material_po.approve` | `public.transition_project_purchase_order_status(...)` | Cloud Gate A4 passed intended allow | Cloud Gate A4 passed wrong-project denial | Cloud Gate A4 passed `in_transit -> confirmed` denial | Cloud Gate A4 passed Approve-to-Receive denial | `CANDIDATE` |
| `project.material_request.approve` | `public.transition_project_material_request_status(...)` | Cloud Gate A4 passed intended allow | Cloud Gate A4 passed wrong-project denial | Cloud Gate A4 passed `DRAFT -> APPROVED` denial | Cloud Gate A4 passed Create-to-Submit denial | `CANDIDATE` |
| `project.material_request.confirm` | modern handler uses `project.material_request.confirm_fulfillment` | mismatched catalog code | missing | missing | missing | `MISMATCH` |
| `project.material_request.verify` | missing | missing | missing | missing | missing | `BLOCKED` |
| `project.payment.approve` | `public.transition_project_payment_certificate_status(...)` | Cloud Gate A6R passed `submitted -> approved` | Cloud Gate A6R passed wrong-project denial | Cloud Gate A6R passed `draft -> approved` denial | Cloud Gate A6R passed Approve-to-Confirm denial | `CANDIDATE` |
| `project.payment.confirm` | `public.transition_project_payment_certificate_status(...)` | Cloud Gate A6R passed `approved -> paid` | Cloud Gate A7 passed wrong-project denial | Cloud Gate A7 passed `draft -> paid` denial | Cloud Gate A6R passed Approve-to-Confirm denial | `CANDIDATE` |
| `project.payment.mark_paid` | missing | client/service test only | missing | missing | missing | `BLOCKED` |
| `project.payment.verify` | `public.transition_project_payment_certificate_status(...)` | Cloud Gate A6R passed `submitted -> returned` | Cloud Gate A7 passed wrong-project denial | Cloud Gate A7 passed `draft -> returned` denial | Cloud Gate A7 passed Verify-to-Approve denial | `CANDIDATE` |
| `project.quality.approve` | missing | catalog-only smoke | missing | missing | missing | `BLOCKED` |
| `project.quality.confirm` | missing | missing | missing | missing | missing | `BLOCKED` |
| `project.quality.verify` | missing | catalog-only smoke | missing | missing | missing | `BLOCKED` |
| `project.quantity_acceptance.approve` | `public.transition_project_quantity_acceptance_status(...)` | Cloud Gate A6R passed `submitted -> approved` | Cloud Gate A6R passed wrong-project denial | Cloud Gate A6R passed `draft -> approved` denial | Cloud Gate A6R passed Submit-to-Approve denial | `CANDIDATE` |
| `project.quantity_acceptance.verify` | `public.transition_project_quantity_acceptance_status(...)` | Cloud Gate A6R passed `submitted -> returned` | Cloud Gate A7 passed wrong-project denial | Cloud Gate A7 passed `draft -> returned` denial | Cloud Gate A7 passed Verify-to-Approve denial | `CANDIDATE` |
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

## Cloud Gate A Result

At `2026-07-18T22:07:56+07:00`, the linked Cloud smoke stopped at
`project.material_request.approve incorrectly bypassed workflow state`.
The `APPROVED` branch of
`public.transition_project_material_request_status(...)` lacks a source-status
guard and accepted a fixture transition from `DRAFT` to `APPROVED`. Its
wrong-project denial and intended allow ran before this assertion. The smoke's
outer transaction rolled back; aggregate post-checks confirmed no grant,
readiness, warning-acceptance, or rollout-flag change. No readiness migration
was created.

## Next Evidence Gate

The three Material candidates require additions to
`supabase/tests/phase3_material_permissions_smoke.sql`. The smoke must run on
the linked Cloud project inside its existing `BEGIN`/`ROLLBACK` wrapper after
explicit Cloud Gate A approval. Only a passing rollback-only smoke may unlock
creation of a new forward readiness migration.

## Cloud Gate A2 Result

After explicit approval, the linked Cloud transaction loaded the
forward Material Request state-guard migration and the Material smoke, then
rolled back as one unit. Material Request approval passed its intended allow,
wrong-project denial, and `DRAFT -> APPROVED` denial. The smoke then stopped at
`project.material_po.approve incorrectly bypassed workflow state`: the current
PO handler accepted `in_transit -> confirmed`. This keeps the PO code
`declared` and blocks any readiness promotion. Post-failure aggregate evidence
confirmed zero enabled rollout flags, unchanged readiness totals
(`229` declared, `59` legacy, `13` verified), `103` active sensitive grants,
and no remote history entry for the forward guard migration.

## Cloud Gate A4 Result

After correction of the PO approval fixtures, the linked transaction loaded
both forward state guards and ran the Material smoke before rolling back. The
Material Request and PO approval checks completed, including their intended
allows, wrong-project denials, state denials, and adjacent-action denials. The
smoke then stopped at `project.custom_material.approve incorrectly bypassed
workflow state`: the current Custom Material handler accepted `draft ->
approved`. All three codes remain `declared`; no readiness promotion is
unlocked until Custom Material has an approved forward guard and a passing
rollback-only smoke.

## Cloud Gate A5 Result

The linked Cloud transaction loaded the three forward Material state guards,
then completed the full Material smoke checkpoint
`phase02_task3_material_readiness_smoke_passed` before its outer rollback. All
three Material approval codes now have passing intended allow, wrong-scope,
workflow-state, and adjacent-action evidence. Post-rollback aggregate checks
remain `2282` active Direct Grants, `103` sensitive grants, readiness `229`
declared / `59` legacy / `13` verified, zero warning acceptances and zero
enabled hardening flags. All three guards remain absent from remote migration
history. The codes remain `declared` candidates: no readiness promotion or
principal Save is authorized while the other blocking codes remain incomplete.

## Cloud Gate A6R Result

At `2026-07-18T23:12:09+07:00`, the linked Cloud transaction loaded the
Payment Certificate and Quantity Acceptance transition migration, completed
the rollback-only checkpoint `phase02_task3_payment_quantity_readiness_smoke_passed`,
then rolled back. Post-rollback aggregates are unchanged: `2282` active Direct
Grants, readiness `229` declared / `59` legacy / `13` verified, zero enabled
hardening flags, zero remote history rows for the forward migration, and zero
persisted transition RPC rows.

The smoke supplies all four evidence dimensions for
`project.payment.approve` and `project.quantity_acceptance.approve`, which are
now `CANDIDATE` only. It proves the intended return paths for
`project.payment.verify` and `project.quantity_acceptance.verify`, and the
intended paid path for `project.payment.confirm`, but does not yet isolate each
of their scope, invalid-state, and adjacent-action denials. Those three codes,
and `project.payment.mark_paid`, remain `BLOCKED` and `declared`; no readiness
promotion or principal Save is authorized.

## Cloud Gate A7 Result

At `2026-07-18T23:18:21+07:00`, the expanded linked Cloud smoke completed the
same rollback-only checkpoint before its outer rollback. It adds the missing
wrong-project, draft-state and adjacent-action denials for
`project.payment.verify`, `project.payment.confirm`, and
`project.quantity_acceptance.verify`. Those three codes now have all four
required evidence dimensions and are `CANDIDATE` alongside Payment Approve and
Quantity Approve.

Post-rollback aggregates remain `2282` active Direct Grants, readiness `229`
declared / `59` legacy / `13` verified, zero enabled hardening flags, zero
remote history rows for the forward migration, and zero persisted transition
RPC rows. The five `CANDIDATE` codes remain `declared` until a separate,
exact readiness-promotion migration is locally verified and receives its own
Cloud gates. `project.payment.mark_paid` remains `BLOCKED`.

## Cloud Gate A8 Result

At `2026-07-18T23:25:15+07:00`, the linked Cloud transaction loaded the exact
readiness-promotion migration `20260718161857` (SHA-256
`293f04688c62bea5f9ae70d735b4be02c8bdbb282eaf0dfac5ea9d712481a0c1`) and
its promotion smoke (SHA-256
`b43359079bee68c05b7955b4de8c76f22e3f2cf88d3591ed7625449ca37017da`). The
combined rollback-only bundle (SHA-256
`5ad55a0d39799fd3afad1da3d0ff5d09c2653167d54228969d1fb192e6391a0e`) reached
`phase02_task3_payment_quantity_readiness_promotion_smoke_passed` before its
outer rollback.

During the transaction, only the five candidate codes were temporarily
promoted to `verified`: `project.payment.verify`, `project.payment.approve`,
`project.payment.confirm`, `project.quantity_acceptance.verify`, and
`project.quantity_acceptance.approve`. Post-rollback read-only evidence shows
all five back at `declared`, `project.payment.mark_paid` still `declared`, zero
remote history rows for `20260718161857`, `2282` active Direct Grants, and zero
enabled hardening flags. No principal preview or Save, migration apply/history
repair, grant, or rollout-flag mutation occurred.

## Cloud Gate A9 Result

At `2026-07-18T23:26:51+07:00`, after a matching read-only preflight, the
approved linked Cloud apply ran exactly migration `20260718161857` (SHA-256
`293f04688c62bea5f9ae70d735b4be02c8bdbb282eaf0dfac5ea9d712481a0c1`). The
five runtime-backed candidate codes are now persistently `verified`:
`project.payment.verify`, `project.payment.approve`,
`project.payment.confirm`, `project.quantity_acceptance.verify`, and
`project.quantity_acceptance.approve`.

Read-only post-apply evidence confirms `project.payment.mark_paid` remains
`declared`, active Direct Grants remain `2282`, and zero hardening flags are
enabled. As explicitly scoped, this direct migration apply did not repair
Supabase migration history: the remote history count for `20260718161857`
remains zero. No principal preview or Save, grant, or rollout-flag mutation
occurred. Any migration-history repair remains a separate, unapproved action.

## Cloud Gate A10 Result

At `2026-07-18T23:37:33+07:00`, the linked Cloud transaction applied the
Payment/Quantity command migration `20260718155122` (SHA-256
`804728efc3fad0b10738ea8d423fff819ea79354680f11b1e9ac2c56bd7df0ef`), then
ran its smoke (SHA-256
`2b7fa00ccfcb4195d279f81b9f658f5ea6ea304758372a91817b714cc782de5b`) after a
savepoint. The bundle SHA-256 was
`e2a0269bfe3b38538b5a3a186b191d2083fe585645013db8dd21cf40e10f8e3f` and it
reached `phase02_task3_payment_quantity_readiness_smoke_passed`. The smoke
fixture work rolled back to the savepoint before the outer transaction
committed the runtime objects.

Post-apply read-only evidence confirms both transition RPCs, both private
workflow guards, and the exact triggers on `payment_certificates` and
`quantity_acceptances` now exist. The five Payment/Quantity candidate codes
remain `verified`; `project.payment.mark_paid` remains `declared`; active
Direct Grants remain `2282`; and zero hardening flags are enabled. Neither
`20260718155122` nor `20260718161857` has a remote history row yet. No
principal preview or Save, grant, warning-acceptance, rollout-flag, readiness,
or migration-history mutation occurred beyond the approved runtime apply.
