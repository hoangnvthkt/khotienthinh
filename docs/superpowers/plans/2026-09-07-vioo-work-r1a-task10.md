# Vioo Work R1A Task 10

Use the existing feature worktree, main agent only, Supabase Cloud only.

1. Add canonical configure-scope readers and audited/versioned/idempotent writes for
   buckets, scoped calendars, dated exceptions and SLA policies. Prevent cross-scope
   calendar edits and overlapping effective policy ranges. Do not recalculate existing
   assignments or rewrite their snapshots/deadlines.
2. Build guarded settings UI with bounded lists, scope selection, business intervals,
   holiday/working-day overrides, per-priority policy and server SLA preview.
3. Verify permission personas, invalid intervals/overlaps, retry/version behavior,
   existing SLA engine, responsive browser flows, tests/lint/build and audits.
4. Commit candidate, dry-run/apply only this migration, run Cloud postflight.
5. Prepare a concrete named pilot manifest: verified accounts/scopes/grants, actual
   business calendar/policies, deployment target and delivery activation. These
   inputs must come from the user; do not infer participants or working hours.
6. Apply the authorized concrete pilot, verify access and readiness, record rollout.
   Until inputs arrive, keep gates off and complete all independent implementation.
   No handoff; Task 11 observation follows actual pilot activation.
