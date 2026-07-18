# Phase 02 Business Role and Minimal SoD — Live Apply Log

## Current status

- Status: **Cloud schema/history applied; all rollout flags off; Auth profile
  sync forward-fix passed rollback-only verification and is waiting for an
  explicit one-version apply approval**
- Updated at: `2026-07-18T08:25:49+07:00`
- Branch: `refactor/module-du-an-v1`
- Reviewed rollout commit: `903b29740b1544787ab09e7c223229c02b2b5346`
- Implementation candidate commit: `bf31d23cdf5c49152a99255ad161d997b9733bfc`
- Database migration versions:
  - `20260717084356_authorization_business_role_foundation.sql`
  - `20260717084903_authorization_effective_permission_resolver.sql`
  - `20260717085909_authorization_minimal_sod_registry.sql`
  - `20260717090703_authorization_governance_commands.sql`
  - `20260717092007_authorization_account_lifecycle_integration.sql`
  - `20260717092508_authorization_override_evidence.sql`
  - `20260717093122_authorization_backend_checkpoint_hardening.sql`
- Rollout flags on Cloud: resolver `false`, legacy-governance fallback disabled
  `false`, and System Admin business-approval bypass disabled `false`.

Do not record emails, passwords, access or refresh tokens, Auth IDs, database
URLs, API keys or service-role values in this file.

## Phase 1 closure carried forward

- Phase 1 status: PASS by explicit operator acceptance in commit `baa23ca`.
- Evidence boundary: the operator waived the unelapsed remainder of the
  24-hour/Dashboard-log collection after thorough manual testing. That waived
  evidence is not represented here as collected.

## Local verification

- Checkpoint C passed before this rollout audit: 168 test files and 984 tests
  passed; TypeScript and the production build exited `0`.
- Fresh Task 12 rerun at `2026-07-17T17:12+07:00`: `npm test` passed all
  168 test files and 984 tests; `npm run lint` exited `0`; `npm run build`
  exited `0` with only the existing large-chunk advisory.
- Scoped whitespace verification for the two Task 12 documents passed. The
  unrelated pre-existing changes in `components/Layout.tsx` and
  `pages/request/RequestList.tsx` remain untouched and unstaged.
- Visual click-through was unavailable because the session exposed no browser
  runtime. Static UI contracts, TypeScript and production build are the
  available pre-Cloud UI evidence; the live authenticated canary remains a
  Task 13 gate.

## Rollback-only linked database verification

- Supabase CLI: `2.95.6`; linked Cloud query syntax is
  `supabase db query --linked`. No Docker or local Supabase runtime was used.
- Exactly seven unique candidate migration paths and six smoke files were
  resolved.
- All seven migrations, all six smoke suites and the explicit ACL/RLS/RPC
  inventory ran in one linked Cloud transaction with a five-second lock timeout
  and 120-second statement timeout.
- Result: exit `0`, checkpoint `phase02_rollback_smoke_passed`, followed by an
  explicit `ROLLBACK`.
- Post-rollback fingerprint: zero Phase 2 migration-history rows, zero Phase 2
  governance relations and zero unique Phase 2 public RPC rows remained.
- Inventory passed: RLS enabled on all four governance tables; no direct
  `PUBLIC`/`anon` table ACL; no authenticated direct write; no actor/caller
  parameter on browser-callable Phase 2 RPCs; every Phase 2 private SECURITY
  DEFINER has an empty `search_path`.
- The authenticated Data API error-envelope exercise was intentionally not
  claimed at Task 12 because the candidate RPCs did not exist outside the
  rollback transaction and no disposable authenticated test session was
  available. The RPCs now exist after apply, but unauthorized, invalid-payload
  and duplicate-idempotency-key cases still must run before enabling any rollout
  flag, with raw `message`, `details` and `hint` inspected for identifier or SQL
  leaks.

## Independent security review findings

- Frontend search found no direct insert, update or delete against
  `principal_role_assignments` or the Phase 2 `authorization_*` tables.
- Phase 2 governance mutations are actor-free at the browser boundary and
  derive the active actor in the backend.
