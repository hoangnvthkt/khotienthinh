# Daily Log WBS — Cloud persona smoke, 2026-09-25

Status: API/database, integrated browser journeys and full ERP-shell read route passed; **Plan 1 Task 10 / Completion Gate is not complete**. Global gates remain open.

## Authorized boundary

- User explicitly authorized full access to Cloud branch `baseline-vioo-git` (`oymkraihhqahqvzahhtx`).
- Dedicated synthetic project: `DL-WBS-PILOT-20260925`, no site, cutover `2026-09-25`, release `daily-log-wbs-20260925`.
- Main Cloud project/RICO and the parallel Project V2 → Procurement V2 work were not modified. Root `.env` and Supabase link were not changed. No Docker/local database.
- Six dedicated Auth users: two authors, summarizer, CHT, QS reader, denied actor. Each has an EMPLOYEE profile; no workflow call used a service-role/admin actor. Provisioning alone used Auth Admin / operator access. Random passwords were held in memory, not recorded.
- Room grants were restricted to this test project. CHT test owner: `72000000-0000-4000-8000-000000000004`.

## Migrations installed on this branch

`20260923090000`, `20260923091500`, `20260923093000`, `20260923100000`, `20260923101500`, `20260923103000`, `20260925062233`, `20260925063126`, `20260925065524`, `20260925153000`.

Each exact migration source was recorded in branch migration history. No unrelated module migrations were installed.

## Observed results

| Check | Actual result |
|---|---|
| Auth sessions | All six signed in with real email/password sessions |
| Denied actor | WBS bundle rejected with SQLSTATE 42501 |
| Authors | Created, saved and submitted Khu A/Khu B sources through authenticated RLS |
| Resource snapshots | Catalog provider: 5 people × 8 h = 40 labor hours; manual `Chủ máy anh Bình`: 2 machines × 6 h = 12 machine hours |
| Manual overlap decision | Missing reason rejected; explicit cumulative 30%, cumulative quantity 30, daily quantity 30 accepted |
| Reader publication | Rejected with SQLSTATE 42501 |
| Pilot authority | `authoritative=false`; source and shadow writes created no official progress |
| First shadow | One mismatch against absent manual progress; promotion rejected with `PILOT_SHADOW_UNRESOLVED` |
| Manual baseline | CHT successfully used the existing manual progress RPC during pilot |
| Second shadow | Zero mismatches; isolated test scope promoted to enforced |
| Publication | Verified summary, exactly one official task-progress row, both source cards marked included |
| Retry | Same command returned same receipt; one publish command / one progress row |
| Pause rehearsal | `paused`, `authoritative=false`; new publication rejected with `DAILY_LOG_WBS_ROLLOUT_DISABLED`; official evidence unchanged |
| Financial boundary | Zero project transactions in the dedicated test project; Daily Log resource payloads were physical/provider only |

Summary: `DL-WBS-PILOT-SUMMARY-20260925`.

First shadow: `f2938284-17f9-4278-8c1c-b1898689356f`.

Publication command: `cc62d465-f4e9-450b-a02a-671eec02ba55`; published at `2026-09-25T06:39:00.106703Z`.

Verified resource IDs: `d7bb18c3-a79f-47d5-afbb-93c716806397`, `e49a9ce2-a3cb-4e71-b84b-45e063c09ee0`.

## Runtime defects found and corrected

1. Pilot previously claimed progress authority. The new gate writes shadow evidence only; enforced mode is required for official publication.
2. Source INSERT RLS still used generic legacy staff permissions. Enabled post-cutover WBS scopes now use the Daily Log Room action and exact author identity; historical/out-of-rollout behavior retains the old helper.
3. The legacy contribution transition trigger rejected CHT publication. A narrow branch allows only workflow-field changes to mark an unchanged source included in its linked, already-verified normalized summary, with approve + publish rights. Generic shared authorization functions were not changed.
4. Pilot UI labelled the action and receipt as official publication. It now says “Đối chiếu thử nghiệm” and keeps review open for shadow receipts.

