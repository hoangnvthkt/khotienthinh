# Project V2 → Procurement V2 technical validation

Validation date: 24 September 2026. Git branch: `feature/refactor-du-an-t9-1`. Implemented through Task 12 at `0e3f3f9c8adfb25818eec30b91a07f2feb6fd3ae`. This record covers **technical evidence only**. It does not activate a production cohort, change the DA29 G9 manifest, or sign off business UAT.

## Worktree and scope protection

- Before Task 13, `git status --short` and `git diff --name-only` showed dirty `components/procurement/*`, `components/project/material/*`, daily-log/auth files, `supabase/baseline/current.json`, `types.ts`, and `docs/audits/erp-end-to-end-2026-09-19/README.md`, plus untracked `docs/designs/` and `docs/references/`. These belong to other workstreams or user material and are excluded from Project V2 commits.
- The existing `docs/designs/erp-completion-2026-09-19/HANDOFF.md` is itself untracked and contains the G9 pilot handoff. It must not be added wholesale to a Project V2 commit. The Project V2 runbook and this evidence file can be staged by exact path.
- The shared migration baseline marker does not allowlist the Project V2 migration files. `npm run check:supabase-migrations` is red for this reason and for an unrelated in-progress daily-log migration; the marker was not modified for this workstream.

## Local verification

| Check | Result | Scope |
| --- | --- | --- |
| Focused V2 Vitest | PASS: 28 files, 130 tests | Project V2, material-plan procurement, Procurement V2, purchase draft and PO migration tests. |
| Full Vitest | PASS: 520 files, 2 skipped; 2448 tests, 2 skipped | Entire current worktree, including unrelated local edits. |
| Vite build | PASS | Application bundle. |
| Supabase query audit | PASS: 0 findings, 0 errors | Checked against the existing query inventory. |
| `git diff --check` | PASS | Current unstaged diff. |
| Repository `npm run lint` | FAIL outside Project V2: 185 TypeScript errors under untracked `docs/references/vioo-project-v2-codex-handoff/prototype-source` | Scoped TypeScript check reported no Task 12 file errors. The unrelated prototype is included by the repository-wide tsconfig and lacks its own Next/Radix dependencies. |
| Migration baseline gate | FAIL: V2 files and unrelated daily-log file unallowlisted in dirty shared marker | No baseline marker change was staged. |

## UI and command evidence

- Project V2 component walkthrough: 10 Playwright checks passed for source picker, month/construction/material editors, calculation basis, collaboration pagination, protected references, dirty-form comment guard, 390/768/1440 px, and 200% zoom. The 390 px collaboration screenshot was visually inspected; no horizontal overflow.
- Procurement V2 component walkthrough: 5 Playwright checks passed for dossier and PO editor at 390/768/1440 px, keyboard focus, 200% zoom and dark mode. These fixture checks do not establish a named-persona business journey on an actual preview route.
- Task 11 Cloud preview: rollback-only mixed MR/material-plan PO smoke, G5/G6/G7 smokes, and a two-buyer 60+60 race against 100 demand passed. One buyer committed 60; the other was rejected; no over-allocation committed. That preview was deleted.
- Task 12 Cloud preview: guarded collaboration/lineage migration and rollback smoke passed persisted actor/time, keyset pagination, denied history, protected-reference payload, bidirectional lineage, and exact historical title/lines after the current plan title changed. That preview was deleted.

## Full-chain Cloud replay

