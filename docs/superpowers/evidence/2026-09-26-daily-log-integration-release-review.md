# Daily Log integration release review — 2026-09-26

## Scope and disposition

Main-agent integration review only; no independent reviewer or sub-agent.
No source changes, production deployment, pilot activation, migration replay,
ledger repair, PR closure or merge was performed. The dirty parallel root
workspace was not edited, staged or restored.

Recommend draft PR #13 as the single integration candidate against main:
https://github.com/hoangnvthkt/khotienthinh/pull/13
Keep PRs #7–12 as provenance until the integration and release decisions are
approved. Do not merge their overlapping stacks in addition to #13.

Candidate HEAD: `6a4e5c50407a86a7dc76a10388fa6cdda04baf52`.
Fresh GitHub main: `dbf6b0f8287f6cefda10baa0f097d38199f45da6`.
PR #13 is open/draft, mergeable=true, mergeable_state=clean. Supabase Preview,
Vercel Preview Comments, and Typecheck/test/build checks are all completed/success.
GitHub mergeability is not a production database upgrade gate.

## Fresh local verification

- `npm test`: 499 files passed, 2 skipped; 2,366 tests passed, 2 skipped.
- `npm run lint`: exit 0.
- `npm run check:supabase-migrations`: exit 0; 126 active / 402 archived SQL files.
- `npm run check:supabase-queries`: exit 0; zero findings/errors.
- Candidate worktree was clean before recording this review.

Full empty-preview bootstrap, rollback Cloud smokes, prior authenticated
personas and responsive browser evidence remain in the linked evidence files.
They are not a substitute for upgrading an already-populated Cloud database.

## Release hold: remote migration history differs from candidate

Read-only Management API inventory of parent `ftciqmqhmfvjtwoycswe`:
116 applied versions; first `20260903063714`, latest `20260924165000`.
PERF02 `20260903063821` and HRM `20260911041501` are already recorded.
The new Room bootstrap `20260903063822` is absent; all 13 Daily Log versions
are absent. Six Plan 1 versions and the Room bootstrap precede the latest
remote version, so an empty-preview chronological replay does not establish
the production upgrade path.

Four remote-only versions are absent from this candidate:

| Version | Remote migration name |
| --- | --- |
| 20260923042822 | fix_auth_profile_legacy_guard_order |
| 20260924094500 | project_material_request_site_stock_context |
| 20260924164000 | project_material_purchase_boq_warning_stock |
| 20260924165000 | project_purchase_warning_verified_on_hand |

Do not erase or mark these reverted. Do not import inferred replacements or
modify the parallel Project/Procurement code. Do not blindly use `--include-all`:
it includes pending migrations but does not prove reconciliation of remote-only
history or safety on populated data. Do not replay already-applied PERF02/HRM.

The repository CI contains validation only, not a production database push.
The Cloud parent is Git-linked to `main`. Its automatic production-deployment
setting was not established by this review. Supabase documents that the GitHub
integration can deploy when pushing/merging into the configured production
branch if that option is enabled:
https://supabase.com/docs/guides/deployment/branching/github-integration
Do not assume a main merge is code-only.

## Required next gate

Coordinate authoritative migration-history reconciliation with the parallel
work owner, without implementing their features. Then rehearse the selected
forward-upgrade procedure on an authorized isolated Cloud test environment
with representative populated-state guards. Confirm the actual deployment
configuration and explicit production release authorization before merging.
No production-ready claim is made by this review.

## Approved follow-up rehearsal

User approved authoritative migration comparison and an isolated Cloud test.
See `2026-09-26-daily-log-forward-upgrade-rehearsal.md`: all four SQL sources
match remote statements; actual populated synthetic forward upgrade and legacy,
permission/no-money checks pass. The test overlay contains those other-stream
files only in a separate rehearsal worktree, never in this integration PR.
The unchanged PR migration tree still fails the remote-only history dry-run.
The Auth source is currently untracked in the root workspace, and read-only
GitHub deployment-setting inspection returned 403. Accordingly the release hold
remains, narrowed to authoritative source integration, deployment configuration
confirmation and explicit production release approval.

Supporting bootstrap evidence:
`2026-09-26-daily-log-full-preview-integration.md`.
Supporting Plan 1/2 pilot evidence:
`2026-09-25-daily-log-baseline-cloud-smoke.md` and
`2026-09-25-resource-usage-evidence-pilot.md`.