Two rollback-only SQL smokes passed: `supabase/tests/daily_log_contribution_room_insert_smoke.sql` (author, spoof, reader, legacy boundary) and `supabase/tests/daily_log_shadow_pilot_smoke.sql` (missing shadow, pause, operator-only access). They require the dedicated branch fixture.

`npm test`: 2498 passed / 2 skipped. `npm run build`: passed (existing chunk-size warning). Focused workspace/service tests: 21 passed. Application TypeScript: zero diagnostics, excluding the unrelated `docs/references` prototype in memory only (no config edits). Scoped `git diff --check`: passed. This is not a claim that the repository-wide lint or migration baseline gate passes.

## Cleanup / remaining gate

Rollout remains **paused**. Synthetic users/project/sources/summary/progress/shadow evidence are retained for follow-up; nothing was deleted. No production rollout was activated.

### Follow-up verification, 2026-09-25

- Six Cloud rollback SQL suites PASS through `node tests/daily-log/run-cloud-smokes.mjs`: foundation, publication/revision, Room INSERT, shadow pilot, missing shadow for another submitted summary, enforced cutover. Operator missing-parameter denial and pause audit PASS. The runner targets only the authorized branch, not the root linked main project.
- The enforced guard was developed RED→GREEN against real authenticated RPCs: manual save and close-with-draft are denied; close without draft/reopen remain possible; exception outside enforced is denied. New migration SHA256: `49db8a3dde8a06d1c90dd6abee5aef79babe2603e2ec6e321c66b2f0deb41e1b`.
- Gate self-review reproduced `UNSHADOWED_SUMMARY_ACCEPTED` in a rollback Cloud transaction: one matching shadow let another submitted summary enter enforced mode without comparison. Migration `20260925153000` now requires current, matching shadow evidence for **every submitted normalized summary** in scope for that release. SHA256: `c4785d32957f6de9118dad3006ebbc613163f6e0efb05faa72789032f0a6b031`. Six rollback smoke suites passed together with this migration before deployment; the exact source was then recorded in baseline branch migration history.
- Browser run: `npx playwright test --config tests/daily-log/cloud-playwright.config.ts` — **3 passed (54.1s)** at 1440/900/390. Six real EMPLOYEE sessions; source A/B, catalog/manual resources, manual official decision, reader/denied actor, mismatch blocks promotion, matched shadow, publication/lineage and pause in finally. Latest synthetic journey dates: 2026-10-04/05/06.
- The main three journeys use production components/services and live Cloud Auth/RPC in a navigation fixture. A separate Playwright case opens the latest verified summary through the **real ERP shell** at `/#/da?projectId=...&tab=dailylog&dailyLogId=...` with an authenticated CHT, then observes its WBS/provider evidence and no verified mutation action. Initial RED exposed a missing project-scoped navigation grant; `project.daily_log.view` was granted only to the five authorized synthetic personas on the dedicated project. The denied persona received no grant. Full run after that correction: **4 passed (1.0m)** at 1440/900/390 plus the ERP route. The shell case covers read/deep-link navigation; mutations remain covered by the Cloud component journey.
- Browser exposed and fixed source contamination: a new author inherited another contribution's work/resources. Initial editor state is now scoped to its own contribution. Submit uses saved rowVersion/fingerprint. Regression tests preserve those boundaries.
- UI checks: no reader/verified mutation actions or blank sticky footer; paused normalized review does not fall back to legacy; loading/error is explicit; legacy before cutover retains its review; resolved conflict is shown as a recorded decision rather than a pending action. Manual official quantities remain optional/unknown rather than inferred.
- Screenshots: `.superpowers/sdd/2026-09-23-daily-log-wbs-area-summary-progress/{summary,verified}-{1440,900,390}.png`; desktop/tablet/mobile inspected. No horizontal overflow in browser assertions. Unit metadata absent on the synthetic normalized source stays visibly unknown.
- Runbook and operator tooling now live in `docs/runbooks/erp-completion-pilot-rollout.md` and `supabase/operations/daily_log_wbs_area_pilot.sql`. The unrelated untracked cross-module progress document was deliberately not edited.

