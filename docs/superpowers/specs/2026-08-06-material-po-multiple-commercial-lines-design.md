# Material PO Multiple Commercial Lines Design

**Date:** 2026-08-06
**Status:** Approved approach, pending written-spec review

## Problem and evidence

The Material PO form currently rejects two rows when they share the same supplier, inventory item, material-budget source, and request-line source. The validation does not include `unitPrice`, so a proactive PO cannot represent one SKU purchased from the same supplier at multiple prices.

The rejection happens in `pages/project/SupplyChainTab.tsx` before any Supabase write. Cloud `purchase_orders` stores `items` as JSONB and has no constraint or trigger that prohibits repeated `itemId` values. Delivery, receipt, and supplier-return domains already use `lineId`/`purchaseOrderLineId` as their preferred line identity.

No active Cloud PO currently contains repeated `itemId` rows, so this change requires no data migration.

## Business rule

A proactive PO may contain multiple independent commercial lines for the same SKU. Each commercial line has its own:

- stable and unique `lineId`;
- purchase quantity;
- purchase unit price;
- BOQ/budget source snapshot, when selected;
- note/specification and delivery allocation.

For `proactive_project` and `proactive_stock`:

- Same SKU and different normalized unit prices are allowed as separate rows.
- Same SKU and the same normalized unit price under the same supplier and BOQ/budget source remain blocked; the user must merge their quantities.
- Rows belonging to different suppliers continue to be split into separate POs by the existing procurement-group flow.

The existing `from_request` duplicate rule remains unchanged. PO creation from project requests must still preserve request-line allocation semantics. `company_consolidated` and site direct-purchase domains are outside this form change.

## Line identity contract

`lineId`, not `itemId`, is the identity of a commercial PO line.

- New manual and Excel-created rows receive a UUID before save.
- `lineId` remains stable when quantity, price, delivery schedule, or PO metadata is edited.
- When one PO contains repeated `itemId` values, every repeated row must have a non-empty, distinct `lineId`.
- Legacy rows without `lineId` may continue using `itemId` as a fallback only when that item occurs once in the PO. Opening a legacy PO for editing hydrates a stable form `lineId`, which is persisted on save.
- A duplicate or missing line identity in an ambiguous repeated-SKU payload is rejected before persistence.

No database schema change is required. `purchase_orders.items` remains the commercial-line snapshot, and existing child tables continue referencing it through `purchase_order_line_id`.

## Validation and save flow

Extract the inline duplicate test into a pure commercial-line validator so the source-mode rules can be tested independently.

For each normalized row, the validator derives:

- supplier ID;
- item ID;
- material-budget ID or empty value;
- request-line ID or empty value;
- parsed numeric unit price;
- line ID.

The save flow becomes:

1. Normalize quantities, prices, supplier data, BOQ snapshots, and line IDs.
2. Validate inventory-code and supplier requirements.
3. Apply the source-mode-specific duplicate rule.
4. Validate unique line identities for repeated SKUs.
5. Calculate totals from every commercial line.
6. Split rows into one PO per supplier as today.
7. Persist the PO JSONB and line-linked delivery/request records.

For proactive modes, two lines with the same supplier/item/BOQ source are valid only when their parsed unit prices differ. Inputs such as `1.000` and `1000` are the same normalized price and remain a duplicate.

Error messages identify both the SKU and the conflicting price. For a same-price conflict, the UI instructs the user to merge quantities. For a line-identity conflict, the UI reports an invalid commercial-line identifier instead of a generic duplicate-SKU message.

## BOQ and over-budget snapshots

Repeated proactive-project lines may point to the same material-budget row. The current preview treats every other matching form row as prior quantity, which can count the same over-budget quantity more than once.

Calculate budget snapshots in form-row order per `materialBudgetItemId`:

1. Start with quantities already requested/ordered outside the edited PO.
2. Add the stock-equivalent quantity of each preceding form row.
3. Allocate only the incremental over-budget quantity caused by the current row.
4. Ensure the sum of line-level `overBudgetQtySnapshot` values equals the actual form-level overage.

