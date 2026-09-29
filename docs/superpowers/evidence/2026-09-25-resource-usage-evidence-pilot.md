# Resource usage evidence — Cloud test-branch pilot

Environment: Supabase Cloud branch `baseline-vioo-git` (`oymkraihhqahqvzahhtx`),
synthetic project `DL-WBS-PILOT-20260925`, site `null`. Root `.env` was used only
at runtime; no local Supabase or Docker. Main/RICO and parallel Project V2 /
Procurement workspace were not changed. This is technical pilot evidence, not
business signoff or permission to activate production.

## Release source and deployment

| Migration | SHA-256 | Cloud history |
|---|---|---|
| `20260925160000_resource_evidence_permission.sql` | `7c167dd80cdd9352ca33a5709d6d6eafd1832d61b5728f26cda1b8917aba2871` | applied |
| `20260925161000_verified_resource_usage_evidence.sql` | `b8836d2a6415a2e92ce6ad1f51b203511558ecbfffb815098c69d961d40728e0` | applied |
| `20260926022433_secure_daily_log_physical_resources.sql` | `113b855e3293dceebcb3276dbd6153989823eb4c500df6e0c0cba352b1eb8412` | applied |

The first two migrations were installed in one transaction after the existing Plan 1
head `20260925153000`. The third moved the physical Daily Log implementation
to `app_private` and left a public `SECURITY INVOKER` wrapper. A rollback smoke
passed before deployment, and the post-deployment authenticated pilot passed.
Cloud catalog inspection confirmed the private implementation is definer and
the public wrapper is invoker. The permission binding
was `audit_only` after both pilot runs; active test grants = 0. Operator source
hash: `dfb8cdecf6db5da312ddd0c59cde976dda92c2a9befa9a5d52473f0e85584a70`.

## Scope measurements

For verified member-contribution summaries from 2026-09-25 through 2026-10-18:
47 normalized lines (24 labor, 23 machine); 24 catalog and 23 manual provider
lines; missing lineage = 0; missing provider = 0; duplicate current source
keys = 0; unknown legacy count = 0. The rollback smoke inserted one priced
semantics-1 row and confirmed `unknownLegacyCount = 1` without including its
price or interpreting its physical quantity.

The short-lived authenticated QS pilot on 2026-10-18 returned 2 current rows,
2 providers, 40 labor hours and 12 machine hours. RPC round trip was 124 ms in
the recorded run. An ungranted persona and the same QS querying a different
project both received `RESOURCE_EVIDENCE_SCOPE_DENIED`. The JSON scan found no
price/money key, and `project_transactions` count before/after was unchanged.
The pilot script used `finally` to pause the binding and deactivate its grant.
The same pilot passed again after the physical-RPC security migration and
exact project/site grant preflight hardening (192 ms in the final run).

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for the scoped labor candidate query
used `idx_daily_logs_summary_source_type` and `idx_daily_log_labor_log` index
scans; 1 row, 4 shared cache hits, 0 shared reads, 0.145 ms execution. This is
the small synthetic cohort's query-plan evidence, not a production latency SLO.

## Browser walkthrough

The browser harness used a real authenticated QS session and the production
React panel/service against the Cloud branch. All 3 widths passed, including
provider → date → area → WBS → detail → original Daily Log link and no-money UI
scan. A fourth browser test verified that an ungranted user sees a denial and
unknown KPIs rather than physical rows or fake zeroes. The 768px table includes
a horizontal-scroll hint; 390px uses cards. The existing Plan 1 full ERP-shell
deep-link regression also passed after the new RLS policy was installed.

- [Desktop 1440px](resource-evidence-1440.png)
- [Tablet 768px](resource-evidence-768.png)
- [Mobile 390px](resource-evidence-390.png)

The Cloud smoke also verified inactive provider snapshot preservation,
manual-provider key normalization, superseded-history display without double
counting, direct-table deny, exact project/site permission and legacy separation.
No source row was deleted or backfilled. Tests used synthetic records and do
not replace real business-user acceptance.

Final verification: 2,519 unit tests passed (2 pre-existing skips), TypeScript
typecheck passed, Vite production build passed, migration baseline check passed,
Cloud deployed smoke passed after the pilot cleanup, and 4/4 evidence browser
tests plus the existing Plan 1 ERP-shell regression passed. After the final
smoke: binding `audit_only`, PBAC fallback disabled, active evidence grants 0,
all three migration history rows present. The smoke is repeatable after a prior pilot:
it reuses the same scoped inactive test member inside its rollback transaction.
