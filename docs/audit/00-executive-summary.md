# 00. Executive summary

## Overall conclusion

The repository is a capable, actively evolved ERP with meaningful recent security/workflow hardening, route-level lazy loading and 360 passing unit tests. It is not yet safe to treat the current permission/migration state as production-grade evidence.

Overall risk is **High**, with **2 P0, 26 P1, 16 P2 and 1 P3** findings. The first action is not a rewrite: verify and contain two live P0 surfaces, then establish a reproducible database/persona test gate before expanding modules.

Audit-only was preserved. No source, migration, dependency, cloud, deploy or production configuration was changed. Deliverables are only under <code>docs/audit/</code>; the pre-existing untracked <code>.agent/workflows/Agent.md</code> remains untouched.

## Highest-priority issues

| Rank | ID | Severity | Issue | Why now |
|---:|---|---:|---|---|
| 1 | SEC-001 | P0 | Authenticated generic SQL executors run SECURITY DEFINER | Direct RLS bypass; May-21 cloud capture + no later revoke |
| 2 | SEC-002 | P0 | HR/payroll PII and writes exposed to anon/public | Privacy/integrity risk; live verification and incident decision urgent |
| 3 | SEC-003 | P1 | Contract headers/catalogs/BOQ/resources mutable/readable too broadly | Financial/contract tampering across scope |
| 4 | SEC-004 | P1 | AI service-role confused deputy | AI-only user can reach HR/finance/WMS/project data |
| 5 | SEC-005 | P1/P0 conditional | Auth metadata can bootstrap ADMIN/profile grants | P0 if public signup + trigger are active |
| 6 | SEC-006 | P1 | Inactive admin JWT can create users/reset passwords | Offboarding/session revocation gap |
| 7 | SEC-008 | P1 | Legacy permission/project scope remains fail-open | DA legacy users can see projects outside membership |
| 8 | DB-001 | P1 | Migration history/schema drift | Cannot prove which hardening is live or rebuild safely |
| 9 | WF-001 | P1 | WMS latest RPC truncates decimal quantity | Direct inventory corruption for kg/m³/m units |
| 10 | SEC-009 | P1 | Storage policies cross resource scope | Workflow/contract/check-in disclosure or evidence mutation |

Next tier: vulnerable file/router/XML dependencies (SEC-010), non-atomic WMS/MR/PO synchronization (WF-002/003), payment/document/safety partial writes and missing CI/RLS integration gates.

## Coverage achieved

- Repository/instructions/config inventory complete.
- 528 TS/TSX files in static graph; 2.063 import edges; no static cycles found.
- 516 app TS/TSX files, about 229.420 LOC, pattern-scanned; critical paths deeply traced.
- 234 migrations/58.710 SQL LOC inventoried and risk-scanned; permission/project/HR/contract/WMS/AI/storage/workflow migrations deeply traced.
- All four Edge Function directories and shared AI catalog reviewed.
- 66 test files executed: 360/360 pass.
- Fresh production build pass; large-chunk warnings measured.
- Production and full npm security audits run.
- Required workflows traced end-to-end, with runtime limitations recorded.

Detailed coverage is in <code>03-module-coverage-matrix.md</code>.

## Quality-gate snapshot

| Gate | Result |
|---|---|
| Unit tests | Pass, 360 tests |
| Production build | Pass |
| npm lint | Pass, but script is only TypeScript compiler |
| npm typecheck | Missing script |
| Production dependency audit | 9 vulnerabilities: 1 critical, 7 high, 1 moderate |
| SQL/RLS smoke | Not run; no local DB |
| E2E | No tests/config |
| CI | None found |

## What cannot be concluded

- Current live migrations, policies, function ACL/owners, storage ACL and exposed schemas.
- Auth signup/trigger, Edge verify_jwt and deployed function revisions.
- Row counts, slow queries, plans, locks, index usage, bloat and pool pressure.
- Web Vitals, render counts, real network bytes and mobile performance.
- Backup restore success, RPO/RTO, staging parity and rollback readiness.
- Whether historical P0 surfaces have already been changed out-of-band.

The May-21 schema inventory is strong historical evidence but stale; the same repository documents substantial migration drift. Live catalog verification must precede precise remediation.

## Recommended target

Keep React/Vite/Supabase and evolve to:

- one fail-closed AuthGate;
- feature-owned query/data-access layers;
- scoped query cache/realtime;
- deny-by-default action + resource scope authorization;
- typed transactional commands for business transitions;
- durable outbox/reconciliation for cross-domain side effects;
- resource-scoped immutable Storage;
- reproducible migrations and persona tests in CI;
- release/correlation/health telemetry.

See <code>11-target-architecture.md</code>.

## Safest implementation order

1. Minimal live verification and P0 containment.
2. Low-risk auth/AI/XSS/feedback quick wins.
3. Canonical DB baseline, local replay, CI and persona tests.
4. AuthGate/data-access boundaries and one canonical Daily Log model.
5. HR/contract/storage/AI/project permission hardening and legacy cutoff.
6. Atomic MR/PO/WMS/Payment/Contract/Quality/Safety/Documents commands.
7. Runtime-guided performance/index/realtime work and observability.
8. Retire legacy/dual models only after parity and observation.

See <code>12-modernization-roadmap.md</code>.

## Business-owner decisions required

1. Employee/manager/HR access by field for salary, contracts, leave, KPI and directory.
2. Project membership versus DA module-wide visibility.
3. Contract/BOQ/catalog scope and edit/approve separation.
4. Formal from→to/actor/reason matrix for MR, PO, Payment, Contract, Quality and Safety.
5. KTT/CHT delegation, return and resubmission rules.
6. Decimal precision and reconciliation tolerance per material unit.
7. Source of truth/SLA when Stock, fulfillment, PO and MR diverge.
8. Payment posting, reversal and period locking.
9. Document/check-in/safety evidence retention and deletion authority.
10. Notification delivery SLA, retry and duplicate tolerance.

## Report map

- <code>01-system-context.md</code>: actors, boundaries, data flow.
- <code>02-current-architecture.md</code>: current topology/coupling.
- <code>03-module-coverage-matrix.md</code>: actual coverage/gaps.
- <code>04-frontend-audit.md</code>: React/state/network/realtime/bundle.
- <code>05-database-supabase-audit.md</code>: schema/migrations/RLS/RPC/storage.
- <code>06-security-audit.md</code>: threat/auth/authorization/dependencies/XSS.
- <code>07-performance-audit.md</code>: bundle/query/render/runtime profiling.
- <code>08-workflow-data-integrity-audit.md</code>: required flow traces.
- <code>09-testing-devops-observability.md</code>: gates/release/telemetry.
- <code>10-issue-register.md</code>: all 45 field-complete findings.
- <code>11-target-architecture.md</code>: evolutionary target.
- <code>12-modernization-roadmap.md</code>: phased safe plan.
- <code>13-quick-wins.md</code>: candidates only; nothing auto-implemented.

## Reference standard

The remediation direction follows Supabase guidance that exposed data requires RLS and that service-role credentials bypass RLS and must remain server-side: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api).
