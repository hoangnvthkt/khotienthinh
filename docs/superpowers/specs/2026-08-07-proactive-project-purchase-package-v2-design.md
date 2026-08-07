# Proactive Project Purchase Package V2 Design

**Date:** 2026-08-07
**Status:** Approved design, pending written-spec review

## Goal

Extend Purchase Package V2 and its approval, delivery, WMS/QR, receipt, and
close-short lifecycle from request-backed purchase orders to
`proactive_project` purchase orders. Preserve the existing commercial-line
contract that allows the same inventory item to appear on multiple PO lines
when those lines have different prices.

`proactive_stock`, `company_consolidated`, and direct-purchase flows are out of
scope.

## Confirmed scope

The extension applies only to `sourceMode = proactive_project` and only at
construction sites enabled by the existing Purchase Package V2 rollout flag.

The following request-specific behavior does not move to proactive POs:

- selecting or appending material-request lines;
- writing `purchase_order_request_lines` links;
- updating material-request fulfillment quantities or workflow status;
- closing a material-request need.

The PO itself uses the complete Package V2 lifecycle, but remains independent
of any material request.

## Package V2 eligibility

Eligibility must be expressed by one shared domain rule instead of repeating
`sourceMode === 'from_request'` throughout the UI and services.

The rule is:

1. Existing request-backed Package V2 behavior remains unchanged.
2. A new `proactive_project` PO uses Package V2 when its construction site is
   enabled by `VITE_ENABLE_PURCHASE_PACKAGE_V2` and
   `VITE_PURCHASE_PACKAGE_V2_SITE_IDS`.
3. An existing `proactive_project` draft or returned PO may opt in when opened
   and saved through the Package V2 form at an enabled site.
4. A persisted proactive PO is identified as Package V2 when
   `referenceGrossAmount` is not null. Zero is a valid persisted reference
   amount and still marks the PO as V2.
5. Existing proactive POs that are already submitted, approved, in transit,
   partially received, delivered, closed, or cancelled remain on the legacy
   lifecycle unless they were previously persisted as V2.
6. `proactive_stock` never satisfies this rule.

The client rollout flag controls where users can create or convert proactive
Package V2 POs. Database commands independently require the persisted V2
marker for `proactive_project`, so a direct RPC call cannot accidentally move
a legacy proactive PO into the new lifecycle.

## Form and save behavior

At an enabled site, a new or convertible proactive-project PO form exposes the
same Package V2 controls used by a request-backed package:

- purchase mode `single` or `multiple`;
- package reconciliation summary;
- reference gross amount including VAT;
- expected delivery schedule;
- planned delivery quantities and prices.

Saving a proactive Package V2 PO persists:

- `sourceMode = proactive_project`;
- `purchaseMode`;
- `referenceGrossAmount`, including the value zero;
- `fulfillmentMode = RECEIVE_TO_STOCK`;
- the existing commercial PO items and their stable `lineId` values.

The form must not create request links. BOQ and material-budget snapshots,
over-budget warnings, Excel import, unit conversion, supplier splitting,
specifications, notes, VAT, and other proactive-project features remain
available.

When one form submission contains multiple suppliers, the existing split into
one PO per supplier remains. Every resulting PO receives its own Package V2
marker and package metadata.

## Approval and delivery lifecycle

### Single purchase

Approval is atomic and idempotent:

1. Confirm permission, status, persisted Package V2 eligibility, and package
   snapshots.
2. Mark the package confirmed.
3. Reuse a valid planned first batch if the buyer already prepared one;
   otherwise create delivery `-01` from all commercial PO lines.
4. Create one delivery line per PO `lineId`.
5. Create the WMS import transaction and QR for that delivery.
6. Return the package and delivery command result.

### Multiple purchases

Approval confirms the package once. If a valid planned schedule exists, the
approval command prepares that planned delivery and creates its WMS/QR. If no
schedule exists, approval succeeds without a delivery and the buyer creates
deliveries later.

Each later delivery supports the existing Package V2 operations:

- add delivery;
- clone delivery;
- update an unreceived delivery;
- cancel an unreceived delivery;
- open its QR/WMS transaction;
- close the remaining package quantity with a reason.

Delivery prices and quantities may vary from the package reference. The V2
warning and audit behavior remains; the legacy supplemental-approval branch
does not run for an eligible proactive Package V2 PO.

## Commercial-line identity and repeated inventory items

`lineId`, not `itemId`, is the identity of a commercial PO line.

For `proactive_project`:

- the same SKU with different normalized prices is allowed on separate lines;
- the same SKU, supplier, BOQ/budget source, and normalized price remains a
  duplicate and the user must merge the quantity;
- every repeated SKU row must have a non-empty, unique `lineId`;
- editing quantity, price, notes, specifications, or schedules does not replace
  the line ID.

Example:

| PO line | Item | Quantity | Unit price | Line identity |
| --- | --- | ---: | ---: | --- |
| A | VT-001 | 100 | 15,000 | `line-a` |
| B | VT-001 | 50 | 15,500 | `line-b` |

Approval creates two delivery lines. WMS items preserve
`purchaseOrderLineId = line-a` and `purchaseOrderLineId = line-b`; receipt,
accounting price, payable recognition, and supplier-return logic therefore
remain attributable to the intended commercial line.

