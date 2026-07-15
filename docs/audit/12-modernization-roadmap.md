# 12. Modernization roadmap

## Safe ordering

~~~mermaid
flowchart LR
    C[Immediate containment] --> Q[Quick wins]
    Q --> P1[Phase 1 foundations]
    P1 --> P2[Phase 2 domain boundaries]
    P2 --> P3[Phase 3 security/integrity]
    P3 --> P4[Phase 4 performance/observability]
    P4 --> P5[Phase 5 modernization]
~~~

Do not flip legacy permissions or restructure domains before live policy inventory, reproducible database and persona tests. P0 containment is the only exception and still needs minimal live catalog/impact verification.

## Immediate containment — P0

### Mục tiêu

Stop any live dynamic-SQL RLS bypass and anonymous HR/payroll exposure without broadening the incident.

### Phạm vi

- SEC-001 live proacl/function verification; revoke/drop generic executors.
- SEC-002 live HR policy/grant verification; revoke anon and narrow critical public policies.
- Verify SEC-005 signup/trigger because it becomes P0 if active.
- Preserve read-only evidence, access logs and current catalog before mutation.
- Security/privacy incident assessment and secret rotation decision if exposure confirmed.

### Dependency

Named incident/change owner, read-only production catalog access, backup/restore evidence, affected application-owner confirmation and maintenance/rollback window.

### Acceptance criteria

- anon cannot read/write HR/payroll tables.
- ordinary JWT cannot call generic SQL executors.
- no application callsite depends on removed RPCs.
- active HR/admin flows pass the approved minimum matrix.
- access review/incident decision documented.

### Test strategy

Catalog assertions plus non-destructive persona REST/RPC tests; isolated clone tests for side-effect payloads; targeted HR smoke tests.

### Rollback strategy

Do not restore unsafe broad grants. Roll back functional breakage with a narrowly scoped replacement view/RPC/policy for the approved actor, under time-bound flag and logging.

### Rủi ro

Unknown clients may rely on unsafe RPC/policies; migration drift means source may not equal live. Privacy incident handling must avoid destroying evidence.

### Ngoài phạm vi

Architecture refactor, performance tuning, full permission cutoff and broad dependency upgrades.

## Quick wins

### Mục tiêu

Reduce exploitable edges and improve feedback with small, reviewable changes after P0 control.

### Phạm vi

- Check is_active in create-user/reset-password.
- Require JWT actor for every AI action.
- Escape/DOM-build print content.
- Fix explicit typecheck/lint scripts and create CI skeleton.
- Debounce/cancel high-frequency search.
- Correct document per-file success/error reporting.
- Add bundle budgets and env/README contract.
- Restore WMS numeric type only with reconciliation/test plan.

### Dependency

P0 containment state known; owners for Auth/WMS/Documents; current tests green.

### Acceptance criteria

Each item has one issue ID, owner, focused test and no unrelated refactor. No production rollout without staging/UAT where behavior changes.

### Test strategy

Unit/regression tests, targeted Edge/local integration, XSS payload tests, decimal transaction tests and build budgets.

### Rollback strategy

Feature-level revert/flag; numeric change rollback only with stock reconciliation, never blind code revert after new decimal writes.

### Rủi ro

“Small” security changes can reveal hidden legacy users; WMS numeric history may already be inconsistent.

### Ngoài phạm vi

Full state-machine or data-access-layer migration.

## Phase 1 — Foundation and quality gates

### Mục tiêu

Make repository, database and releases reproducible before deeper change.

### Phạm vi

- Canonical migration baseline/checksum map and clean replay.
- Versioned Supabase local config/toolchain and masked seed.
- CI: lockfile install, typecheck, ESLint, unit, build, DB reset/lint, SQL persona tests.
- Playwright critical smoke.
- Release manifest, staging/UAT flow, backup/restore and rollback drill.
- Baseline telemetry/correlation ID.

### Dependency

P0 controlled; cloud schema snapshot approved; CI infrastructure and staging project available.

### Acceptance criteria

- Empty DB builds current schema deterministically.
- Migration list/schema diff matches approved live baseline.
- PR cannot merge on failed type/unit/RLS/build/E2E.
- One restore and one staged migration rehearsal meet provisional RPO/RTO.

### Test strategy

Full CI on clean environment; migration forward/replay; persona matrix; browser auth/WMS/project smoke; restore drill.

### Rollback strategy

Immutable artifacts, restore point, expand/contract migration and documented compensating migration. CI rollout can be non-blocking first, then required.

### Rủi ro

History normalization is high-risk; existing SQL tests may assume live-only objects/data.

### Ngoài phạm vi

God-context split and broad domain rewrite.

## Phase 2 — Architecture and domain normalization

### Mục tiêu

Create feature boundaries and one query/command path for changed domains.

### Phạm vi

- AuthGate and permission state machine.
- Feature folders/data access for WMS, Daily Log, material and documents first.
- Scoped query cache, typed result/error contract, realtime coordinator.
- Boundary lint blocking new direct UI→Supabase calls.
- Incremental split of AppContext and largest pages/services.
- Canonical Daily Log contribution/source model.

### Dependency

