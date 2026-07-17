# Phase 02 Business Role and Minimal SoD — Live Apply Log

## Current status

- Status: **Cloud schema/history applied; all rollout flags off; resolver canary
  blocked pending sensitive-grant expiry remediation**
- Updated at: `2026-07-17T17:26:40+07:00`
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
- Cutover blocker: 485 active direct-grant rows across 23 principals and 30
  permission codes are now classified `sensitive` but have no expiry; expired
  rows are zero. These grants were not revoked or rewritten. A Permission Admin
  must explicitly revoke or reissue them with reason and future expiry before
  resolver/cutoff canary proceeds.
- Emergency rollback starts by calling
  `set_authorization_rollout_flags(true,false,false,reason)` to restore the
  compatibility resolver posture. Schema or data corrections use a forward-fix
  migration; governance and audit history is never deleted.

## Resolver enablement canary

- Status: **Blocked before flag mutation by 485 sensitive direct grants without
  expiry and by the pending authenticated Data API canary.**
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
