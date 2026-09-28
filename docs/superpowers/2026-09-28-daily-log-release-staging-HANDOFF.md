# Handoff — Daily Log release candidate, staging rehearsal, production hold

**Continuation checkpoint — 28/09/2026, 20:54 ICT:** the historical snapshot below
is superseded by the [exact 147→173 staging rehearsal](evidence/2026-09-28-daily-log-exact-staging-upgrade.md).
Main `4fcca71` was reconciled into candidate `d1f084a`; 16,024 schema entries matched,
26 pending migrations applied on independent staging `kkthixjcficmufpfynqx`, legacy
fingerprints stayed identical, 17 SQL smokes and 4 local browser checks passed.
Production remains 147, preview 173, baseline 44. PR #13 remains draft. Overall
release still awaits staging management/Auth verification and cleanup (API 403),
confirmation of the production migration execution mechanism, and separate owner
release approval. No production SQL/main merge/pilot activation occurred. The
staging project remains provisioned; preserve evidence before authorized cleanup.
Do not repeat already completed parent reconstruction unless a fresh drift check
invalidates it. Read the new evidence and its decision checklist first.

**Snapshot:** 28/09/2026, 20:06 ICT (13:06 UTC). This is a point-in-time record; re-read GitHub and Supabase Cloud before acting.

