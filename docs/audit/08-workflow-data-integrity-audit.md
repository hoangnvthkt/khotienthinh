# 08. Workflow and data-integrity audit

## Kết luận

Một số transition trọng yếu đã được chuyển vào locked RPC và có guard tốt, đặc biệt Daily Log status và WMS stock move. Tuy nhiên nhiều end-to-end flows vẫn chia thành nhiều PostgREST/RPC calls; “bước chính đã commit, bước đồng bộ sau lỗi” là failure mode lặp lại. Ngoài atomicity, MR/PO/Payment/Contract/Quality/Safety thiếu state matrix backend đầy đủ.

## Trace matrix

| Luồng | Coverage | Control tốt | Gap chính |
|---|---|---|---|
| Auth/permission init | Full static | Session getUser | Grant error → legacy; client không honor cutoff |
| Project membership/access | Full static | Scoped PBAC functions | DA legacy can see all projects |
| Daily Log member → KTT → CHT | Full static | Locked RPC, owner/handler/action/reason | Parent/details non-atomic; dual source model |
| MR → PO → schedule → WMS | Full static | Namespaced permissions/RPCs đang hình thành | Direct legacy paths, target-only transitions, partial sync |
| Internal transfer | Full static | Source/target stock atomic with locks | Decimal truncate; downstream receipt after commit |
| Notifications | Full static | Trigger + delivery log + inactive endpoint handling | No durable outbox/idempotency/retry |
| Legacy → new permission | Full static | Rollout flags/audit/health | Client fallback diverges; readiness weak |
| Payment | Full static | Some service guards | Status/accounting/recovery/BOQ split |
| Expense | Full static | Phase4 RLS namespace | CRUD only; optimistic state error behavior |
| Contract variation | Full static | BOQ apply in one RPC | Approve from draft/edit-only possible |
| Quality | Full static | UI policy/tests | Backend actor mismatch; arbitrary direct transition |
| Safety | Full static | Audit trigger | Assignee can set arbitrary status; multi-write partial |
| Documents | Partial static/runtime pending | Metadata/storage separation | False success, non-atomic delete, missing reproducible migration |

## Daily Log

Target flow:

~~~mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Submitted: member + submit + assigned KTT
    Rejected --> Submitted: owner resubmit
    Submitted --> Verified: assigned KTT + verify
    Submitted --> Rejected: assigned handler + return reason
    Verified --> Rejected: authorized return
    Verified --> Approved: assigned CHT + approve
~~~

Latest transition RPC locks row, validates current state, owner, handler and namespaced action, requires rejection reason and guard-context updates. Direct workflow-field update is blocked.

Data save is weaker: <code>projectService.ts:325-357</code> upserts parent, then <code>dailyLogDetailService.ts:50-101</code> runs four parallel delete-then-insert replacements. A failure can leave new parent with missing/mixed details. Normalized contribution services exist but UI still uses legacy JSON snapshot/ID metadata, creating a dual-model reconciliation risk.

## Material Request → PO → WMS

~~~mermaid
flowchart LR
    MR[Material Request] --> PO[Purchase Order]
    PO --> DS[Delivery schedule/statement]
    DS --> TX[WMS transaction]
    TX -->|process status| STOCK[(Stock)]
    TX -->|second RPC/client sync| BATCH[Fulfillment batch]
    BATCH --> PO2[PO receipt/status]
    BATCH --> MR2[MR receipt/status]
~~~

Confirmed gaps:

- Legacy AppContext path still directly updates requests; request guard/state matrix not complete.
- PO RPC derives permission from target state but does not uniformly validate current state/assigned handler.
- Latest PO direct workflow guard may conflict with receipt synchronization paths that update PO without transition context; runtime verification required.
- Supplier delivery record commits before WMS drafts; WMS creation loops per warehouse then links delivery lines.
- Site direct purchase inserts transaction then links it separately.
- WMS stock/status commits before fulfillment/PO/MR sync.

All downstream syncs need either one orchestration transaction or durable idempotent outbox + reconciliation.

## Internal transfer and WMS

