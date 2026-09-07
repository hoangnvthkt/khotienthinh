# Vioo Work R1A Task 7

Approved design sections 17.5 and 18; existing worktree, main agent only, Cloud
ftciqmqhmfvjtwoycswe. No handoff. Feature and notification delivery gates stay off.

- Private `work-attachments` bucket. Fifteen-minute reservations, immutable authenticated
  uploads, server-only finalization and signing (60 seconds); no client object reads,
  list, overwrite or delete. Restrictive policies isolate this bucket from other policies.
- Attachment kinds input/discussion/result/evidence. Evidence always preserves the
  original; other images preserve it only on explicit request. Derivatives always strip
  profiles and normalize orientation. No invented legal retention period.
- Validate bytes, declared MIME, exact size and safe filename. Initial supported formats:
  JPEG, PNG, static WebP, PDF, UTF-8 text. Unsupported/animated/vector/archive/Office
  formats fail explicitly. This is a bounded R1A processor, not a malware scanner.
- Edge WASM image processing: configurable display edge (default 1920), thumbnail 320,
  WebP and PNG fallback. Conservative image input ceiling 5 MiB / 4 megapixels,
  non-image ceiling 25 MiB; enforce decoded dimensions before allocation. UI integration
  and camera preprocessing are Task 8–9, and must preserve the original opt-in contract.
- Fence processing attempts and cleanup leases; pre-register every output path before
  writing. Recheck current task authorization on finalization/sign/delete. Append audit
  and outbox exactly once. Tombstone deletion and retryable Storage API cleanup; a
  grace window covers in-flight uploads and URL expiry. Never delete storage SQL rows.
- Add rollback Cloud persona/RLS/worker smoke, real WASM fixtures and transport tests,
  feature-local typed upload/read/delete service, lint/build/regressions/advisors.
- Candidate commit, isolated dry-run/apply, API Edge deploy, Cloud postflight, and
  rollout evidence. No real user notifications, calendar setup or pilot enablement.

Completed 2026-09-07. Implementation `6034762`; operation-boundary correction
`f9ab102` prevents signed-upload capabilities outliving the reservation. Both forward
migrations applied after isolated dry-runs, ledgers 18/18. Edge deployment and the
Cloud Storage physical probe passed. All Task 3–7/core/helper Cloud regressions,
353 Vitest files / 1,669 tests, five WASM image tests, lint/build, Deno locked check,
query/baseline audits and error-level security advisors passed. Rollback/task/object
fixtures are clean. See the normal rollout runbook for limits and postflight evidence.
