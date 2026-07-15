# 13. Quick wins

## Nguyên tắc

Đây là danh sách đề xuất, không phải thay đổi đã triển khai. “Quick win” nghĩa là phạm vi kỹ thuật nhỏ và verification rõ; không có nghĩa được phép bỏ qua staging, owner hoặc rollback. P0 containment được quản lý riêng trong roadmap.

## Candidate list

| Ưu tiên | Issue | Hành động đề xuất | Giá trị | Risk | Effort | Điều kiện trước |
|---:|---|---|---|---|---|---|
| 1 | SEC-006 | Check active profile trong create-user/reset-password; deny/revoke inactive | Chặn privileged stale session | Low | S | Edge revision/staging test |
| 2 | SEC-007 | Remove body actor fallback, require JWT actor mọi AI action | Chặn impersonation path | Low | S | Confirm deployed gateway/callers |
| 3 | SEC-013 | Escape/DOM-build print values; isolate opener | Chặn stored XSS | Low | S | Malicious payload regression |
| 4 | OPS-003 | Add explicit typecheck; rename lint and add focused ESLint rules | Quality gate rõ | Low/Medium | S/M | Triage existing warnings |
| 5 | PERF-003 | Debounce/cancel Payment/Project/Safety search | Giảm request/race | Low | S/M | UX delay agreed |
| 6 | WF-010 | Aggregate per-file upload/delete results; never unconditional success toast | Ngăn false business confirmation | Low | M | Fault tests |
| 7 | FE-002 | Shared error/result component for critical module loads | Phân biệt empty với failure | Low | M | Correlation/error contract |
| 8 | PERF-002 | Lazy Scanner/xlsx/charts/subtabs and enforce bundle budget | Faster mobile routes | Low | M | Fresh bundle baseline |
| 9 | ARC-003 | Update README, env contract and safe local/linked command warnings | Safer onboarding/ops | Low | S | Owner review; no secrets |
| 10 | OPS-001 | CI skeleton for install/type/unit/build without cloud writes | Prevent regressions | Low | M | CI provider |
| 11 | SEC-011 | Current-user projection and on-demand safe directory columns | Reduce PII/egress | Medium | M | Identify directory consumers |
| 12 | FE-001 | AuthGate denies missing/inactive profile and production mock fallback | Close client fail-open | Medium | M | Resolve unlinked legacy users |
| 13 | WF-001 | Restore numeric WMS quantities | Prevent new decimal corruption | Medium | S/M | Live schema + stock reconciliation plan |
| 14 | DB-005 | Replace string-based readiness with explicit expected matrix checks | Prevent false cutover | Low | M | Canonical live schema |
| 15 | WF-011 | Unique delivery attempt key before retry worker | Reduce duplicate push | Medium | M | Existing duplicate cleanup strategy |

## Do first only after live verification

These changes are small in code but high in operational consequence:

- SEC-001 revoke/drop dynamic SQL functions.
- SEC-002 revoke anon HR/payroll policies/grants.
- SEC-005 disable unsafe Auth metadata provisioning.
- WF-001 numeric fix if live data may already be truncated.

They belong to controlled containment/reconciliation, not an opportunistic quick-win deploy.

## Suggested first two PR batches

### Batch A — no schema dependency

- SEC-006 active Edge checks.
- SEC-007 JWT actor.
- SEC-013 print escaping.
- PERF-003 search debounce/cancel.
- WF-010 correct document success/error UI.
- ARC-003 docs/env/runbook.

Acceptance: focused tests, no feature redesign, build/unit pass, staging smoke.

### Batch B — quality gates

- Explicit typecheck and ESLint baseline.
- CI install/type/unit/build.
- Bundle budget report.
- Error/correlation contract skeleton.

Acceptance: pipeline runs read-only/local only, never <code>--linked</code>; existing main build remains deployable.

## Quick-win verification checklist

1. Issue ID and owner recorded.
2. Current behavior captured by failing regression test.
3. No broad dependency upgrade or unrelated refactor.
4. Security/data changes tested with negative persona.
5. Feature flag/rollback documented where behavior may block users.
6. Production metric/log to confirm effect.
7. Business owner informed when status, finance, stock, safety or documents are affected.

## Explicitly not quick wins

- Rebuilding migration history.
- Splitting AppContext/god pages.
- Full permission cutoff.
- MR/PO/Payment/Quality/Safety state-machine migration.
- Outbox/reconciliation architecture.
- Broad RLS/storage rewrite.
- Replacing the frontend framework or moving to microservices.
