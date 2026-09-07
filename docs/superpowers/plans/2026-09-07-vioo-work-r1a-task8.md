# Vioo Work R1A Task 8

Execute approved R1A shell/list/create scope in the existing feature worktree, main
agent only. Supabase Cloud only. No handoff, calendar/pilot grants or feature enablement.

- Add guarded, bounded creation option/context RPCs so the UI does not warm global
  employee/project data. Return minimal names/IDs, canonical scope/action decisions
  and calendar readiness; existing preview/create RPCs remain authoritative.
- Lazy Work route and permission-filtered module navigation. Four personal lists,
  filters, cursor pagination, loading/empty/error/retry states and invalidation.
  Clear requests/data when account, view or filters change.
- Accessible drawer/full-screen mobile create sheet; user/work-group selectors,
  scope/bucket, deadline shortcuts, priority, plain-text description, labels,
  watchers/reviewer, expanded checklist editor and attachment upload after create.
- Preview recipients with exclusion reasons, dedupe and stale-response fencing.
  Preserve a creation key/payload across ambiguous retries; do not create twice when
  attachment upload fails. Clone loads a draft without writes. Basic authorized
  task landing/copy link supports Task 8; rich detail/lifecycle stays Task 9.
- Meaningful service/state/browser tests and Cloud rollback personas; lint/build,
  query/migration audit, candidate commit, isolated Cloud migration apply/postflight.
  Keep production UI and notification gate off. Record normal rollout evidence.