Core RPC at <code>20260713005814_phase4_erp_permission_surface.sql:720-980</code> locks transaction/items, validates action and available stock, then moves source/target in one transaction. Positive control.

Regression: <code>v_qty integer</code> and numeric-to-integer casts truncate decimal quantities. This can silently alter real stock. Fix must restore numeric throughout and test source, target, reservations and ledger.

## Payment

<code>paymentCertificateService.ts:385-573</code> direct-updates certificate status, then handles recovery, BOQ lock and cash transaction separately. <code>projectService.ts:1350-1413</code> can mark schedule paid before creating the transaction. State guard does not fully enforce draft → submitted → approved → paid.

Target is a transactional posting command with:

- explicit from/to matrix;
- locked row/version;
- server-bound actor/scope;
- idempotency key;
- accounting entries and reversal;
- immutable audit record.

## Contract

Variation approve RPC updates BOQ atomically, but <code>20260518044750_contract_boq_workspace.sql:152-171</code> only blocks approved/cancelled and does not require submitted or explicit approve permission. An edit-capable caller may approve from draft. Broader table RLS is also unsafe; see SEC-003.

## Quality

UI checks project-scoped permission, while Phase0 latest write policies observed allow only DA/SETTINGS module admin. Service directly updates target statuses with incomplete transition checks. Result: a legitimate project approver may be denied while a broad module admin may jump states. Needs a namespaced project-scoped RPC/matrix.

## Safety

Parent/items/checklist saves are client multi-step. <code>safetyService.ts</code> status update lacks strict from/to/action map; assignee/legacy manage predicate can set arbitrary status. Safety KPI also uses capped lists. Compliance records require transactional commands, immutable evidence and explicit close/reopen authority.

## Documents

Upload can succeed in Storage and fail metadata insert; service returns null, but UI may still report batch success. Delete performs Storage then DB and ignores both errors. <code>project-files</code>/<code>project_documents</code> creation is not reproducible from migrations found. Use per-file typed results, tombstone/cleanup queue or server command, and never claim success without durable metadata state.

## Notifications

Current flow has in-app insert, DB trigger, pg_net call, Edge send and delivery row. There is no unique <code>(notification_id, subscription_id, channel)</code>, deterministic event key, automatic retry/backoff or dead-letter queue. Trigger silently skips if Vault secrets missing. Browser tag may collapse duplicates visually, but delivery semantics remain at-least-once/best-effort.

## Findings

| ID | Vấn đề | Severity | Status |
|---|---|---:|---|
| WF-001 | WMS decimal quantity truncated | P1 | Confirmed |
| WF-002 | Stock commit và fulfillment/PO/MR sync không atomic | P1 | Confirmed |
| WF-003 | MR/PO transitions/direct paths thiếu state guard | P1 | Confirmed |
| WF-004 | Supplier delivery/site purchase → WMS partial | P1 | Confirmed |
| WF-005 | Daily Log parent/detail replacement partial | P1 | Confirmed |
| WF-006 | Payment side effects split | P1 | Confirmed |
| WF-007 | Contract variation approve precondition/auth gap | P1 | Confirmed |
| WF-008 | Quality permission/state mismatch | P1 | Confirmed |
| WF-009 | Safety multi-step/arbitrary transition | P1 | Confirmed |
| WF-010 | Documents false success/non-atomic | P1 | Confirmed |
| WF-011 | Notification lacks idempotency/durable retry | P2 | Confirmed |
| WF-012 | Daily Log dual source model | P2 | Confirmed |

Full records ở <code>10-issue-register.md</code>.

## Business-owner confirmations

- Chính thức hóa transition table, actor và reason cho MR, PO, Payment, Contract, Quality, Safety.
- Quy tắc KTT/CHT delegation, return sau verified và resubmit.
- Partial receipt/over-receipt/variance tolerance và source of truth giữa Stock, Batch, PO, MR.
- Decimal precision theo unit/material.
- Accounting posting/reversal and period lock.
- Document/safety evidence retention và quyền delete/reopen.
- Notification SLA, duplicate tolerance và escalation channel.
