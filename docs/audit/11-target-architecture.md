# 11. Target architecture

## Mục tiêu

Kiến trúc đích không phải rewrite. Đây là evolution theo vertical slice, giữ React/Vite/Supabase nhưng làm rõ:

1. Auth/profile/grants fail closed.
2. Feature/domain ownership.
3. Query và command tách biệt.
4. Business transitions atomic ở server.
5. RLS/action/scope là một policy model.
6. Outbox/reconciliation cho cross-domain side effects.
7. Release/schema/telemetry có thể chứng minh.

## Logical architecture

~~~mermaid
flowchart TB
    subgraph Client[React PWA]
      AG[AuthGate]
      FS[Feature slices]
      QC[Scoped query cache]
      RC[Realtime coordinator]
      UI[UI/presentation]
      UI --> FS
      FS --> QC
      FS --> RC
      AG --> FS
    end

    subgraph API[Supabase API boundary]
      Q[Typed read projections/RPC]
      C[Transactional command RPC]
      EF[Edge integrations]
      ST[Scoped Storage]
    end

    subgraph Data[Postgres]
      RLS[RLS + scoped grants]
      SM[State machines + locks]
      OUT[Outbox + reconciliation]
      AUD[Immutable audit]
      OBS[Health/metrics views]
    end

    QC --> Q
    FS --> C
    RC --> Q
    FS --> EF
    FS --> ST
    Q --> RLS
    C --> SM
    SM --> RLS
    SM --> OUT
    SM --> AUD
    EF --> C
    OUT --> EF
    OBS --> Data
~~~

## Frontend target

Suggested incremental layout:

~~~text
src/
  app/
    auth/
    routing/
    providers/
    telemetry/
  features/
    inventory/
      api/
      commands/
      queries/
      model/
      ui/
      tests/
    project/
    material/
    payment/
    contract/
    quality/
    safety/
    documents/
  shared/
    ui/
    lib/
    types/
~~~

The repository does not need to move at once. A new/changed use case adopts the boundary first; legacy imports are blocked per migrated feature.

### AuthGate

One source of truth:

~~~mermaid
stateDiagram-v2
    [*] --> LoadingSession
    LoadingSession --> SignedOut: no/invalid session
    LoadingSession --> LoadingProfile: verified JWT
    LoadingProfile --> Denied: no profile or inactive
    LoadingProfile --> LoadingGrants: active profile
    LoadingGrants --> Denied: permission transport/schema error
    LoadingGrants --> Ready: grants + rollout state loaded
    Ready --> SignedOut: session revoked
~~~

Mock mode must require an explicit development flag and be excluded/fail build in production.

### Query model

- Cache keys include tenant/company if introduced, project/site, filters, page and projection version.
- Page screens request only needed columns/rows.
- Mutations invalidate/patch exact entity keys.
- Realtime updates the same scoped cache; route changes deterministically release channels.
- Every request exposes loading/error/retry, not silent empty.

### Command model

UI sends typed business intent, not arbitrary patch:

- submitDailyLog, verifyDailyLog, approveDailyLog;
- transitionMaterialRequest, transitionPurchaseOrder;
- completeWarehouseTransaction;
- postPaymentCertificate, reversePayment;
- approveVariation;
- transitionQualityChecklist, transitionSafetyIssue;
- attachDocument, deleteDocument.

Each command locks aggregate, validates current state, actor, action, scope and input, writes all same-domain rows, audit and outbox in one transaction.

## Authorization target

~~~mermaid
flowchart LR
    JWT[auth.uid] --> PROF[active profile]
    PROF --> ACT[permission action]
    ACT --> SCOPE[global/project/site/warehouse/department/resource]
    SCOPE --> ROW[RLS/command row]
    ROW --> ALLOW[Allow]
    PROF -. inactive/missing .-> DENY[Deny]
    ACT -. missing/error .-> DENY
    SCOPE -. mismatch .-> DENY
~~~

Rules:

- Deny by default; null/undefined is not allow.
- Permission registry is metadata; policy/RPC enforcement is mandatory.
- Every SECURITY DEFINER command binds actor from session, has empty search path and qualified objects.
- Service role only in minimal Edge integrations; per-tool/action scope before any call.
- Column-safe views for directory/reporting instead of broad table select.
- Legacy projection is compatibility output, never authorization source after cutover.

## Database target

### Schemas

- exposed read/command facade kept minimal;
- private implementation functions in non-exposed schema;
- every function ACL explicit;
- views use invoker semantics where appropriate;
- RLS expected matrix versioned and tested.

### Aggregate transactions

| Aggregate | Transaction boundary |
|---|---|
| Daily Log | Header + details + transition + audit |
| Material fulfillment | MR/PO/batch/transaction intent and outbox |
| WMS | Transaction + stock + ledger; numeric precision |
| Payment | Certificate/schedule + accounting postings + recovery/lock |
| Contract variation | State + BOQ application + audit |
| Quality/Safety | Parent + items + transition + evidence |
| Documents | Metadata state + object operation workflow/cleanup |

### Cross-domain consistency

When a single DB transaction is undesirable across domain ownership, use:

1. source aggregate transaction;
2. deterministic outbox event;
3. idempotent consumer;
4. attempt/status/dead-letter;
5. reconciliation query/job;
6. operational alert and replay.

Do not use “fire a second request from browser” as the only consistency mechanism.

## Storage target

Object key includes stable resource scope, for example company/project/document/version. Policies derive actor access from parent metadata. Evidence objects are immutable; replacement creates a new version. Upload flow validates size, extension, MIME and content signature server-side. Metadata tracks pending/ready/failed/deleted and cleanup attempts.

## AI target

- Deny-by-default tool registry.
- Tool → permission action → allowed scopes → column projection.
- Actor/source must be verified JWT for every action.
- RPC accepts actor scope only from auth context, not body.
- No generic dynamic SQL executors.
- PII/finance data redaction and prompt/data minimization.
- Tool access audit with actor, scope, parameters hash, rows/fields class and result.

## Testing and operations target

Release manifest binds:

- Git commit/build version;
- migration versions/checksums;
- Edge Function revisions;
- permission/feature flags;
- dependency lockfile;
- test evidence.

CI builds an ephemeral database from empty state, runs RLS/RPC/persona tests, unit/build/E2E, then promotes immutable artifacts through staging/UAT. Production emits frontend/API/RPC/workflow/outbox/DB metrics with correlation IDs and SLOs.

## Target quality attributes

| Attribute | Observable acceptance |
|---|---|
| Security | Ordinary user cannot access another scope by direct REST/RPC/Storage |
| Integrity | Invalid transition and partial failure leave aggregate unchanged or recover deterministically |
| Performance | Screen requests are scoped/paginated; budgets measured in CI/runtime |
| Maintainability | UI cannot import Supabase in migrated features; domain commands have owners/tests |
| Operability | Release, schema, flags and errors correlate by one release/correlation ID |
| Recoverability | Restore/replay/rollback drill meets business-approved RPO/RTO |

## Explicit non-goals

- No framework rewrite.
- No microservice split before domain ownership and telemetry prove need.
- No broad dependency upgrade.
- No premature index creation without workload plans.
- No removal of legacy permission/data fields before backfill, parity tests and observation window.