Phase 1 gates/telemetry; stable APIs and business owners for selected slices.

### Acceptance criteria

- Migrated features have no direct UI DB calls.
- Queries keyed by scope/filter/page and targeted invalidation.
- Auth missing/inactive/error fails closed.
- Daily Log has one source of truth with parity/backfill report.
- No regression in critical browser flows.

### Test strategy

Characterization tests before extraction, contract tests, React Profiler/HAR comparison and dual-read parity during cutover.

### Rollback strategy

Per-feature facade/flag; old read path retained read-only during observation; reversible routing, not dual writes.

### Rủi ro

Hidden AppContext consumers and stale-cache behavior; avoid simultaneous UI redesign.

### Ngoài phạm vi

Microservices or framework replacement.

## Phase 3 — Security and data-integrity hardening

### Mục tiêu

Unify action/scope enforcement and move critical transitions into atomic commands.

### Phạm vi

- HR, contract, users and storage policy matrices.
- AI per-tool permissions/scopes; remove body identity and service-role overreach.
- Active session/revocation and safe Auth provisioning.
- Membership-only project policy and controlled legacy cutoff.
- Transactional state machines for MR/PO/Payment/Contract/Quality/Safety/Documents.
- WMS numeric reconciliation and fulfillment outbox.
- Harden SECURITY DEFINER ACL/search path.

### Dependency

Phase 1 persona tests and Phase 2 facades; business-approved state/role/scope matrix; staging production-like data.

### Acceptance criteria

- Every critical action has one server command and negative persona tests.
- No true/public policy on sensitive rows unless explicitly approved.
- Invalid transition/direct patch denied.
- Partial failure rolls back or outbox converges.
- Legacy fallback disabled with measured zero unauthorized/denied surprises for observation window.

### Test strategy

Direct REST/RPC/Storage persona matrix, exhaustive state edges, concurrency/failure injection, AI tool scope tests and reconciliation reports.

### Rollback strategy

Progressive enforcement flags per domain, shadow/audit-only mode first, scoped compatibility grants with expiry. Never restore global true policy.

### Rủi ro

Highest business disruption risk; permission data quality and undocumented exceptions can block users.

### Ngoài phạm vi

Performance indexes not supported by measured plans.

## Phase 4 — Performance and observability

### Mục tiêu

Meet measurable UX/query/reliability budgets using runtime evidence.

### Phạm vi

- Browser Web Vitals, render/HAR baselines and route bundle budgets.
- Screen projections/pagination/server aggregates.
- Search cancellation and targeted cache invalidation.
- Realtime scoped channels and event metrics.
- pg_stat_statements, plans, FK/index tuning, locks/pool/bloat dashboards.
- Outbox/push retries, dead-letter, workflow reconciliation alerts.
- Safety KPI aggregation and lazy storage URLs.

### Dependency

Stable Phase 2 query/command boundaries and Phase 3 security; production-like volume and telemetry.

### Acceptance criteria

Business-approved p75 UX/API budgets, top-query owners, zero capped-KPI error, deterministic channel cleanup and monitored retry/dead-letter.

### Test strategy

Load/profile on staging clone, regression budgets in CI, canary metrics and before/after query plans.

### Rollback strategy

Feature flags for query/cache changes; concurrent indexes dropped only after evidence; retain old projection during canary.

### Rủi ro

Cache/scoping can return stale/wrong data; indexes add write/storage cost; synthetic data may not mirror workload.

### Ngoài phạm vi

Premature distributed cache or database replacement.

## Phase 5 — Long-term modernization

### Mục tiêu

Retire compatibility debt and scale organizational ownership only after evidence.

### Phạm vi

- Remove legacy permission arrays/fallback after stable cutoff.
- Remove dead code/dual models after runtime coverage.
- Version public APIs/events and establish domain ownership.
- Evaluate server/BFF or service extraction only for proven isolation/scale/compliance needs.
- Formal data retention, archival, partitioning and DR maturity.

### Dependency

At least one stable release cycle with Phase 3/4 metrics and owner capacity.

### Acceptance criteria

No legacy authorization source, no unowned critical aggregate, documented API/event contracts, tested retention/DR and reduced change lead time without reliability regression.

### Test strategy

Long-running parity and migration tests, contract compatibility, chaos/DR exercises and operational KPI comparison.

### Rollback strategy

Versioned compatibility adapters and archival snapshots; deprecation windows before physical deletion.

### Rủi ro

Over-engineering and organizational fragmentation if services are split before ownership/need is proven.

### Ngoài phạm vi

Technology replacement for novelty; rewrite without quantified benefit.

## Decision gates

| Gate | Owner | Evidence required |
|---|---|---|
| P0 live containment | Security + DB owner | Catalog, safe persona tests, backup/log evidence |
| Permission cutoff | Security + module owners | Grant backfill, denial telemetry, UAT matrix |
| Workflow state machine | Business owner + engineering | Signed transition/actor/reason table |
| Data reconciliation | Finance/WMS/Project owner | Before/after counts/amounts/stock and exceptions |
| Production promotion | Release owner | Immutable manifest, CI, UAT, rollback/restore proof |