- A disposable **schema-only** branch `project-v2-task13-20260924` was created from the linked Supabase Cloud project. Automatic migration replay reported `MIGRATIONS_FAILED`. Manual tracked replay reached the older `20260910031856_authorization_v2_phase4_remaining_enforced_rooms.sql` and failed because its required Room-binding rows were absent from the schema-only clone. The branch was deleted. This is a concrete data prerequisite in a pre-V2 migration, not a Project V2 SQL assertion.
- A disposable **with-data** Cloud branch `project-v2-task13-data-20260924` had 113 historical migrations through `20260923042822` and 72 Room bindings. Its pooled Postgres URL rejected authentication, so the reviewed SQL was submitted only to the branch through the [official Management API query endpoint](https://supabase.com/docs/reference/api/v1-run-a-query), using `.env` credentials. The exact branch reference was checked before every request; no production SQL was submitted.
- The first five tracked files after the cloned head applied. Full tracked replay then **stopped** at the unrelated committed `20260923091500_daily_log_publish_progress_permission.sql`: existing `project_permission_rooms` rows violated `project_permission_rooms_allowed_actions_check`. The remaining daily-log files were not applied. The five remaining Project V2/Procurement V2 files applied successfully, completing the V2 schema chain on that preview. The query endpoint does not update `supabase_migrations.schema_migrations`; preview migration-history parity therefore remained at 113 and is **not** claimed as passing.
- Rollback-only Cloud smokes passed for planning, Task 6 availability/crews, Task 7 material candidates, Task 8 material-plan intake, composed Task 8 + Task 9 dossier read, and Task 12 collaboration/lineage. A post-smoke read found zero synthetic fixture projects. The mixed-source PO smoke stopped at `ERP_COMPLETION_PILOT_COMMAND_DISABLED`: the copied G9 command gate correctly rejected the synthetic project, which had no G9 rollout scope. Task 11's earlier isolated Cloud smoke and two-buyer race remain the PO evidence; the data-backed preview does not add a full-chain PO pass.
- Read-only schema checks on the data-backed preview: RLS enabled on all nine `public.project_v2_*` tables; 34 V2-named functions, 33 security definers, zero definers missing a configured `search_path`, and zero anonymous execution grants. Security Advisor returned 10 V2 `INFO` no-policy findings (tables are intentionally reached through guarded RPCs) and 20 `WARN` findings for authenticated security-definer functions; these need release review against the server guards. Performance Advisor returned 19 V2 `INFO` unindexed-FK findings and no V2 warning/error. The preview was deleted.

## Outstanding release gates

The 24 September material-plan follow-up connected the prepared project-wide BOQ reader to the material editor and plan detail. Focused BOQ/UI tests and the planning fixture walkthrough at 390/768/1440 px (6) passed; the Vite build and scoped TypeScript check passed. The repository-wide TypeScript check remains red only under the unrelated untracked `docs/references` prototype. The input renders over-receipt as a negative remaining quantity without crashing, and unresolved/pending figures stay explicitly unknown.

A disposable **with-data** Cloud branch `project-v2-boq-reader-20260924` (`gntvedmuzdxnhswysgoi`) cloned production with 116 migration-history rows through `20260924165000`. The ten Project V2/Procurement V2 migration files, including `20260924081548_project_v2_material_boq_position.sql`, were applied to that preview through the Management API after checking the exact branch parent/name/ref. The new public RPC is a security-invoker wrapper; the privileged reader is in `app_private`, and anonymous execution is denied. A rollback-only smoke passed for known zero receipts, confirmed site receipts, supplier returns, mixed BOQ source/unit uncertainty, outside-BOQ material and out-of-scope actor denial. Post-smoke workspace count was zero. Security and performance advisors reported no finding naming either new reader function. The preview was deleted, and its absence was confirmed in the branch inventory. Manual SQL did **not** advance migration history, so full tracked migration parity and the separate daily-log chain remain open. No production V2 migration or cohort was enabled. The pending supply field remains unknown until its own authoritative reader exists.

1. Resolve the separate daily-log Room constraint failure in its owning workstream, reconcile the shared migration marker, and rerun a full tracked Cloud migration replay with migration-history parity. Review the advisor warnings and run a G9-scoped mixed-source PO smoke. Do not apply Project V2 migrations to production until these gates are reviewed.
2. Run actual app-route journeys with a named sample project/site and separate planner, approver, buyer, warehouse and finance personas. Component fixtures and synthetic SQL tests do not provide this evidence.
3. Complete the [Project V2 pilot runbook](../../../runbooks/project-v2-pilot-rollout.md) UAT records with actual results, cleanup and named business signoff. Automation must not be marked as business approval.
4. The repository-wide lint and migration-baseline gates remain red while unrelated untracked/dirty workstreams are unresolved. Do not mix those files into a Project V2 commit.