- Existing implicit `ADMIN` compatibility branches remain outside the Phase 2
  governance path. Daily Log is owned by Phase 4; Project Core, Payment and
  Quality by Phase 5; Workflow, Request and the remaining ERP modules by Phase
  6; generic legacy helper removal by Phase 7. Their presence is not treated as
  proof that those module transitions have already cut over.
- `post_supplier_payment_batch` and `reverse_supplier_payment_batch` still
  accept browser-supplied `p_actor_id`. Replacing that identity with
  `current_app_user_id()`, splitting approval from mark-paid and persisting
  maker/checker/executor identities are fail-closed Phase 5 prerequisites.
- The stable Phase 2 seams are present with the approved signatures:
  `resolve_effective_permission_sources`, `assert_subject_sod` and
  `has_valid_authorization_override`. Later phases may consume them but must not
  weaken their identity, source-label or hard-deny contracts.
- The linked advisor baseline returned 267 pre-existing warnings: 170 security
  and 97 performance. Categories include mutable function search paths,
  extensions in `public`, permissive RLS, executable definers, multiple
  permissive policies and duplicate indexes. No Phase 2 object was persisted
  when advisors ran, so these are baseline inventory rather than new Phase 2
  findings.
- The post-apply advisor rerun returned the same 267 warnings with zero matches
  against Phase 2 objects, so the seven migrations introduced no new advisor
  warning at the configured `warn` threshold.
- Nine pre-existing `app_private` SECURITY DEFINER functions outside Phase 2
  use a non-empty search path. They are recorded as forward hardening debt; all
  Phase 2 private definers passed the empty-path assertion.

## Cloud apply and migration-history repair

- Status: **Applied and repaired exactly seven versions with explicit operator
  approval.**
- Preflight at `2026-07-17T17:20+07:00` found zero reserved role-code
  collisions, zero active direct `system.settings.manage` grants, zero existing
  template items for that permission and zero Phase 2 schema/history
  fingerprints.
- The seven migration files were applied in their listed order inside one
  linked Cloud transaction. Result: exit `0`, checkpoint
  `phase02_migrations_applied`, one explicit `COMMIT`.
- Fresh committed-schema fingerprint found all four governance relations, all
  five unique public RPC checks and all three rollout flags set to `false`;
  migration history still contained zero Phase 2 rows before repair.
- All six smoke files then passed against committed schema in a separate linked
  transaction. Result: exit `0`, checkpoint
  `phase02_committed_schema_smoke_passed`, followed by `ROLLBACK`; zero fixture
  users remained and all three flags stayed `false`.
- Exactly versions `20260717084356`, `20260717084903`, `20260717085909`,
  `20260717090703`, `20260717092007`, `20260717092508` and `20260717093122`
  were repaired as applied. No `db push` was used.
- Linked history changed exactly from 167 aligned / 82 local-only / 146
  remote-only to 174 aligned / 75 local-only / 146 remote-only, with 395 total
  displayed rows and zero mismatched row. This proves unrelated drift was not
  changed.
- Post-apply additive inventory: one active legacy Admin has both bootstrap
  roles; missing `SYSTEM_ADMIN` and `PERMISSION_ADMIN` mirrors are both zero;
  seeded business-approval items are zero; classification mismatches are zero;
  active roles on disabled accounts are zero; durable rollout operators are
  one.
- ACL/security inventory remains clean: RLS is enabled on all four governance
  tables, `PUBLIC`/`anon` ACL rows are zero, authenticated direct-write tables
  are zero, Phase 2 definers with a non-empty search path are zero, public
  actor-parameter RPCs are zero, and audit/notification secret-key hits are
  zero.
- Login incident evidence: before apply, Data API returned `PGRST202` because
  `get_effective_permission_sources` did not exist. After apply, the RPC is in
  the schema cache, `authenticated` has EXECUTE, and `anon`/`PUBLIC` do not. An
  anonymous probe now receives the expected `42501` denial instead of a missing
  function error. Authenticated operator retry remains the functional check.
