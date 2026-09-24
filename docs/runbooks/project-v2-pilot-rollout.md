# Project V2 → Procurement V2: controlled pilot

This runbook covers the new planning cohort and its canonical Procurement V2 intake. The existing DA29 G9 pilot and its manifest remain governed by [the ERP completion runbook](erp-completion-pilot-rollout.md). Technical verification is recorded in [Project V2 validation](../designs/erp-completion-2026-09-19/evidence/project-v2-validation-20260923.md); it is not business approval.

## Entry gate

Keep the V2 cohort and navigation disabled until the release owner records all of the following for a **named sample project and site**:

1. Deployed app commit and Cloud migration head match the reviewed release. Run Project V2, G2, G5, G6 and G7 rollback smokes on a disposable Cloud preview. Review database advisors, RLS, function ACLs and `search_path`. Do not treat a schema-only migration replay as a full-chain pass when an older migration needs production data.
2. Record active, separate planner, approver, buyer, warehouse and finance users. Review each plan-type Room grant, project/site scope, price visibility, and the no-self-approval rule using the actual personas, never an administrator substitute.
3. Record one versioned contract/BOQ task with a complete norm resource, inventory identity, coefficient, and exact UOM conversion. A missing norm or mapping must remain blocked with a visible reason.
4. Verify overlapping source quantity, unknown norm, approved-revision decrease, duplicate approval/intake, mixed MR and material-plan PO, competing buyers, price hiding, cross-scope denial, and retry after timeout. Unknown balances stay unknown; no command treats them as zero.
5. For the material-plan screen, reconcile each displayed material against whole-project BOQ and confirmed net site receipts. Include a supplier return, an unreceived PO or transfer, a material outside BOQ, a mixed-unit/source group, and receipts above BOQ. The unreceived quantity must stay separate from “Còn lại”; unresolved evidence must display as unknown.
6. Name a release owner, support owner, business approver and evidence location. Confirm the recovery procedure below before enabling any command.

## Enable in stages

1. Verify the deployed artifact and Cloud target. Enroll only the named sample project/site through the guarded workspace command; record actor, reason, resulting workspace ID and audit event. Keep unrelated projects on the existing screens.
2. Grant scoped V2 Room capabilities to the named personas using the existing authorization flow. Verify planner/approver separation, buyer read/allocate rights and warehouse/finance downstream rights. Capture negative tests with a user outside the scope.
3. Open V2 navigation for that cohort and exercise read-only deep links and price visibility first. Confirm the Procurement V2 dossier is initially a read of canonical G2 demand and does not imply a purchase.
4. Permit plan and purchasing commands only after the read-only check, complete the UAT journeys below, and review the resulting demand, PO, receipt, stock and financial traces in their authoritative modules.
5. Expand no cohort until the named business owner signs the UAT record and critical/high issues are closed or have an accepted disposition.

## Business UAT record

For **each** journey, record run ID, timestamp, environment, commit/migration head, actor and persona, project/site, source plan and revision/hash, expected result, actual result, document IDs, evidence link, cleanup, issue owner, and named business signoff. A screenshot or automated pass alone is insufficient. Leave fields unknown when evidence is missing.

| Journey | Actors | Expected business observation |
| --- | --- | --- |
| Cohort entry and monthly plan | Planner, approver | The named project opens V2; monthly quantities come from the approved contract/BOQ baseline; save, submit, return and independent approval persist audit actor/time/reason. |
| Construction plan | Planner, approver | An approved weekly plan links to the exact approved monthly source revision; overlapping quantity is rejected. |
| Material plan | Planner, approver | A missing norm is blocked; after the source norm/UOM is fixed, the calculated and overridden quantities remain distinguishable; approval creates one immutable revision. |
| Project BOQ balance | Planner, warehouse | “Định mức” is the whole-project BOQ, “Đã nhập kho” is confirmed site receipts from every source less supplier returns, and “Còn lại” is their difference. Pending orders/transfers remain separate; mixed or missing evidence is visibly unknown. |
| Purchasing intake | Buyer | Exactly one canonical demand dossier appears for the approved material plan, separate from an independent site MR; source identity and revision are traceable. |
| Supply and PO | Buyer | Only eligible external-purchase lines enter a supplier PO; mixed MR/material-plan lines retain their own source links and do not exceed remaining demand. Timeout retry reuses the same command identity and creates no duplicate PO. |
| Receipt and return path | Buyer, warehouse, finance | The user can follow plan → demand → PO → receipt and return to the dossier; stock and finance effects are checked in their own ledgers. |
| Denial and uncertainty | Out-of-scope user, price-hidden user | Protected references reveal no plan details; unauthorized price and commands stay hidden/denied; unknown quantities remain visibly unresolved. |

## Pause and recovery

1. Stop new V2 cohort enrollment/navigation or return the named cohort to read-only/paused access through the existing guarded control. Record actor, reason and time. Do not delete approved plans or canonical G2 demand and do not sever persisted PO/receipt links.
2. Preserve the failing plan revision/hash, G2 demand ID, source registry IDs, PO command key and downstream document IDs. Classify permission, stale source, conversion, allocation, UI, or downstream execution failure.
3. For an uncertain command result, read the authoritative document and replay only with the **same** idempotency key and payload. For stale revisions, reload source and make a new deliberate decision. Do not create a second MR or infer a balance from the UI.
4. Reconcile approved plan quantities against G2 demand, allocations, PO lines and receipt/stock ledgers. Resolve reductions through the existing source-disposition workflow; reverse downstream effects only through their authoritative commands.
5. Resume the same cohort only after a fresh Cloud/read-model check, owner review of open issues, and a new business decision. The existing DA29 G9 pilot remains independent.

## Exit rule

Automated tests, Cloud smokes and responsive walkthroughs are **technical verification**. The Project V2 pilot is business accepted only after the named sample project completes the journeys with actual results, evidence and cleanup, the planner/approver/buyer/warehouse/finance personas confirm their outcomes, and the release owner records signoff. Never mark an unrun journey or external metric as passed.