### Gate status (not waived by scoped checks)

- Application suite with `npm test -- --exclude '.claude/**'`: **2,505 tests pass / 2 skipped**, 528 files pass / 2 skipped (15:11 local run).
- Final application TypeScript check excluding `docs/references/**` and `.claude/**` **in memory only**: **zero diagnostics**. Final production build passed (12.84s) with existing chunk-size warning. No tsconfig/Vitest config edits to conceal global failures.
- Bare `npm test` scans another owner's nested `.claude/worktrees/feature+Clone-UI-Base-Workflow`: 12 failed files / 4 failed tests. Failures: `tests/request/discussionEdit.cloud.test.ts` (Cloud config missing); nested Playwright suites `authorization-v2-module-access`, `g5-procurement-workbench`, `g6-wms-control`, `g7-finance-control`, `g8-management-dataset` (loaded by Vitest); `openingBalanceSnapshotRetryMigration.contract`, `poActualReceiptMigration`, `poDeliveryCancelFulfillmentSyncMigration`, `weeklyProgressMigration.preflight.contract` (missing archived migrations); `boqMaterialPlanningUiContract` (preview text); `materialIssueRecipientSourceMigration` (two missing-migration assertions). All paths are under that nested worktree and remain untouched.
- `npm run lint` fails on the unrelated `docs/references/vioo-project-v2-codex-handoff/prototype-source` dependency/alias errors. No application-path diagnostics in that run.
- `npm run check:supabase-migrations` fails on unregistered parallel-work migrations: `20260924094500_project_material_request_site_stock_context.sql`, `20260924164000_project_material_purchase_boq_warning_stock.sql`, `20260924165000_project_purchase_warning_verified_on_hand.sql`. Daily Log's three new allowlist entries are included separately; no registration of other owners' migrations.
- No final Plan 1 completion claim. No Plan 2 work. Final whole-plan review remains after resolving the global gates. Test branch is paused, evidence retained, main/RICO untouched.

### Clean-checkout gate rerun, 2026-09-25

- Re-ran the exact repository commands at commit `c76eb9c` in an isolated clean worktree (no changes from the parallel Project V2/Procurement checkout): `npm test` passed **2,497 tests / 2 skipped** across 525 passed files / 2 skipped; `npm run lint` passed with zero diagnostics; `npm run build` passed. The build retained only the existing Vite chunk-size warning. This distinguishes the root checkout's unrelated `.claude`/reference-tree failures from committed application code; no test or TypeScript configuration was changed.
- The exact `npm run check:supabase-migrations` still failed in that clean worktree on only three tracked but unregistered Project V2/Procurement migrations: `20260924094500_project_material_request_site_stock_context.sql`, `20260924164000_project_material_purchase_boq_warning_stock.sql`, and `20260924165000_project_purchase_warning_verified_on_hand.sql`. All ten Daily Log migration files are registered in the committed baseline inventory and their exact sources were installed with history on the authorized Cloud branch. No other owner's migration or baseline entry was edited or staged.
- Re-ran all six rollback-only Cloud SQL suites plus operator parameter/pause audit: passed. Re-ran the four Cloud browser cases, including the authenticated real ERP-shell read route: **4 passed (1.1m)**. A read-only Cloud query after the run confirmed the isolated rollout scope remains `paused` (`release_id=browser-2026-10-15`). Main/RICO remain outside these checks.
- Plan 1 Task 10 Step 6 still calls for **all** listed commands to pass. Accordingly, the global migration-inventory failure is not treated as a pass or silently waived; Task 10 and the Plan 1 Completion Gate remain open, and Plan 2 has not started. The remaining action belongs to the concurrent migration owner: register those three migrations in their baseline workflow, then re-run the exact gate and final review.