This rule affects only budget snapshot allocation; total ordered quantity continues to be the sum of all commercial lines.

## Excel import and update

PO Excel behavior must match manual entry.

### Create import

- Use `SKU + normalized unit price` as the proactive commercial-row key.
- Accept repeated SKU rows when their prices differ.
- Reject repeated `SKU + price` rows and instruct the user to merge quantity.
- Generate a unique `lineId` for every accepted row.

### Update import

- Add an optional `Mã dòng PO` column to the update template.
- Use `Mã dòng PO` as the authoritative key when provided.
- Continue allowing SKU-only updates when that SKU occurs once in the current PO.
- If the current PO has repeated SKU rows and the import omits `Mã dòng PO`, reject the row as ambiguous instead of updating the first match.

Shared Excel-import defaults remain unchanged for other modules.

## Downstream behavior and impact

### Already line-safe; retain and regression-test

- Delivery schedule lines use `purchaseOrderLineId`.
- WMS receipt generation resolves the source PO row by `lineId` and preserves that row's price.
- Receipt finalization updates `receivedQty` by line key.
- Supplier returns are created and reconciled by PO line ID.
- PO total, VAT, payable amount, and print rows sum commercial lines independently.

These flows should require tests and at most narrow fallback corrections, not a schema redesign.

### Consumers requiring correction

- PO Excel create/update currently uses SKU as its only key.
- The fallback stock report uses `find(itemId)` and can undercount when a transaction contains multiple lines for the same inventory item; aggregate all matching lines instead.
- Inventory transaction history currently displays the first matching item line; show the aggregate quantity for that item within the transaction while detailed transaction views continue showing individual commercial lines.
- Material planning currently selects an arbitrary first line when the newest confirmed PO contains multiple prices for one SKU. For the newest confirmed PO date, calculate a stock-unit weighted average across that PO's matching commercial lines, then use that value as the latest confirmed PO price.

Inventory ledger posting already creates one entry per transaction line, so stock and cost entries remain line-preserving. No ledger migration is needed.

## Scope and non-goals

Included:

- Manual create/edit for `proactive_project` and `proactive_stock` POs.
- PO Excel create/update consistency.
- Line identity validation.
- BOQ overage allocation for repeated proactive-project lines.
- Regression coverage for delivery, receipt, return, totals, print, planning price, and fallback reports.

Not included:

- Changing duplicate semantics for `from_request` POs.
- Converting JSONB PO items into a new relational `purchase_order_lines` table.
- Changing supplier splitting or procurement-group numbering.
- Combining equal-price rows automatically; the user remains responsible for confirming the merged quantity.
- Changing site direct-purchase or company-consolidated workflows.

## Testing strategy

Add focused tests for:

- proactive same SKU/different price accepted;
- proactive same SKU/same normalized price rejected;
- request-source duplicate behavior unchanged;
- repeated SKU rows require unique `lineId` values;
- total, VAT basis, and print lines retain both commercial prices;
- delivery schedule, receipt, and supplier return target the intended line ID;
- Excel create accepts different prices and rejects equal-price duplicates;
- Excel update rejects ambiguous SKU-only updates and accepts `Mã dòng PO`;
- BOQ overage is allocated once across repeated rows;
- stock-report fallback and inventory history aggregate repeated transaction items;
- planning price uses the weighted average of the newest confirmed PO's matching lines.

Manual verification should create a proactive PO with one SKU on two price rows, approve it, create/receive a delivery for each line, print the PO, and create a supplier return inside a rollback-safe test scenario where practical.

## Risk and rollback

Overall implementation risk is medium because storage and core line-linked workflows already support the model, while import, planning, and fallback reports need explicit ambiguity handling.

Rollback consists of restoring the prior proactive duplicate validator and associated consumer behavior. No data migration is needed. POs created with multiple commercial lines remain valid JSONB records and can still be read because existing consumers already fall back to line-level iteration; rollback should not delete or rewrite those POs.