**Immediate state:** Daily Log Plan 1 and Plan 2 implementation/pilots are complete. The approved user-centered engineer-slip and CHT-report UX is in draft PR [#13](https://github.com/hoangnvthkt/khotienthinh/pull/13). The remaining task is **release integration and an exact-history, populated but sanitized Cloud staging rehearsal**, not re-planning or rebuilding the feature. PR #13 must remain draft; no production merge or SQL push is authorized.

## 1. Read order and authority

1. `/Users/admin/khotienthinh/AGENTS.md` (applies to this repo). One main agent only; no subagents. Supabase Cloud via `.env` only; no local Supabase/Docker. Do not touch the dirty parallel root checkout.
2. This handoff, then the [current release-gate evidence](evidence/2026-09-28-daily-log-release-candidate-gate.md).
3. The approved [business/technical spec](specs/2026-09-23-daily-log-wbs-progress-resources-cost-design.md), [Plan 1](plans/2026-09-23-daily-log-wbs-area-summary-progress.md), and [Plan 2](plans/2026-09-23-daily-log-resource-evidence-supplier-payment-readiness.md). Plan 1 passed its Completion Gate at `63ff0b4` before Plan 2 started. These plans are historical implementation contracts, not a request to restart Task 1.
4. The approved [user-centered UX design](specs/2026-09-26-daily-log-user-centered-ux-revision-design.md), [UX plan](plans/2026-09-26-daily-log-user-centered-ux-revision.md), [guide](evidence/2026-09-27-daily-log-user-guide.md), and [visual/CHT checkpoints](evidence/2026-09-27-daily-log-commander-report-ux-checkpoint.md).
5. [Forward-upgrade rehearsal](evidence/2026-09-26-daily-log-forward-upgrade-rehearsal.md), [integration review](evidence/2026-09-26-daily-log-integration-release-review.md), and [resource-evidence handoff](2026-09-25-resource-usage-evidence-HANDOFF.md) for provenance. The original `/Users/admin/khotienthinh/docs/superpowers/2026-09-23-daily-log-wbs-progress-resources-HANDOFF.md` is **untracked in the dirty root checkout and describes the pre-implementation state**; do not mistake its “start Task 1” instruction for the current next step.

The owner approved the spec, the subsequent engineer-slip/CHT UX, isolated Cloud staging rehearsal and later cleanup. The owner has **not** approved merging PR #13 into `main` or deploying the 26 pending Daily Log migrations to production. Production's GitHub integration has “Deploy to production” enabled for `main` (owner-confirmed; Management API setting read returned 403). Treat merging to `main` as a production database deployment decision requiring separate explicit approval.

## 2. Non-negotiable business and scope invariants

- One engineer creates one source slip per `person + area/construction front + day`; a person covering two areas creates two slips. The consolidator selects slips into independent snapshot cards, may edit copies without changing sources, and sends one day summary to the site commander (CHT). Rejected slips/cards return for correction and resubmission.
- Only CHT-confirmed summary publication may create official daily WBS progress and weekly rollup. Publication is atomic, idempotent, revision-safe and permission-checked. No direct official-progress write from source slips or frontend. Do not average percentages across overlapping areas without allocation basis.
- Labor/machine evidence is physical quantity/time plus catalog or manual provider snapshot and lineage. Daily Log, its RPC/JSON/UI, and evidence read model have **no unit price, money, accrual, matching or project transaction**. Payment integration is separate future work; it may reference `resourceLineId` but must not mutate verified Daily Log evidence.
- Keep legacy data as-is. No guessed WBS, provider or hours semantics; no speculative backfill. Unknown is not zero. Superseded revisions remain traceable but never double-count in current totals.
- Do not redesign the approved UX or modify Project V2/Procurement V2/BOQ work outside a concrete integration conflict. The root workspace has concurrent changes belonging to the owner/other stream.

## 3. Exact working locations and Git state at this snapshot

- **Use this isolated worktree for all candidate work:** `/Users/admin/.codex/worktrees/daily-log-clean-integration/khotienthinh`.
- Branch: `codex/daily-log-bootstrap-integration`; draft PR #13 targets `main`.
- PR head / local HEAD: `8a52438ed3561e57abd94ee30c01464d90eb2e1d` (`docs(daily-log): record current mainline preview gate`). Last code/integration merge: `e874cf08f225ec9ce796cd35224059461bb0a360`.
- Fresh fetched `origin/main`: `4fcca71a1566421d0b5b4922b7618fe0eba911b0`; `git rev-list --left-right --count origin/main...HEAD` was **`11 60`**. `main` moved during this handoff; the 11 incoming commits include authorization/security UI and seven migration files, not yet in PR #13. Do **not** use older evidence's 140→166 state as current production parity.
- Worktree status before this handoff: only ` M supabase/.temp/cli-latest` (pre-existing CLI temp change). Preserve it; do not stage or restore it. Root checkout `/Users/admin/khotienthinh` is on `feature/refactor-du-an-t9-1` with extensive BOQ/Procurement/ERP/authorization changes and untracked files. Read only; never stage/restore/edit there.
- PR #13 was independently read from GitHub as open/draft at the head above. The Supabase Preview, Vercel Preview Comments, and Typecheck/test/build check-runs on that head were all completed/success. Checks are not the populated upgrade gate.

Current incoming `main` migration sources (owner stream; inspect exact source/history before integrating, do not reimplement their features):

| Version | File on `origin/main` |
| --- | --- |
| `20260928080828` | `authorization_user_snapshot_for_admins.sql` |
| `20260928083215` | `authorization_p2_documents_activities_rls.sql` |
| `20260928083534` | `safety_storage_site_scoped_access.sql` |
| `20260928084924` | `authorization_p1_6_private_project_photos.sql` |
| `20260928092719` | `authorization_p3_project_room_templates.sql` |
| `20260928101825` | `authorization_p3_roles_to_personal_grants.sql` |
| `20260928113000` | `authorization_p3_user_permission_templates.sql` |

Use `git diff --name-only $(git merge-base HEAD origin/main)..origin/main` to inspect **incoming main changes**. Do not use `git diff HEAD..origin/main` as a PR-scope audit: it also reports candidate-only files absent from main and is misleading here.

## 4. Cloud inventory at this snapshot — recheck first

All reads below used the authorized `.env` token and read-only Management API SQL. No Cloud mutation occurred while preparing this handoff.

| Environment | Ref | Migration ledger | Role |
| --- | --- | ---: | --- |
| Production `main` | `ftciqmqhmfvjtwoycswe` | **147**, latest `20260928113000` | Real users/projects and active notification cron jobs; **read-only until release approval** |
| PR #13 preview | `fbfmonuiizfeiekxxwph` | **166**, latest `20260928065520` | Data-less preview of the old PR head; not yet reconciled with fresh main |
| `baseline-vioo-git` | `oymkraihhqahqvzahhtx` | **44**, latest `20260927075421` | Separately used test environment, seven Auth users/one project at last count; preserve |

Fresh set comparison of production migration versions versus PR #13's 166 local SQL filenames: exactly **seven production-applied versions missing from the candidate** (the table above) and **26 candidate-only pending versions**. After safe mainline integration, expect a 173-file candidate *if no concurrent changes occur*, not a release conclusion. Recompute rather than trusting that expected number. The live Cloud branch list last contained only `main`, `baseline-vioo-git`, and the active `codex/daily-log-bootstrap-integration` PR preview. Historical rehearsal branches were deleted; the old Dashboard screenshot was stale.

Production previously held 62 Auth users, 86 projects, 10 active `pg_cron` jobs, 321 legacy Daily Logs, 821 labor rows, 404 machine rows, 13,334 progress rows, and 1,100 project transactions at the 140-version checkpoint. These counts are **historical**, not an invitation to copy data or a current inventory. The 10 active jobs make a full-data binary clone unsafe: copied jobs could act on copied real users before isolation. No full-data clone was made.

## 5. What has been completed and proven

- Plan 1/2 TDD tasks, isolated commits, Cloud rollback SQL smokes and the four-persona authenticated ERP pilot completed. The engineer-slip → summary → return/resubmit → CHT publication → read-only resource-evidence flow passed on the authorized test branch. Desktop/tablet/mobile and light/dark UX were walked through. The owner approved the UX; the CHT “30-second” hierarchy emphasizes day overview, WBS result, alerts, area cards, photos, with audit/version secondary.
- Candidate source/history reconciliation previously brought all then-applied 140 production versions into the branch. The six exact historical source hashes are locked by `lib/__tests__/dailyLogReleaseMigrationSources.test.ts`; the last TDD extension was observed RED for missing notification source/allowlist, then GREEN after merging `main` at `e874cf0`.
- Last comprehensive local verification at `e874cf0`: **2,593 tests passed, two existing skips**; `npm run lint`, `npm run build`, `npm run check:supabase-migrations` (**166 active / 402 archived**), and `npm run check:supabase-queries` (zero findings/errors) all exited 0. This does **not** validate the newly advanced `main` yet. The later docs-only `8a52438` GitHub checks all passed.
- Previous synthetic, populated Cloud forward upgrade reached 164 versions and preserved legacy-row fingerprints; it tested a **130→164** path, not today's production parent. The empty PR preview proves bootstrap only, not upgrade of production-shaped data.
- Attempts to reconstruct an exact parent on data-less branches were stopped safely: first at transaction-incompatible `CREATE INDEX CONCURRENTLY` in historical PERF02; after a transaction-safe test correction, later at missing Room/HRM historical data; then schema-only restore attempts rolled back on absent relation and `max_locks_per_transaction`. All disposable branches were deleted and verified absent. No production SQL push, migration-ledger repair, full-data clone, guessed backfill or main merge occurred.

## 6. Staging access and release blocker

The owner authorized creation of an isolated **Supabase Cloud** staging project, rehearsal, then removal; not local/Docker. A prior `POST /v1/projects` with the existing `.env` PAT returned **403** for organization-level project creation. The PAT *can* create Cloud branches, but a branch is not an adequate substitute for controlled independent staging. `baseline-vioo-git` has only 44 versions and must not be overwritten as a pseudo-production parent.

The owner was given two choices on 28/09/2026:

1. Add a new scoped token to `.env` as `SUPABASE_STAGING_CREATE_TOKEN` with **Organization Projects → Read-write**, plus a distinct `SUPABASE_STAGING_DB_PASSWORD`, so the agent can create staging. Do not replace the existing `SUPABASE_ACCESS_TOKEN` or print secrets.
2. **Recommended:** create an empty Cloud project manually in the same organization, preferably region `ap-southeast-1`, without GitHub auto-deploy; add `SUPABASE_STAGING_PROJECT_REF` and `SUPABASE_STAGING_DB_PASSWORD` to `/Users/admin/khotienthinh/.env`. The owner need not import, clone, or migrate anything. `.env` is gitignored. The new project may incur compute billing until deleted; tell the owner before cleanup.

At this snapshot, **no `SUPABASE_STAGING_*` keys were present** in `.env`. Recheck by listing **names only**; never echo values, passwords, URLs containing passwords, tokens, SQL connection errors with credentials, or service-role secrets. The owner may supply staging after this handoff in a new chat. A dedicated staging project should use a sanitized **logical** restore/fixture, with outbound jobs/notifications disabled before data is introduced. Preserve production's source, ledger and real users. If staging lacks permissions/capacity or exact-history equivalence cannot be proved, keep the release hold and report the specific blocker; do not substitute a weaker test while calling the gate passed.

## 7. Next actions for the new agent — in order

1. Work only in the isolated PR #13 worktree. Run read-only `git status`, `git fetch origin main`, inspect PR draft/head/checks and fresh Cloud production/preview migration ledgers. Inventory `.env` **variable names only** for new staging values. Preserve `supabase/.temp/cli-latest` and all root-checkout changes.
2. Reconcile the seven newly production-applied `origin/main` migrations against the production ledger **byte/normalized SQL and version**, following the existing source-integrity pattern. Audit all incoming main files against Daily Log/security integration surfaces. Merge fresh `origin/main` into the isolated candidate only if in-scope conflicts are understood; preserve mainline owner implementations. Do not cherry-pick inferred SQL or edit parallel Project/Procurement features. Resolve migration baseline carefully; use TDD for any candidate contract change, run targeted then full verification, commit/push scoped changes, and confirm PR preview catches up. If main moves again, repeat the read-only comparison.
3. When the owner has provided staging access, verify exact staging project ref, independence from production/baseline, health, empty/sanitized state, DB connectivity and cost boundary. Plan and execute a controlled logical, sanitized reconstruction of the **then-current production-applied parent** and representative legacy rows. Keep cron/notifications/outbound integrations disabled throughout. Do not export/copy real Auth users or real project data, and do not use a full-data binary clone.
4. Compare staging schema/ledger and representative pre-upgrade data fingerprints to the frozen parent contract. Rehearse exactly the pending candidate migrations in the order the production deploy would use. Assert WBS/legacy preservation, permission constraints, no-money evidence, no duplicate publication/current totals, idempotency, rollback and audit behavior. Capture commands/results with secrets redacted. If an exact equivalent parent cannot be built, **do not claim the rehearsal passed**.
5. Re-run full code/SQL/Cloud/UX checks required for the release gate, update evidence and the PR body, keep PR draft. Present a production rollout/rollback checklist and **seek explicit owner approval** before any `main` merge, production migration or pilot activation. The owner already authorized removing the temporary staging project after rehearsal: confirm its exact ref and retain evidence before deletion; never delete `main` or `baseline-vioo-git`.

Helpful Git diagnostics and verification commands (run from the isolated worktree; `npm` commands may generate build/test artifacts):

```bash
git status --short --branch
git rev-list --left-right --count origin/main...HEAD
git log --oneline HEAD..origin/main
git diff --name-only $(git merge-base HEAD origin/main)..origin/main
npm test -- --maxWorkers=1 --reporter=dot
npm run lint
npm run check:supabase-migrations
npm run check:supabase-queries
npm run build
```

The five `npm` commands are verification, not a substitute for the populated Cloud staging upgrade. Before *any* candidate commit or PR update, follow the repository's `superpowers:verification-before-completion` gate and inspect exact staged paths. Use `superpowers:executing-plans` only when continuing an actual implementation plan; the existing two plans are complete. No subagent for this job.

## 8. Do-not-do list and communication contract

- No `main` merge, production SQL push, live pilot activation, migration repair, speculative backfill, or claim that the release gate passed without exact staging evidence and explicit release approval.
- No Supabase local/Docker; no full-data/binary clone of production; no outbound jobs acting on copied real users.
- No editing/staging/restoring root BOQ/Procurement/authorization work, and no cleanup of `main`, `baseline-vioo-git`, or the active PR preview.
- No Daily Log prices, monetary columns, accrual, supplier matching or project transactions; no `internal_price_book` dependency.
- One main agent, no subagent. Internally reason in English. Ask only genuinely new owner decisions; send owner-facing questions and final conclusions in Vietnamese. Give concise progress updates while working.

## 9. Paste into a new chat

```text
Đọc toàn bộ /Users/admin/.codex/worktrees/daily-log-clean-integration/khotienthinh/docs/superpowers/2026-09-28-daily-log-release-staging-HANDOFF.md và các tài liệu được liên kết. Tiếp tục release gate của draft PR #13 bằng đúng một agent chính, không dùng sub-agent. Bắt đầu bằng kiểm kê Git/Cloud/.env read-only vì main và production đã tiến lên 147 migration ở snapshot 28/09; không coi số liệu snapshot là hiện tại. Làm việc trong isolated worktree của PR, không chạm workspace BOQ/Mua hàng/authorization đang dirty. Reconcile mainline migration trước, rồi diễn tập exact populated-but-sanitized upgrade trên Supabase Cloud staging độc lập khi thông tin staging có trong .env. Không local/Docker, không clone full production data, không merge main/production SQL push nếu chưa qua gate và chưa được anh duyệt riêng. Giữ PR draft, ghi bằng chứng kiểm chứng; vướng gì báo anh bằng tiếng Việt.
```