No Package V2 code may use `find(itemId)` to choose a PO line when repeated
items are possible. Item-level reporting may aggregate lines, but mutation and
reconciliation always use `lineId`.

## UI policy and cockpit

The PO list and cockpit use the shared persisted eligibility rule.

An eligible proactive package exposes:

- **Gửi duyệt gói** while draft;
- **Duyệt gói** and **Yêu cầu chỉnh sửa** while submitted;
- **Mở QR đợt giao**, **Thêm đợt giao**, **Clone đợt**, and **Hủy đợt giao**
  as allowed by mode and state;
- **Kết thúc thiếu** when no active delivery remains and package quantity is
  still open;
- Package V2 reconciliation, history, and print projections.

A legacy proactive PO continues to expose the existing approve, create
delivery, create WMS receipt, supplemental approval, close, payable, and print
actions. The UI must never offer a V2 action that its server command will
reject for lack of persisted eligibility.

## Database command changes

A new forward-only Supabase migration replaces the relevant functions. Old
migration files remain unchanged.

The following command guards must accept either:

- `source_mode = from_request` under the existing rule; or
- `source_mode = proactive_project` with
  `reference_gross_amount IS NOT NULL`.

This applies to package approval, preparation of a planned delivery with
WMS/QR, creation/update/cancellation of unreceived deliveries where a source
guard exists, and package close-short.

Every command continues to enforce:

- authenticated actor identity;
- authoritative Room action permission;
- valid PO and delivery status;
- valid purchase mode and fulfillment mode;
- positive quantities and non-negative prices;
- non-empty, matching PO line and inventory identifiers;
- unique command line identities;
- unit-conversion snapshots;
- idempotency keys.

Any validation failure aborts the whole transaction. A command must not leave
behind an orphan delivery, WMS transaction, or QR.

## Receipt and downstream processing

An eligible proactive package uses the V2 delivery-batch receipt path. It does
not enter the legacy proactive receipt path solely because its source mode is
not `from_request`.

Quality approval and receipt finalization remain delivery-scoped. They preserve
the PO line identity carried by each WMS item and do not query or update
material-request fulfillment links for proactive packages.

Stock, project cost, payable recognition, return/reversal, and document trace
continue to be driven by the accepted delivery/WMS lines. Existing automatic
Package V2 payable behavior remains; the legacy manual **Tạo công nợ NCC**
action must not be shown for an eligible proactive package.

## Error handling

User-facing failures distinguish these cases:

- the PO is legacy and cannot use a Package V2 command;
- the site is outside the rollout scope for create/convert;
- a PO line is missing or has a duplicate `lineId`;
- a delivery line does not match the corresponding PO line and item;
- quantity, price, warehouse, unit, or conversion snapshots are invalid;
- the PO or delivery state changed concurrently;
- the action is not authorized.

Command retries use the existing idempotency contracts. Duplicate submissions
return the already-created delivery result where supported.

## Testing strategy

Implementation follows red-green-refactor and adds focused tests before each
production change.

Required automated coverage:

1. Shared eligibility accepts new/persisted proactive-project V2 POs and
   rejects legacy proactive, out-of-rollout create/convert, proactive-stock,
   company, and direct-purchase POs.
2. The form exposes Package V2 controls and persists package fields for an
   eligible proactive-project PO.
3. Existing submitted/approved legacy proactive POs retain legacy UI policy.
4. Proactive Package V2 uses package submit/approve and delivery actions.
5. Single approval creates or prepares delivery `-01`, WMS, and QR.
6. Multiple approval allows zero delivery when no schedule exists and prepares
   an existing valid schedule when present.
7. Same SKU with different prices and unique `lineId` values survives
   PO -> delivery -> WMS -> receipt as separate lines.
8. Same SKU with the same normalized commercial key remains rejected.
9. Missing or duplicate `lineId` fails before persistence or command mutation.
10. Proactive package receipt performs no material-request link update.
11. Close-short, clone, cancel, receipt, return, payable, print, and amount
    projections recognize the eligible proactive package.
12. Request-backed Package V2 and all legacy proactive behavior remain green.

Verification includes targeted unit and source-contract suites, full `npm
test`, `npm run lint`, `npm run build`, `git diff --check`, and an updated
Supabase Package V2 smoke scenario for `proactive_project` with one SKU on two
prices.

## Rollout and rollback

Rollout continues to use the current environment variables. No repository
default enables all sites.

Before enabling a site, run the full verification suite, Supabase smoke, and
database advisors. Pilot verification creates a disposable proactive-project
package with a repeated SKU at two prices, approves it, receives both lines,
and verifies line-level accounting and return attribution.

Rollback disables the site flag for creation/conversion. Persisted proactive
Package V2 POs must remain operable through V2 server commands until their
lifecycle completes; disabling the UI flag must not strand a PO already marked
with non-null `referenceGrossAmount`. Legacy proactive POs require no data
rewrite.

## Non-goals

- Applying Package V2 to `proactive_stock`.
- Adding request selection or request fulfillment semantics to proactive POs.
- Changing the existing commercial duplicate rules.
- Replacing PO item JSONB with a relational line table.
- Changing supplier splitting or PO numbering.
- Automatically combining equal-price lines.
- Migrating active legacy proactive POs in bulk.
