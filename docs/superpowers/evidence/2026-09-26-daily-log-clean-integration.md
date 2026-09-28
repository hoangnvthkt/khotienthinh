# Daily Log Plan 1 + Plan 2 clean integration candidate

This candidate is based on `28ba180` (PERF02 PR #8), itself based on
`dbf6b0f` (`main`). It transplants the 22 Daily Log Plan 1 commits from
`codex/daily-log-plan1-gate` and the eight Plan 2 commits from
`codex/daily-log-resource-evidence` in source order. It does not merge either
source branch: the Plan 1 branch interleaves Project V2 / Procurement V2 commits
that are outside the Daily Log release.

The only cherry-pick conflicts were two additions to
`supabase/baseline/current.json` and the action-label list in
`ProjectRoomSubmissionDialog.tsx`. The manifest resolutions retain the 13
Daily Log / resource-evidence migration files and omit unrelated Project V2 /
Procurement V2 migration names. The action-label resolution adds only
`view_resource_evidence` to the `main`-based action set; it does not import the
Project V2 `return` UI action. The Plan 1 SQL constraint still accepts `return`
as in its already-tested source, but this candidate adds no `return` binding
or grant.

All 13 transplanted Daily Log/resource-evidence migration files and the new
evidence components are byte-identical to the source Plan 2 branch. No path
with `project-v2`, `procurement`, `boq`, `material` or `purchase` in its name is
changed relative to the PERF02 base. The existing shared Project Dashboard,
Daily Log, Weekly Progress, Permission Room and Finance surfaces contain only
the cherry-picked Daily Log/evidence changes; they still require maintainer
review before merge.

## Verification on this candidate

- Base PERF02 commit before transplants: 2,243 tests passed, 2 skipped.
- Plan 1-only checkpoint: 2,333 tests passed, 2 skipped; TypeScript and
  migration-baseline check passed.
- Plan 1 + Plan 2 checkpoint: 2,355 tests passed, 2 skipped; TypeScript,
  production build, migration-baseline check and Supabase-query audit passed.
- The authorized Cloud `baseline-vioo-git` pilot and browser acceptance for the
  source Plan 2 branch are recorded in
  `2026-09-25-resource-usage-evidence-pilot.md`. The candidate's migration
  files match those already exercised there; this is not a fresh production
  deployment or a claim that the full Git-linked preview chain passes.

## Open integration gates

1. PERF02 PR #8 remains draft and unmerged. A Cloud preview of that branch
   applied PERF02 and recorded all three expected indexes as valid/ready, but
   stopped later at `20260910031856_authorization_v2_phase4_remaining_enforced_rooms.sql`:
   `Authorization V2 final Room binding inventory is incomplete`. On the new
   empty preview database, the `quantity_acceptance`, `payment` and `safety`
   binding inventories were absent. Authorization V2 owns that bootstrap fix;
   do not patch it in this Daily Log candidate.
2. Review this candidate against the approved Plan 1/2 Completion Gates,
   especially exact project/site authorization, legacy unknown handling,
   current-only revision totals and no-money payload/UI.
3. After the unrelated preview bootstrap gate is corrected, run the complete
   Git-linked preview chain and recheck migration versions/source hashes.
   Resolve whether to supersede source PR #7 only after this candidate is
   reviewed. No automatic merge or production rollout is authorized by this
   evidence note.