- Cutover blocker: 467 active direct-grant rows across 23 principals and 26
  permission codes are now classified `sensitive` but have no expiry; expired
  rows are zero. These grants were not revoked or rewritten. A Permission Admin
  must explicitly revoke or reissue them with reason and future expiry before
  resolver/cutoff canary proceeds.
- Emergency rollback starts by calling
  `set_authorization_rollout_flags(true,false,false,reason)` to restore the
  compatibility resolver posture. Schema or data corrections use a forward-fix
  migration; governance and audit history is never deleted.

## Post-apply checkpoint audit and remediation inventory

- A fresh read-only linked-Cloud audit at `2026-07-17T22:51:59+07:00`
  reconfirmed all seven intended Phase 2 versions aligned in local and remote
  migration history. No migration was reapplied or repaired during this audit.
- All four governance tables still have RLS enabled. Thirteen key public Phase
  2 RPC names each resolve to exactly one overload; `PUBLIC`/`anon` executable
  RPC rows, `PUBLIC`/`anon` governance-table ACL rows, authenticated direct-write
  governance-table ACL rows and public RPC actor/caller parameters are all zero.
- All three rollout flags remain `false`. One active legacy Admin has both
  bootstrap roles, the durable rollout-operator count is one, and active role
  assignments on disabled accounts remain zero.
- The sensitive direct-grant snapshot is 467 active rows with null expiry across
  23 principals and 26 permission codes; active rows with a past expiry are
  zero. Scope distribution is 235 construction-site rows over three sites, 230
  project rows over two projects and two global rows. Per-principal exposure is
  2–50 rows, average 20.3.
- The previous 485-row/30-code snapshot is retained only as historical evidence.
  The database changed between snapshots; this checkpoint does not infer or
  record principal identities or an unverified reason for the reduction.
- Highest-volume affected action groups include Material Request approve (25),
  Weekly Progress verify (25), Daily Log verify (24), Payment mark-paid/confirm/
  verify (22 each), and Daily Log approve (19). This is operational authorization
  data, not safe for blind bulk expiry or revocation.
- Remediation is gated per principal: capture the complete current direct-grant
  draft, classify each sensitive source as retain or revoke with a business
  owner, preview the full replacement through the governed backend command,
  require a future expiry and reason for retained sensitive grants, then verify
  sources and adjacent-action denial before moving to the next principal.
- No production grant, Business Role assignment, responsibility slot, rollout
  flag or migration-history row was changed at this checkpoint.
- At `2026-07-17T22:59:10+07:00`, the operator approved a 90-day expiry horizon
  and use of a disposable authenticated principal for the Data API canary. The
  environment exposes only the project URL, anon key, Management API access
  token and database password; it contains no user password, service-role key,
  E2E credential or stored browser session. Browser discovery returned no
  available session. To preserve JWT-bound actor evidence, the checkpoint did
  not create an Auth user through SQL, synthesize request JWT claims or use the
  Management API as a substitute for an authenticated Permission Admin.
- At that checkpoint, state-changing remediation remained blocked until an
  active Permission Admin session became available through the application.
  Secrets or access tokens must not be copied into this log or chat.
- At `2026-07-17T23:37:04+07:00`, an authenticated Chrome session for Admin
  Hoàng loaded the governance UI successfully. The page showed both active
  bootstrap assignments, `SYSTEM_ADMIN` and `PERMISSION_ADMIN`, and returned
  effective-permission sources through the Cloud Data API.
- The authenticated invalid-payload canary submitted a sensitive direct-grant
  preview without its required expiry. PostgREST returned code `23514`, message
  `Invalid direct permission grant`, and null `details`/`hint`; no SQL,
  relation, function, schema or principal identifier leaked in the envelope.
- The exact no-op direct-grant command was then previewed and submitted twice
  for an active principal with zero direct grants. Both calls returned cleanly.
  A linked-Cloud before/after check remained at zero active direct grants and
  zero `direct_permission_grants_changed` audit events for that principal, so
  the retry produced neither data churn nor duplicate audit evidence.
