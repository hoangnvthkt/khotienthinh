# Task 6 — source-slip-driven daily consolidation

Date: 27/09/2026. Scope: approved Daily Log UX Task 6 and the explicitly approved additive draft-persistence backend. Isolated branch `codex/daily-log-bootstrap-integration`; base `5f73cd008ede2dac9ac3a4ad90df4bee64cc6311`. No root-workspace changes, push, merge, production writes or rollout promotion.

## Delivered behavior

- Persisted/explicit selection, not automatic inclusion of every received slip. Removing a slip changes only summary selection. Unique WBS and physical hours are computed from selected work lines; people/machines are entries by work item, not fabricated unique identities or reporting-completeness counts.
- Two source columns on desktop, one on mobile; current slips collapsed, blockers expanded. Saved comments are distinct from source matching. Work, resources, provider, notes and photographs stay associated with their actual item/slip.
- Copy adjustments require a reason and never mutate the original. A resubmitted source does not overwrite the saved copy or version-qualified notes. Comparison and explicit refresh are separate user actions.
- Unresolved safe decisions can save as private drafts, but cannot submit. Official decision constraints remain unchanged; no unknown becomes zero and two 30% reports do not become 60%.
- Existing-summary metadata saves use a narrow optimistic update, not the legacy detail-table replacement service. Reopening reads the fresh authorized bundle. Metadata/work are separate writes; a partial failure retains local work and the new concurrency token for retry.

## Additive Cloud scope

Only `baseline-vioo-git` (`oymkraihhqahqvzahhtx`), configuration from root `.env`, no local Supabase/Docker. Four CLI-generated migrations were applied separately; already-applied files were never edited:

1. `20260927020541_daily_log_summary_pending_draft_v2.sql`: private RLS-enabled pending storage, authorized bundle read, canonical save/readiness dispatch, unchanged official NOT NULL/reason constraints.
2. `20260927022904_daily_log_summary_source_metadata_snapshot_v2.sql`: capture actual content/issues/photos/author/date only on a new copy or explicit refresh; no historical backfill.
3. `20260927031010_daily_log_summary_missing_unit_draft_guard_v2.sql`: an allocation with partly unknown units remains pending unless explicitly resolved.
4. `20260927032533_daily_log_summary_document_opt_in_v2.sql`: new summary UI explicitly opts into draft semantics when copying older normalized slips. Old callers still use the unchanged legacy producer; old source discriminators and records remain unchanged.

Recorded history advanced 39→40→41→42→43 with each recorded prefix preserved and only the expected suffix applied. Security-advisor identities: 61 before, 61 after, zero new findings. Existing findings were not silently fixed outside scope. Public adapters remain SECURITY INVOKER; private producers preserve canonical actor/Room, scope, cutover and period checks. No price, accrual or transaction fields were added.

## TDD and fresh verification

Behavioral REDs included unresolved official-row persistence, missing saved comments/selection, copy preservation, missing metadata snapshot, partly unknown-unit aggregation, stale metadata on reopen, copied-resource lineage on second save, multi-select closing early, mobile label truncation, cleared percentage becoming zero, and an all-V1 source selection wrongly entering legacy save. Regression tests were observed failing before the corresponding fix. Compatibility fixture initially omitted its scheduled forecast snapshot; the resulting input-validation rejection was corrected in the test, not weakened in production.

Fresh final results:

| Check | Result |
| --- | --- |
| `npm test -- --maxWorkers=2` | 2,480 passed, 2 existing skips; 513 passing files |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0; existing >500 kB chunk warning |
| `npm run check:supabase-migrations` | 137 active / 402 archived |
| `npm run check:supabase-queries` | zero findings/errors/unclassified |
| `run-summary-draft-cloud.mjs --smoke` | all 17 Cloud SQL smokes passed, writes rolled back |
| `summary-draft-auth-smoke.mjs` | three real non-admin Auth accounts: safe pending save/reload, send denial, exact return/resubmit, preserved adjustment, explicit refresh, resolution and pilot shadow-only; baseline counts restored |
| Playwright `summary-cloud-playwright.config.ts` | actual ERP non-admin lifecycle passed; source A return/revise/resubmit and B/C unchanged; original/copy lineage checked; own log/source/receipt cleanup all zero |
| `git diff --check` | clean |

The unconstrained full-suite run earlier timed out in six tests: `customMaterialRequestService.phase3`, `hrmPersonnelWorkbook`, `poDeliveryReadModel`, `projectService.dailyLog` legacy lookup, `remainingSupabaseQueryPolicies`, `costNormImportService`. No unrelated implementation/test-timeout changes were made. Bounded-worker full runs passed; this resource-pressure limitation is recorded, not hidden.

## Visual review and limits

Actual ERP light/dark screenshots at 1440×900, 1024×768, 768×1024, 390×844 and 360×800 were captured. Desktop/tablet/mobile and expanded-slip examples were inspected: flat borders, Inter/token typography, teal actions, responsive action placement and wrapped labels; whole-page horizontal overflow assertions passed. Mobile keyboard behavior and real first-time-user acceptance are not proved by browser emulation.

Scratch evidence is in this plan's git-ignored `.superpowers/sdd/2026-09-26-daily-log-user-centered-ux-revision/` directory (final suite/typecheck/build/Cloud/Auth/ERP logs, advisor logs, `summary-erp-*` and `summary-slips-*` images). Temporary fixtures and five previously orphaned test-only return receipts were removed by validated exact identities; no real account, effective verified history, official progress or transaction was deleted.

Task 7 CHT review/verified reporting and Task 8 whole-flow/keyboard/real-user acceptance remain open. This checkpoint is not whole-UX acceptance or permission to release.
