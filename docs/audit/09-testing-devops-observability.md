# 09. Testing, DevOps and observability

## Quality-gate results

| Command/check | Result | Meaning |
|---|---|---|
| <code>npm run typecheck</code> | Fail: missing script | Required gate không tồn tại |
| <code>npm run lint</code> | Pass | Script chỉ chạy <code>tsc</code>, không phải ESLint |
| <code>npm run test</code> | Pass | 66 files, 360 tests |
| Fresh production build | Pass | Vite 6.4.3; large chunk warnings |
| <code>npm audit --omit=dev</code> | 9 vulnerabilities | 1 critical, 7 high, 1 moderate |
| Full <code>npm audit</code> | 15 vulnerabilities | 1 critical, 9 high, 4 moderate, 1 low |
| Static import cycle scan | 0 cycles | 528 TS/TSX, 2.063 edges; static literal scope |
| Supabase status/db lint/migration local | Blocked | Docker daemon/local Postgres unavailable |

## Test inventory

- 66 Vitest files; 360 tests pass.
- Strong clusters: permission registry/routes, project services, Daily Log logic, MR/PO helpers, WMS permission, safety, cash/finance, document trace, chat, PWA.
- 26 SQL smoke scripts exist under <code>supabase/tests</code>.
- Playwright dependency installed, nhưng không có config hay E2E specs.
- Không có automated Edge Function integration tests.
- Không có current coverage report/threshold.

Unit tests chủ yếu mock Supabase. Chúng chứng minh client logic nhưng không chứng minh live RLS, grants, SECURITY DEFINER behavior, transaction rollback, concurrency hay migration replay.

## Test gaps

1. Persona-based RLS negative tests cho anon/employee/project A vs B/domain admin.
2. Direct RPC/REST tests không qua UI.
3. Dynamic SQL executor denial and function ACL tests.
4. Auth signup metadata/inactive session/Edge verify_jwt tests.
5. State-machine matrix tests cho MR, PO, Payment, Contract, Quality, Safety.
6. Failure injection/atomic rollback cho Daily Log, WMS receipt, delivery, documents.
7. Decimal quantity and concurrent business-code tests.
8. Storage cross-scope/MIME/overwrite/delete tests.
9. Web Push idempotency/retry/dead-letter tests.
10. Browser E2E cho auth, core project, WMS transfer, mobile/offline/PWA.

## CI/CD

Không có <code>.github/workflows</code> hoặc cấu hình CI khác trong repo. Không có Supabase <code>config.toml</code>, nên local stack/replay contract không được versioned. Hai npm smoke scripts dùng <code>--linked</code>, không phù hợp làm PR gate an toàn.

Current inferred deployment:

~~~mermaid
flowchart LR
    DEV[Developer] --> GIT[main/Git]
    GIT --> V[Vercel build/deploy]
    DEV -. direct query/manual repair .-> CLOUD[(Supabase Cloud)]
    CLOUD -. no reproducible gate .-> PROD[Production data]
~~~

Target promotion:

~~~mermaid
flowchart LR
    PR[Pull request] --> CI[Lockfile install + type/lint/unit/build]
    CI --> DB[Ephemeral Supabase reset + lint + SQL/RLS tests]
    DB --> E2E[Playwright critical paths]
    E2E --> STG[Staging deploy]
    STG --> UAT[Business UAT + migration rehearsal]
    UAT --> AP[Approval]
    AP --> PROD[Production]
    PROD --> OBS[Health/SLO/audit]
~~~

## Release and rollback

- package version là <code>0.0.0</code>.
- README/roadmap stale; không có tracked changelog/release contract.
- Có release notice feature nhưng không thay thế technical versioning.
- Không có documented staging parity, backup/restore drill, migration rollback decision tree hay feature kill-switch runbook.
- Feature flags tồn tại ở app code nhưng không phải centralized rollout/audit system.

DB rollback không nên mặc định “down migration”. Target:

1. preflight backup/restore proof;
2. expand/contract compatible migrations;
3. deploy code compatible cả old/new schema;
4. backfill + verify;
5. cutover flag;
6. cleanup sau observation window;
7. compensating migration nếu rollback.

## Observability

Current:

- <code>logApiError</code> và performance trace chủ yếu console/localStorage.
- Không có error aggregation/Sentry-like sink, distributed correlation ID hay route/RPC metrics.
- Audit service có path không check returned Supabase error, nên insert fail có thể im lặng.
- Web Push có deliveries table nhưng không có retry worker/SLO.
- Không có health/readiness endpoint, synthetic critical-flow check, DB/query dashboards hoặc alerts được versioned.

Target minimum:

| Signal | Dimensions | Alert/use |
|---|---|---|
| Frontend errors | release, route, user-safe ID, correlation | Regression/error budget |
| API/RPC | function/table, status, latency, rows | Auth failure, slow/error rate |
| Workflow | from/to, actor scope, failure stage | Stuck/invalid/partial transitions |
| DB | top query, locks, pool, bloat, replicas | Capacity and contention |
| Push | notification/subscription/status/attempt | Retry/dead-letter/SLA |
| Audit | actor/action/resource/result | Security/compliance |
| Release | commit, migration set, flags | Fast attribution/rollback |

## Findings

| ID | Vấn đề | Severity | Status |
|---|---|---:|---|
| OPS-001 | Không có automated CI/release gate | P1 | Confirmed |
| OPS-002 | Thiếu RLS/RPC/Edge/E2E/failure tests | P1 | Confirmed |
| OPS-003 | typecheck/lint/tsconfig quality contract yếu | P2 | Confirmed |
| OPS-004 | Observability/health/audit error handling thiếu | P2 | Confirmed |
| OPS-005 | Staging/versioning/rollback/release flow không codified | P2 | Confirmed |
| DB-002 | Local DB/migration replay không reproducible | P1 | Confirmed |
| SEC-010 | Production dependency vulnerabilities | P1 | Confirmed |

Field-complete records nằm ở <code>10-issue-register.md</code>.
