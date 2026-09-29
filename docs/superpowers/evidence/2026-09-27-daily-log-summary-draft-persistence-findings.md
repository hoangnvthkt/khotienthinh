# Daily Log UX — Task 6 persistence finding

Initial blocker checkpoint: Task 5 was committed as `5f73cd0`; Task 6 BASE is `5f73cd008ede2dac9ac3a4ad90df4bee64cc6311`. At that checkpoint the full Task-6 brief had been read and no Task-6 implementation or migration had been applied. The evidence below describes that pre-approval state, not the current deployment state.

## RED evidence

Seven new regression tests failed against the existing production components: persisted/explicit two-of-three selection, unique WBS and physical-hour overview, safe unresolved draft saving, saved review-comment visibility, collapsed item-scoped resource/photo details, and preservation of an adjusted copy with intentionally empty resources. The existing workspace and picker regression suites passed in the initial combined run. At the initial checkpoint those new tests were deliberately RED; no green full-suite claim was made.

## Backend root cause

The existing `daily_log_wbs_decisions.official_cumulative_percent` is `NOT NULL`. `save_daily_log_summary_work_v1` requires a decision for every selected task and inserts that field directly. Manual-override reasons are additionally required at save time. Therefore simply enabling the UI's save button cannot satisfy the approved requirement that unresolved decisions may be saved but not submitted. Filling an unknown percentage with zero or guessing a value would violate the specification.

A bounded Cloud persistence probe on `baseline-vioo-git` (`oymkraihhqahqvzahhtx`) reproduced SQLSTATE `23502` specifically for `official_cumulative_percent` while the parent summary was draft. This is a schema-persistence diagnostic, not a claim of end-to-end user RPC verification. Both owned fixtures rolled back; a subsequent read found zero task/log fixtures. No schema, rollout, production data or financial records changed.

## Required scope extension

Task 6's listed implementation files are frontend components and their integration/tests. Completing its unresolved-draft gate requires an additive, separately reviewed backend migration, with explicit pending-draft persistence and submit/approval/publication rejection until all required decisions are complete. Preserve the legacy contract, applied migrations, effective verified histories, existing Room authority and production rollout. Do not weaken finalized-data guards or synthesize official numbers.

The user approved this backend addition on 2026-09-27: “ok, anh đồng ý cho em bổ sung”. Continue the existing Task 6; this is not a new business-model decision or a request to re-plan locked choices. The selected implementation keeps pending decisions in private draft storage and preserves the official table's strict constraints. Verification and completion are recorded in the later Task-6 checkpoint.
