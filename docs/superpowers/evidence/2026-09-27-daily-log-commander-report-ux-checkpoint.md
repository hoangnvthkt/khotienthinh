# Task 7 — commander report / verified history checkpoint

Target: authorized test Cloud `baseline-vioo-git` (`oymkraihhqahqvzahhtx`), isolated branch `codex/daily-log-bootstrap-integration`. Task BASE `b43f34eb0f9d830864aef1dff8b7af9ffb341da0`. Single primary agent; no root Project V2/Procurement/BOQ edits, no production writes, push, merge or deployment.

## Behavior and TDD

- New read-only work table renders quantities, physical resources/providers, forecast, notes and photos without mutation props or disabled editable fields. Mobile uses work-item cards; desktop scrolling stays inside the table wrapper.
- Actual report header is **Bản tổng hợp thi công ngày**. Approval name/time come only from saved verification fields; missing fields remain unknown. Review offers separate **Trả bản tổng hợp** and mandatory-reason **Trả phiếu sửa**, with the latter calling the checked V2 exact-source command.
- Pilot **Đối chiếu thử nghiệm** preserves the submitted report after a false publication receipt. Enforced publication was tested only inside a disposable UUID ERP project scope; existing admin-preview pilot configuration remains unchanged.
- Verified reports have no quantity/percent forms, send/delete/return actions or prompts to make new decisions. Saved decisions and earlier comments are history. Missing copied work/units/decisions remain informational unknowns, never live-source backfill or guessed zeros.
- The test first reproduced missing read-table and five report regressions, plus a verified-history fallback to live work. A further history-clock test reproduced a newer source submission time appearing in a copy with no saved timestamp; the fix now preserves unknown. That test's first GREEN check assumed a longer label than the existing formatter; corrected to the actual generic unknown label without weakening the timestamp assertion.
- Existing revision/reopen semantics remain: locked period has no create-revision button; unlocked verified original creates one reasoned child and stays verified.

## Authorized submit correction

[Finding and resolution](2026-09-27-daily-log-summary-resubmit-findings.md). One additive migration only: `20260927075421_daily_log_summary_resubmit_route_v2.sql`. User approved it separately. Real Auth/ERP RED was `42501` from the rejected-state redundant routing update, not missing sender authority. No global trigger or legacy helper changes, and no additional sender approval rights.

Before/after function fingerprints are identical for legacy submit and all three shared status/Room/route triggers. Cloud migration history 43→44, unchanged prefix, sole expected new suffix. Advisor findings 61→61 with zero new identities. New migration selector tests refuse missing/duplicate history and unrelated dry-run migration selections; baseline allowlist contains only the new filename.

## Verification

Commands run from the isolated worktree; root `.env` supplies test Cloud credentials without printing secrets. Logs/screenshots live in the plan's git-ignored `.superpowers/sdd/2026-09-26-daily-log-user-centered-ux-revision/` directory.

| Check | Observed result |
| --- | --- |
| Targeted read-table/workspace/report/revision/scope suites | 33 tests / 5 suites pass |
| Full `npm test -- --maxWorkers=2` | 2,496 pass, 2 pre-existing skips; 516 passing files; 30.05s |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0, 8.03s; existing >500 kB chunk warning |
| Migration baseline / query check / diff whitespace | 138 active, 402 archived; zero query findings/errors; clean |
| `run-summary-resubmit-cloud.mjs --smoke` | 18 rollback smokes pass |
| `summary-draft-auth-smoke.mjs` | 3 real non-admin Auth accounts; pending/save/copy/refresh/submit pass; retained fixtures 0 |
| `source-transition-auth-smoke.mjs` | 5 real non-admin Auth accounts; retry/concurrent return/area isolation/resubmit pass; retained fixtures 0 |
| Task 6 actual ERP summary regression | pass, 38.1s, after shared report changes |
| Actual ERP commander flow with missing units | pass, 57.1s; saved unit/quantities remain null |
| Actual ERP commander flow with known unit, including controlled load error/retry | pass, 47.0s; real Cloud lifecycle and cleanup pass |

The known-unit ERP flow is also exercised with physical resources and light/dark screenshots. Both versions use non-admin author, summarizer, CHT and reader, with real anon-key sessions in browsers. Setup/cleanup alone uses authorized management access. The flow covers summary-only return preserving both source rows byte-for-byte, non-approver summarizer resubmit, exact source A return/edit/resubmit, B unchanged, explicit summary refresh, final 31% decision, 40 labor-hours/12 machine-hours, reader denial, locked period and reasoned revision. Controlled loading/failure/retry shell checks complement real Cloud requests; they are not a claim of a real Cloud outage.

Inspected screenshots: known light 1440/390 and unknown light 1024/dark 768/dark expanded 390, plus earlier report views. Flat bordered sections, actual approval details and readable physical-resource drill-down are visible. Unknown overview correctly reports two missing-unit quality records, not zero. Body-wide overflow checks pass at 1440×900, 1024×768, 768×1024, 390×844 and 360×800 in both themes. Task 8 still owns keyboard/long-text/full-role acceptance and real user comprehension.

## Harness and cleanup qualifications

Fixture corrections: missing scoped ERP-entry grant and pilot owner/release, nested snake_case→camel case normalization, the actual rejected/approve route, raw snapshot field names, and remounting the same viewer after theme toggling. None changed product validation or grants globally. The per-task area basis50 was not inferred to be the whole WBS100; the fixture uses an explicit manual summary decision/reason for two measured disjoint parts.

Revision cleanup must first detach only the disposable project's revision linkage and remove its contributions before logs; otherwise immutable included-source and bidirectional revision FKs correctly block teardown. Two exact failed-cleanup projects (`__DL_UX7_21a342e1-3d53-401c-8fd2-2ce39f61f44e`, `__DL_UX7_e9e06aab-f343-44b2-9aa8-d18933933e9b`) were validated and removed with corrected teardown; audit found zero owned projects/receipts. Four earlier orphan return notifications were removed only by validated UUID project/log pairs with no real project/log remaining. These disposable records cannot be recovered through the app but can be regenerated. No real histories/accounts were deleted.

Final browser teardown asserts own projects/logs/sources/receipts/grants/notifications all zero and the preview-pilot snapshot unchanged. No financial evidence/ledger writes or inferred historical backfill are part of this task. Dev server4197 remains available. Human acceptance and final branch integration remain separate gates.