- A negative call to the override command from the current Admin session could
  not serve as the unauthorized canary because legacy fallback is still on and
  currently resolves the override capability for that Admin. The malformed
  evidence was nevertheless rejected before mutation with code `22023`,
  message `Invalid override control evidence`, and null `details`/`hint`.
- Two attempts to create a zero-right disposable account through the existing
  `create-user` Edge Function were rejected with the public safe message
  `Không thể xử lý yêu cầu tài khoản.` The UI did not persist a profile; a
  linked-Cloud check found zero matching canary profiles. Temporary local
  diagnostic logging was reverted, and the working tree contains no code
  change from the canary.
- The read-only Auth-log trace identified the failure boundary: GoTrue's
  `/admin/users` transaction reached the `public.users` sync trigger and was
  rejected by `app_private.prevent_users_privilege_self_update()` with SQLSTATE
  `42501` (`Only admins can update other user rows`). Migration
  `20260716103946` had allowed the trusted `supabase_auth_admin` session, but
  migration `20260716170745` later replaced that guard with a lifecycle-command
  exception only. This is the reproduced root cause; no fix was applied.
- The remaining authenticated negative-actor case therefore requires either a
  working disposable-account path or a browser session for an existing active
  non-admin account. No access/refresh token was inspected or copied. All three
  rollout flags remain `false`; the sensitive-null-expiry inventory remains
  467 rows and no production grant was remediated in this checkpoint.

## Auth profile sync guard forward-fix

- Verified at `2026-07-18T08:25:49+07:00` against immutable candidate commit
  `f350b740ca08a9a0d95be033cd8076c998968681` and migration version
  `20260718012151`.
- The focused repository suite passed six test files and 26 tests; TypeScript
  exited `0`. The pre-implementation repository baseline passed all 168 test
  files and 984 tests.
- Committed-Cloud RED reproduced `Missing narrow supabase_auth_admin bypass`
  before any candidate SQL was applied.
- Migration plus definition, normal-actor, lifecycle-gated `service_role` and
  ACL smoke passed in one linked transaction. The final checkpoint was
  `auth_profile_sync_guard_forward_fix_rollback_passed`; the transaction ended
  in explicit `ROLLBACK`.
- The post-rollback guard hash matched the preflight value
  `fdcc839d7f78836c262f2b14d4a0e53c`; the Auth-admin bypass remained absent and
  migration version `20260718012151` remained local-only/unapplied.
- All three rollout flags remained `false`; the sensitive-null-expiry inventory
  remained 467. No grant, role assignment, profile or migration-history row was
  changed by this verification.
- Status: **Waiting for explicit operator approval to apply and repair exactly
  one forward-fix version.**

## Resolver enablement canary

- Status: **Blocked before flag mutation by 467 sensitive direct grants without
  expiry and by the remaining authenticated negative-actor canary.**
- Enable the resolver first while the other two cutoffs remain disabled. Verify
  source explanations, scope/expiry behavior and adjacent-action denials with
  disposable principals before advancing.

## System Admin governance/business-authority cutover

- Status: **Pending.**
- Legacy governance fallback and implicit System Admin business approval are
  separate cutovers. Each requires its own negative canary and rollback point;
  System Admin must retain technical recovery authority without receiving an
  implicit business approval permission.

## Vercel preview and production

- Status: **Not started for this candidate.**
- Publish the exact verified candidate to the existing preview path only after
  the database canary passes. Production promotion requires the operator's
  explicit checkpoint and the same immutable commit.

## 24-hour observation

- Status: **Not started.**
- Observe authorization denials, governance RPC failures, resolver-source
  mismatches, SoD/override events and account-lifecycle regressions for at least
  24 hours after production cutover. Dashboard/log evidence must be recorded or
  explicitly waived; elapsed time must not be inferred.

## Forward fixes

- Any post-apply defect is corrected with a new forward migration and a focused
  regression test. Never edit applied migration history, delete governance or
  audit rows, silently restore legacy grants, or broaden a rollout flag to mask
  a missing scope/assignment resolver.
- Pre-existing advisor and migration-history drift stays separately owned; it
  must not be bundled into the seven-version Phase 2 apply.
