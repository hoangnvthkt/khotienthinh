# Project V2 business clarifications — 24 September 2026

These decisions were given by the business owner after the 23 September Project V2 handoff. They refine the three planning screens and the procurement/warehouse boundaries. Existing technical tests and Cloud previews are not business acceptance.

## Planning screens

- The construction schedule is the input. The project material BOQ aggregates each material code across all work items for the **whole project**. In the material-plan reference screen, **Định mức** means that project-wide BOQ total, not the consumption factor of one work item.
- **Đã nhập kho** is cumulative successful receipt into the site warehouse from every source, including internal transfers. It is not current on-hand stock.
- **Còn lại = project-wide material BOQ total − cumulative successful site-warehouse receipts from all sources.** Orders and transfers that have not yet been received are tracked separately and do not silently reduce this column. Current on-hand stock is a separate quantity.
- Goods returned to a supplier after a successful site receipt reduce **Đã nhập kho** and increase **Còn lại** by the same quantity. For example, BOQ 200 t, site receipts 100 t, supplier returns 20 t: the two displayed quantities are 80 t and 120 t.
- Construction plans can use a month or a week. Weekly work and quantity come from an approved monthly plan with exact source linkage; the same source quantity cannot be counted twice.
- The three reference screenshots describe monthly plans, construction plans, and material plans. They are workflow and information references, not a request to copy their crowded layout or to allow editing an approved document.
- Contract BOQ quantity, contract unit price, and amount are unavailable until authoritative source data exists. Their fields remain disabled/clearly unavailable; missing values are never rendered as a meaningful zero. Approved revisions remain immutable and change through a new revision.

## Input presentation

- Keep the input screen focused on the business task: work or material name, necessary quantity, date, receiving location, and the primary action. Secondary derivation and history belong in a drill-down.
- Business material and work codes may support search and reconciliation. Internal UUIDs, norm-resource identifiers, database fields, raw state/error codes, hashes, and technical diagnostic strings must not appear as user-facing labels or values.
- The red input warning for a site material request uses **current available stock in the site warehouse**, after valid reservations. For example, 100 t available permits an entry of 100 t; entering 101 t turns the quantity field red and reveals a reason field and any known goods pending receipt. Returning to 100 t clears the warning and hides that conditional field. A reason permits submission despite the warning. BOQ remaining is a separate planning comparison and never substitutes for this threshold. If authoritative availability is unresolved or the user lacks access, show it as unknown rather than zero or a false shortage.

## Procurement and downstream decisions to carry forward

- Large monthly/weekly supply batches are approved separately. Small site material requests retain the existing multi-step approval. Purchasing is the common place to process those sources plus authorized direct PO, urgent purchase, supplier contract call-off, and internal transfer.
- Users granted PO creation in the PO Room may create direct or urgent orders; PO Room approvers approve them. Urgent purchases may be physically received before supplementary approval/documents are completed. The exact compensating controls and statuses for that exception still need implementation design.
- Site warehouse receipt is the physical source of truth. Supplier payable requires a successful warehouse receipt **and** a supplier invoice; internal transfers do not create supplier payable.

## Release boundary

These clarifications change parts of the earlier Project V2/Procurement V2 implementation assumptions. Reconcile the affected read models and workflows before enabling a V2 cohort or claiming the existing Task 13 pilot gates are met. Do not apply migrations or create production data from this note alone.

## Read-model reconciliation found on 24 September

- The existing `projectMaterialPlanningService` computes its `remainingBoqQty` by subtracting cumulative requests. That value must not be reused for the new **Còn lại** column.
- The existing `get_project_material_boq_reconciliation` groups ledger entries by project without restricting them to site warehouses; its gross inbound quantity also includes project returns. It cannot be directly reused as the new **Đã nhập kho** figure.
- A read-only Cloud check found 930 material BOQ lines across 4 projects. One project/material group contains mixed BOQ units and one contains mixed source types. A material code is therefore not enough to sum quantities safely; the authoritative reader must resolve item identity, unit, and source overlap or return unknown with a clear data issue.
- The Cloud ledger currently has 32 inbound site-warehouse transfer entries. Their posted inventory-transaction metadata identifies 30 as coming from general warehouses and 2 from other projects. Joining only the legacy transaction ID leaves 26 entries unresolved, so that join must not be used as the transfer source of truth.
- The reader should count confirmed inbound supply into the project's site warehouses, including PO, direct/urgent, and incoming internal transfer sources, then subtract confirmed supplier returns. A return of material previously issued from the same project is a second physical inbound movement of already received material, so it must be shown separately rather than counted again as fresh BOQ supply. Same-project site-to-site transfers must likewise not increase the project total. Reversals still need exact source linkage; unresolved reversals make the figure unknown.
- The pure quantity contract now preserves `unknown`, `outside_boq`, and known zero separately, uses exact six-decimal arithmetic, and leaves pending orders/transfers outside the subtraction. It is not connected to live Cloud data or the input screen yet.
- A Project V2 read RPC migration has been prepared but not applied. Its core SELECT was checked read-only on Cloud against ten sampled material groups and the known mixed-unit group; the latter returned unknown BOQ quantity. The full function, permissions, client integration, and Task 13 pilot still require Cloud preview validation before the input screen can show these figures.
- The G6 WMS inventory workspace already separates on-hand, reserved, available, in-transit transfer, and receipt-custody quantities, and marks availability unknown when the stock cache, ledger, or count evidence disagrees. Use that authoritative availability rule for the input warning and pending-goods detail; do not substitute BOQ remainder or silently coerce an unresolved stock balance to zero. The existing project request stock RPC uses only a stock cache and converts missing balances to zero, so it cannot safely power this warning without a new verified read boundary.
- A scoped site-stock read RPC and request-form warning have been prepared. The warning compares requested quantity only against authoritative WMS available stock for the selected site warehouse. The new migration passed a Cloud rollback transaction on 24 September but has **not** been applied, so a live localhost session connected to production Cloud will show stock availability as unresolved until the migration is separately released and persona-tested. The currently displayed pending information is transfer/receipt-custody quantity by category; document-level pending details remain follow-up work.
