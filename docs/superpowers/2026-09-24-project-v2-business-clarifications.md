# Project V2 business clarifications — 24 September 2026

These decisions were given by the business owner after the 23 September Project V2 handoff. They refine the three planning screens and the procurement/warehouse boundaries. Existing technical tests and Cloud previews are not business acceptance.

## Planning screens

- The construction schedule is the input. The project material BOQ aggregates each material code across all work items for the **whole project**. In the material-plan reference screen, **Định mức** means that project-wide BOQ total, not the consumption factor of one work item.
- **Đã nhập kho** is cumulative successful receipt into the site warehouse from every source, including internal transfers. It is not current on-hand stock.
- **Còn lại = project-wide material BOQ total − cumulative successful site-warehouse receipts from all sources.** Orders and transfers that have not yet been received are tracked separately and do not silently reduce this column. Current on-hand stock is a separate quantity.
- Construction plans can use a month or a week. Weekly work and quantity come from an approved monthly plan with exact source linkage; the same source quantity cannot be counted twice.
- The three reference screenshots describe monthly plans, construction plans, and material plans. They are workflow and information references, not a request to copy their crowded layout or to allow editing an approved document.
- Contract BOQ quantity, contract unit price, and amount are unavailable until authoritative source data exists. Their fields remain disabled/clearly unavailable; missing values are never rendered as a meaningful zero. Approved revisions remain immutable and change through a new revision.

## Input presentation

- Keep the input screen focused on the business task: work or material name, necessary quantity, date, receiving location, and the primary action. Secondary derivation and history belong in a drill-down.
- Business material and work codes may support search and reconciliation. Internal UUIDs, norm-resource identifiers, database fields, raw state/error codes, hashes, and technical diagnostic strings must not appear as user-facing labels or values.
- When a requested quantity crosses the relevant warning threshold, the input changes visibly and shows a reason field plus available details of goods pending receipt. Returning the quantity within the threshold removes that conditional field. The warning does not hard-block submission when a valid reason is supplied. The exact relationship between the example's current-stock threshold and the BOQ headroom must be resolved before coding this calculation; they are distinct quantities.

## Procurement and downstream decisions to carry forward

- Large monthly/weekly supply batches are approved separately. Small site material requests retain the existing multi-step approval. Purchasing is the common place to process those sources plus authorized direct PO, urgent purchase, supplier contract call-off, and internal transfer.
- Users granted PO creation in the PO Room may create direct or urgent orders; PO Room approvers approve them. Urgent purchases may be physically received before supplementary approval/documents are completed. The exact compensating controls and statuses for that exception still need implementation design.
- Site warehouse receipt is the physical source of truth. Supplier payable requires a successful warehouse receipt **and** a supplier invoice; internal transfers do not create supplier payable.

## Release boundary

These clarifications change parts of the earlier Project V2/Procurement V2 implementation assumptions. Reconcile the affected read models and workflows before enabling a V2 cohort or claiming the existing Task 13 pilot gates are met. Do not apply migrations or create production data from this note alone.
