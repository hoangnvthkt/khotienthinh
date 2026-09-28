# Real Cloud bootstrap pipeline verification — 2026-09-26

## Outcome and scope

The real Supabase pipeline successfully bootstrapped all **113 migrations**
from `codex/hrm-bootstrap-guard`, source commit `93a18fd`, on a fresh no-data
preview. The PERF02, Room catalog, and HRM Task 12.3 bootstrap blockers are
resolved for this candidate. Workflow DRAFT enum creation/use also succeeds
when the pipeline commits migrations separately.

This proves the base/repair candidate bootstrap, **not the complete Daily Log
integration candidate**: the branch does not yet contain the 13 Daily Log
Plan 1/2 migrations. No broader Daily Log Completion Gate, production rollout,
merge readiness, or app-persona smoke-test completion is claimed here.

## Safe preview replacement

The previously failed disposable preview `xllopwgistvwjwpkchtb` had zero
auth/public users, projects, staff, transactions, requests, memberships,
room grants, storage objects, direct grants, and role assignments.

It was associated with the repair branch and reset through the provider's API.
Action `2a89b9f613f547c19fe6e1c58baaac5e` failed in the reset bulk-drop SQL
with `53200: out of shared memory`, before migrations started.
`max_locks_per_transaction` was 64. Read-only checks confirmed zero data and
the original 31 migration ledger rows still present. No lock configuration
was changed and the reset failure was not treated as a migration regression.

The empty disposable preview was deleted and replaced with a fresh no-data
preview; the Git branches, worktrees, PRs, and previous evidence remain.
The schema is reproducible from Git; there was no user/business data to recover.
The earlier failure was preserved before deletion on
[PR #12](https://github.com/hoangnvthkt/khotienthinh/pull/12#issuecomment-5843382076).

The historical rollback runners hardcode the retired preview ref and are
pre-cutover fixture regressions. They are not intended to run against the
fully bootstrapped preview or production.

## Provider pipeline evidence

- New test preview: `juphuggkwoswemazkmma`.
- Git ref: `codex/hrm-bootstrap-guard`.
- Provider action: `8e50c0d03e27495091e5b5dfe72e2778`.
- Repository: `hoangnvthkt/khotienthinh`, workdir `.`.
- Final branch status: `FUNCTIONS_DEPLOYED`.
- Steps clone, configure, health, pull, migrate, seed, deploy: all `EXITED`.
- Migration ledger: 113 expected / 113 applied; zero missing or extra versions.
- Last migration: `20260922064202_fix_boq_material_planning_wrapper_security`.
- Logs explicitly show Phase 4, HRM Task 12.3, the separate DRAFT enum
  creation/use migrations, and subsequent migrations completing.

No direct SQL replay, manual migration-ledger insertion, include-all deploy,
fake bootstrap profiles, or grant seeding was used. The provider ran the Git
migration chain using its real pipeline.

## Read-only post-bootstrap checks

| Check | Observed |
| --- | ---: |
| Auth/public users, projects | 0 |
| Room memberships / actor Room grants | 0 |
| Direct grants / role assignments | 0 |
| Generated LEGACY_HR profiles | 0 |
| Room catalog / active Rooms | 14 / 10 |
| Retirement dispositions | 4 |
| Missing active Room bindings | 0 |
| Active bindings not enforced or fallback enabled | 0 |
| Workflow DRAFT enum values | 1 |
| Legacy fallback disabled | true |
| Room PBAC fallback enabled | false |

The read-only API cannot execute the private `permission_hardening_flag`
helper; the verification reads its settings table instead. No function ACLs
were changed to accommodate diagnostics.

Final branch inventory still shows baseline-vioo-git (`oymkraihhqahqvzahhtx`)
and production (`ftciqmqhmfvjtwoycswe`) on their original Git refs with status
`FUNCTIONS_DEPLOYED`. Neither received a mutation from this verification.
No local Supabase or Docker was used.

## Next integration step

Prepare an isolated Daily Log candidate containing only its original scoped
Plan 1/2 commits plus these reviewed prerequisite repairs, then run that full
candidate through the same real preview pipeline. Keep the parallel Project V2
/ Procurement V2 workspace changes out of the candidate. The base bootstrap
gate is now evidenced; the complete Daily Log candidate gate remains open.
