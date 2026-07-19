# Phase 02 Business Role and Minimal SoD — Live Apply Log

## Current status

- Status: **Phase 02 closure Task 1 is applied: authorization View+Audit
  readiness is verified; all rollout flags remain off; no user grant, Business
  Role assignment or rollout flag was changed by this checkpoint. The next
  gate is the independent control-owner appointment before the remaining
  warned sensitive regrants.**
- Updated at: `2026-07-18T19:39:41+07:00`
- Branch: `main`
- Phase 02 closure plan commit: `fcbe416e14fae07f20f9e2d14ec14227382a0afe`
- Reviewed rollout commit: `903b29740b1544787ab09e7c223229c02b2b5346`
- Implementation candidate commit: `802e6aacc89333e3a3fcac530f909a5d34181fd3`
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

### Applied forward-fix and post-apply canary blocker

- At `2026-07-18T08:46:16+07:00`, the operator-approved Task 4 reconfirmed
  candidate commit `f350b740ca08a9a0d95be033cd8076c998968681`, migration
  version `20260718012151` and migration SHA-256
  `9f1ed0b1a9eacfb3c28569af5efb9f5a3214943289527aa6093157f141d5464d`.
- Exactly that migration was applied in an explicit linked transaction. The
  committed smoke reached
  `auth_profile_sync_guard_forward_fix_committed_smoke_passed`, and exactly
  version `20260718012151` was repaired to `applied`; local and remote history
  markers are aligned.
- The committed guard hash is `dd1fc23c524c5d899378f3425461dce7` and the
  narrow `supabase_auth_admin` bypass is present. Scoped security and
  performance advisors returned their unchanged baselines (170 and 97 warning
  rows respectively), with no warning targeting
  `app_private.prevent_users_privilege_self_update()`.
- Two post-apply attempts to create a zero-right `EMPLOYEE` canary through the
  normal application UI still returned the safe public message `Không thể xử
  lý yêu cầu tài khoản.` The form selected no legacy permission, Business Role
  or direct grant.
- Read-only Postgres logs for both attempts recorded SQLSTATE `42501`, message
  `Only admins can update other user rows`, database role `authenticator` and
  application `PostgREST 14.5`. This is a different boundary from the original
  Auth-trigger failure: the restored Auth-admin branch is installed, while the
  subsequent `create-user` Edge Function performs a redundant
  `public.users` upsert through its service-role PostgREST client without the
  lifecycle command context. The guard correctly rejects that second write.
- The Edge Function compensating cleanup completed after both failures. A
  linked aggregate confirmed zero matching `auth.users` accounts and zero
  matching `public.users` profiles, so there is no active or orphaned canary to
  disable. No credential, Auth ID, profile ID or token was copied to this log.
- Final read-only inventory still shows all three rollout flags `false`, 467
  active sensitive grants without expiry, zero canary accounts/profiles and the
  repaired migration marker unchanged. No production grant, Business Role,
  responsibility assignment or rollout flag changed.
- Status: **Task 4 stopped at Step 6.** Do not edit the applied migration. The
  next forward fix must change and deploy the `create-user` path so it does not
  repeat the protected profile update as an ungated service-role PostgREST
  write, then repeat the zero-right creation, unauthorized `42501` Data API
  canary and lifecycle disable cleanup before closing this checkpoint.

### Minimal profile creation forward-fix rollback gate

- At `2026-07-18T10:22:07+07:00`, the narrowed implementation candidate was
  commit `ad63d389bcdff5ee3279b797f9bb0f151fea95cf`. It changes only the
  `create-user` profile-write boundary, one contract test, and one forward
  migration with its contract/smoke tests; no command RPC, wrapper, audit event
  or generalized compensation framework was added.
- Migration version `20260718031842` has SHA-256
  `40869ea8ba4f844ceb66164006b8c8147c182c0718a5ad731c3c39b337a4b358`.
  Linked history showed it local-only/pending before and after the rollback
  gate.
- Full repository verification passed 170 test files and 993 tests. TypeScript
  and the production build exited `0`; the existing bundle-size warning was
  unchanged and is outside this forward-fix.
- Read-only Cloud preflight recorded sync-function hash
  `c2929961018c33150527e25382dfbe3c`, all three rollout flags `false`, and 467
  active sensitive grants with null expiry.
- The new migration and definition smoke passed in one linked transaction. The
  final checkpoint was `auth_profile_safe_sync_rollback_passed`, followed by
  explicit `ROLLBACK`.
- Post-rollback verification matched the preflight sync hash, kept migration
  version `20260718031842` pending, kept all three rollout flags `false`, and
  kept the sensitive-null-expiry inventory at 467. No schema, profile, grant,
  assignment, rollout flag or migration-history mutation persisted.
- Status: **Waiting for explicit approval to apply exactly migration
  `20260718031842`, repair exactly that version and deploy exactly
  `create-user`.** The zero-right creation, unauthorized `42501` and lifecycle
  disable canaries remain pending until that approval.

### Applied minimal profile creation forward-fix and authenticated canary

- At `2026-07-18T10:49:12+07:00`, the operator-approved candidate was commit
  `802e6aacc89333e3a3fcac530f909a5d34181fd3`; migration version
  `20260718031842` retained SHA-256
  `40869ea8ba4f844ceb66164006b8c8147c182c0718a5ad731c3c39b337a4b358`.
- Exactly that migration was applied in an explicit linked transaction. The
  committed smoke reached `auth_profile_safe_sync_committed_smoke_passed`, and
  exactly version `20260718031842` was repaired to `applied`. Final linked
  history shows the local and remote version markers aligned. The committed
  `public.sync_auth_user_profile()` definition hash is
  `2247b889645b5d73cf146e9cf98ff3fd`.
- Exactly the `create-user` Edge Function was deployed. Final Cloud inventory
  reports version `20`, status `ACTIVE`, with JWT verification still enabled.
- One zero-right `EMPLOYEE` canary was created through the normal Settings UI.
  The linked aggregate returned one ACTIVE profile linked to Supabase Auth,
  zero active direct grants and zero active Business Role assignments.
- Using that canary's own authenticated session, the Data API call to
  `preview_direct_grant_replacement` was rejected before mutation with HTTP
  `403`, SQLSTATE `42501`, message
  `Authorization administration permission required`, and null `details` and
  `hint`. No credential, token, Auth ID or profile ID was copied to this log.
- The canary was then disabled through the standard account-lifecycle modal,
  not by direct deletion. Final linked inventory shows one DISABLED profile,
  lifecycle operation status `IDLE`, zero active direct grants and zero active
  Business Role assignments. A fresh password grant was rejected by Auth with
  `user_banned`.
- Fresh post-Cloud verification passed all 170 test files and 993 tests;
  TypeScript, production build and `git diff --check` exited `0`. The existing
  large-chunk advisory is unchanged. Security and performance advisors retain
  their existing warning baselines of 170 and 97 rows respectively.
- Final read-only Cloud verification shows all three rollout flags remain
  `false` and the sensitive-null-expiry inventory remains 467. No production
  grant, Business Role assignment, responsibility assignment or rollout flag
  was changed by this checkpoint.
- Status: **The authenticated negative-actor blocker is closed. Task 13 Step 5
  remains open solely for remediation of the 467 sensitive direct grants with
  null expiry before resolver enablement.**

## Sensitive direct-grant global reset manifest checkpoint

- At `2026-07-18T11:55:00+07:00`, the approved global two-phase plan captured
  the exact active sensitive source into a private runtime manifest. The source
  contains 467 unique rows across 23 principals and 26 permission codes, with
  zero duplicate key and zero undecided decision after classification.
- The business owner delegated classification authority for this checkpoint.
  The preservation policy classified 421 rows across 22 principals as
  `REGRANT`; the remaining 46 rows were classified `DROP`. The source contains
  one Permission Admin principal and the approved regrant subset contains zero
  Permission Admin principal, so the sensitive self-regrant blocker is closed
  without creating a second operator.
- Safe manifest fingerprints are source
  `a3d0cf9514e487111c5ae27873c8f6cd` and regrant
  `00a8f7f0f3a39721474a582592cf0b2e`. The private directory is mode `0700` and
  its identity-bearing raw export and manifest are mode `0600`; neither path nor
  payload is stored in Git, this log or chat.
- A fresh read-only linked query at `2026-07-18T12:03:26+07:00` matched the
  source fingerprint and 467-row count exactly. The active non-sensitive set
  remains 2,177 rows with zero past-expiry row and fingerprint
  `7b6aa5192833101df63d74cd813eb510`; all three rollout flags remain `false`.
- No shared 90-day cutoff has been calculated, permission maintenance has not
  opened, and no Cloud grant, role, responsibility, flag or migration-history
  mutation occurred. Task 1 is complete and the next safe work is the two
  read-only Cloud gates; revoke mutation remains a separate checkpoint.
- At `2026-07-18T12:08:11+07:00`, the two read-only Cloud gates were committed
  as `46b403aaa84a7d1dbef7b7d34ea685d4323dd8e4`. Static verification found no
  mutation statement; both files use explicit `BEGIN`/`ROLLBACK` boundaries.
  The zero-source gate reached the expected RED assertion with 467 active
  sensitive rows, and the final-regrant gate reached the expected RED assertion
  because the current active set does not match the approved 421-row subset.
  No Cloud mutation occurred during either RED proof.
- The operator subsequently delegated execution authority for the approved
  plan. Permission maintenance opened at `2026-07-18T12:10:00+07:00`; the
  shared regrant cutoff was fixed once at `2026-10-16T12:10:00+07:00`, exactly
  90 days later. Preflight revalidated the 467-row source and both fingerprints,
  found the same one durable operator, and confirmed unchanged baselines of two
  active Business Role assignments, three active responsibility slots, five
  active app assignments, zero maintenance-window direct-change audit events
  and all three rollout flags `false`.
- The approved revoke pilot contained two source rows. Authenticated backend
  preview returned zero hard deny and zero SoD warning, and one governed save
  reduced the global active-sensitive count from 467 to 465. Read-only evidence
  then showed zero active sensitive row for the pilot, two retained revoked
  rows with reason, exactly one new direct-change audit event, an unchanged
  active non-sensitive fingerprint, unchanged role/responsibility/app-assignment
  baselines and all three rollout flags `false`.
- An exact retry of the already-revoked pilot passed backend preview and save as
  a no-op. Fresh evidence at `2026-07-18T12:19:58+07:00` still showed 465 active
  sensitive rows and exactly one maintenance-window direct-change audit event.
  No regrant has occurred.
- Revoke batch 1 processed the next three non-operator principals and eight
  source rows through authenticated backend preview and governed saves. Fresh
  read-only evidence at `2026-07-18T12:34:28+07:00` showed 457 active sensitive
  rows globally, zero remaining active sensitive row for the batch, eight
  retained revoked rows with reason, three batch audit events and four total
  maintenance-window direct-change events. The non-sensitive fingerprint,
  role/responsibility/app-assignment baselines and all three `false` rollout
  flags remained unchanged. No regrant has occurred.
- Revoke batch 2 processed three further non-operator principals and 13 source
  rows. At `2026-07-18T12:36:24+07:00`, read-only evidence showed 444 active
  sensitive rows globally, zero remaining active sensitive row for the batch,
  13 retained revoked rows with reason, three batch audit events and seven total
  maintenance-window direct-change events. The non-sensitive fingerprint,
  role/responsibility/app-assignment baselines and all three `false` rollout
  flags remained unchanged. No regrant has occurred.
- Revoke batch 3 processed three non-operator principals and 54 source rows. At
  `2026-07-18T12:38:37+07:00`, read-only evidence showed 390 active sensitive
  rows globally, zero remaining active sensitive row for the batch, 54 retained
  revoked rows with reason, three batch audit events and ten total
  maintenance-window direct-change events. The non-sensitive fingerprint,
  role/responsibility/app-assignment baselines and all three `false` rollout
  flags remained unchanged. No regrant has occurred.
- Revoke batch 4 processed three non-operator principals and 69 source rows. At
  `2026-07-18T12:40:44+07:00`, read-only evidence showed 321 active sensitive
  rows globally, zero remaining active sensitive row for the batch, 69 retained
  revoked rows with reason, three batch audit events and 13 total
  maintenance-window direct-change events. The non-sensitive fingerprint,
  role/responsibility/app-assignment baselines and all three `false` rollout
  flags remained unchanged. No regrant has occurred.
- Revoke batch 5 processed three non-operator principals and 69 source rows. At
  `2026-07-18T12:43:10+07:00`, read-only evidence showed 252 active sensitive
  rows globally, zero remaining active sensitive row for the batch, 69 retained
  revoked rows with reason, three batch audit events and 16 total
  maintenance-window direct-change events. The non-sensitive fingerprint,
  role/responsibility/app-assignment baselines and all three `false` rollout
  flags remained unchanged. No regrant has occurred.
- Revoke batch 6 processed three non-operator principals and 79 source rows. At
  `2026-07-18T12:46:39+07:00`, read-only evidence showed 173 active sensitive
  rows globally, zero remaining active sensitive row for the batch, 79 retained
  revoked rows with reason, three batch audit events and 19 total
  maintenance-window direct-change events. The non-sensitive fingerprint,
  role/responsibility/app-assignment baselines and all three `false` rollout
  flags remained unchanged. No regrant has occurred.
- Revoke batch 7 processed the final three non-operator principals and 127
  source rows. At `2026-07-18T12:49:51+07:00`, read-only evidence showed 46
  active sensitive rows globally, zero remaining active sensitive row for the
  batch, 127 retained revoked rows with reason, three batch audit events and 22
  total maintenance-window direct-change events. The remaining 46 rows are the
  source rows of the sole Permission Admin, intentionally reserved for the final
  revoke save. The non-sensitive fingerprint, role/responsibility/app-assignment
  baselines and all three `false` rollout flags remained unchanged. No regrant
  has occurred.
- The sole Permission Admin was processed last: authenticated preview returned
  zero hard deny and zero warning, and one governed save revoked its final 46
  source rows. An immediate fresh page/session still exposed permission
  governance and authenticated no-op backend preview passed, proving the
  unchanged legacy-governance fallback remained usable.
- Revoke-phase arithmetic at `2026-07-18T12:52:13+07:00` showed zero active
  sensitive direct grant, all 467 source rows retained as revoked history with
  reason, exactly 23 revoke audit events, zero regrant event, the unchanged
  non-sensitive fingerprint, unchanged role/responsibility/app-assignment
  baselines and all three rollout flags `false`. The private zero-source gate
  then passed checkpoint
  `authorization_sensitive_grant_revoke_all_gate_passed`. No regrant has yet
  occurred.
- Before Task 4, the private manifest validator again matched 467 source rows,
  421 approved regrant rows across 22 principals, 46 drops, zero undecided row,
  zero Permission Admin regrant principal, both approved fingerprints and the
  shared 90-day cutoff. The zero-source gate was rerun and passed again.
- Regrant pilot preview exposed two client safety defects before any save: the
  direct-grant draft could retain the prior principal state, and overlapping
  page/detail loads could mount a newly selected principal against stale grant
  data. Backend preview rejected the invalid draft, so no Cloud regrant or audit
  event was created. Regression coverage and fail-closed principal/detail load
  gates were added locally; targeted tests and TypeScript passed.
- Reloading the corrected UI returned Chrome to the login screen. Maintenance
  therefore remains open at the immutable zero-source checkpoint, and Task 4 is
  blocked before its first mutation until the Permission Admin reauthenticates.
  No service-role, direct SQL or rollout-flag bypass was used.
- Task 4 resumed after Permission Admin reauthentication. A fresh read-only
  preflight again matched the 467-row source manifest, the 421-row approved
  regrant set across 22 principals, the 46-row drop set, both approved
  fingerprints, the shared 90-day cutoff and the zero-source gate. The
  non-sensitive fingerprint and role/responsibility/app-assignment baselines
  were unchanged, and all three rollout flags remained `false`.
- The two-row pilot was previewed with zero hard deny and zero warning, then
  saved once through the governed authenticated UI with reason
  `Task 13 Step 5: tái cấp quyền nhạy cảm đã được phê duyệt`. Read-only Cloud
  evidence confirmed exactly two active pilot rows, the shared cutoff and one
  regrant audit event. An immediate identical retry remained a no-op: the audit
  count, `granted_at` values and expiries did not change.
- Regrant batches 1 and 2 completed six further principals and 21 approved
  rows. The first principal in batch 3 completed another eight approved rows.
  At `2026-07-18T14:24:41+07:00`, the cumulative state was 31 active sensitive
  rows across eight regranted principals and eight regrant audit events. Every
  active sensitive row belongs to the approved manifest and has the exact
  shared cutoff; active unapproved rows and wrong-cutoff rows are both zero.
  The 2,177-row non-sensitive fingerprint remains
  `7b6aa5192833101df63d74cd813eb510`, no non-sensitive row has a past expiry,
  and all three rollout flags remain `false`.
- The remaining two principals in batch 3 each produced one backend SoD
  warning. No warning acceptance was present in the approved handoff, so the
  UI validation blocked both saves; no Cloud row or audit event was created for
  either principal. Task 4 is paused fail-closed with 390 approved rows across
  14 principals still pending. Resumption requires explicit acceptance evidence
  for each warning: an independent control owner, a reason, compensating
  controls and a future acceptance expiry. No control owner or evidence was
  inferred, and later batches were not started.
- A temporary local diagnostic log used to prove the browser datetime event
  boundary was reverted immediately. No service-role/direct-SQL grant mutation,
  rollout-flag mutation, Permission Admin regrant or resolver enablement was
  performed.
- After the operator approved continuing with every principal that could pass
  cleanly, the remaining principals were previewed sequentially in bounded
  groups without accepting any warning. Two further clean principals were
  saved through the governed UI, adding 72 approved rows and two audit events;
  every warned principal remained unsaved.
- At `2026-07-18T14:54:12+07:00`, cumulative Task 4 evidence showed 103 active
  sensitive rows across ten principals, exactly ten regrant audit events, zero
  active key outside the approved manifest and zero wrong-cutoff row. The
  2,177-row non-sensitive fingerprint remained
  `7b6aa5192833101df63d74cd813eb510`; active Business Role assignments,
  responsibility slots and app assignments remained `2`, `3` and `5`; the
  durable rollout-operator count remained `1`; and all rollout flags remained
  `false`.
- All 12 remaining approved principals, covering 318 approved rows, produced
  one SoD warning each. A read-only eligibility check found zero active Auditor
  other than the current actor who can serve as an independent control owner.
  The backend therefore cannot accept these warnings under the current
  authorization state. Completing Task 4 now requires a separately approved,
  governed appointment of an independent Auditor/control owner, followed by a
  fresh preview of all 12 principals. No Auditor assignment was inferred or
  created in this maintenance task.

## Authorization View+Audit readiness forward migration

- At `2026-07-18T19:39:41+07:00`, Phase 02 closure Task 1 applied exactly
  migration version `20260718123119_authorization_audit_readiness.sql`
  (SHA-256 `50210c1e3f31be7e8078047bbc24b7dfabb9c99e6cd0cbe997c36131e44e466a`).
- Local TDD evidence first proved RED with no matching migration, then GREEN
  passed the focused suite: three test files, nine tests. `git diff --check`
  exited `0`.
- The rollback-only linked Cloud smoke concatenated the migration and
  `authorization_audit_readiness_smoke.sql` inside `BEGIN`/`ROLLBACK`; it
  reached checkpoint `authorization_audit_readiness_smoke_passed`. Post-rollback
  read-only evidence still showed both `system.authorization.view` and
  `system.authorization.audit` as `declared`, readiness
  `231 declared / 59 legacy / 11 verified`, active Direct Grants `2280`, and
  all four rollout flags `false`.
- After explicit operator approval, the exact migration was applied in one
  linked transaction and reached checkpoint
  `authorization_audit_readiness_migration_applied`. Exactly version
  `20260718123119` was repaired to `applied`, and linked migration history now
  aligns local and remote for that version. No `db push` was used.
- Post-apply rollback smoke again reached
  `authorization_audit_readiness_smoke_passed`. Read-only evidence shows only
  `system.authorization.view` and `system.authorization.audit` promoted to
  `verified`; readiness is now `229 declared / 59 legacy / 13 verified`, active
  Direct Grants remain `2280`, and all four rollout flags remain `false`.
- The smoke proved an Audit-only fixture can read unrelated authorization audit
  events while an ungranted fixture cannot; the Audit fixture still cannot
  insert, update or delete audit rows and cannot manage Business Roles or
  Direct Grants. Fixture identities and raw payloads were not recorded.
- No user grant, Business Role assignment, responsibility slot, app assignment
  or rollout flag was changed by this checkpoint. The temporary Direct
  View+Audit bridge for an independent control owner remains a separate
  approval boundary.

## Independent control-owner appointment

- At `2026-07-18T20:06:43+07:00`, after explicit operator approval, Phase 02
  closure Task 2 selected one active non-Admin, least-privilege control owner
  through read-only filtering. The identity remains private runtime state; no
  user ID, email or raw permission payload is recorded here.
- Pre-save rollback preview passed with intent Direct Grants `2280 -> 2282`,
  active sensitive Direct Grants unchanged at `103`, Audit-capable actors
  `1 -> 2`, active Business Role assignments `2 -> 3`, and all four rollout
  flags still `false`.
- The approved Cloud Save ran once through governed authenticated RPCs:
  unified Direct Grant Save for the temporary View+Audit bridge, followed by an
  expiring `AUDITOR` assignment at `global/*` through
  `2026-10-16T12:10:00+07:00`. Post-save evidence showed active Direct Grants
  `2282`, active sensitive Direct Grants `103`, active non-sensitive Direct
  Grants `2179`, non-sensitive fingerprint
  `632d0ce644dcec52126eabf7b44909ca`, Audit-capable actors `2`, active
  Business Role assignments `3`, and all four rollout flags still `false`.
- Fresh-session least-privilege verification passed: global View+Audit allowed;
  authorization audit rows and effective sources readable; no non-global
  authorization source present; manage roles, manage grants, manage scopes,
  override and business-approval permissions denied; governed mutation previews
  denied; and the Direct Save plus `AUDITOR` assignment each created exactly
  one audit event.
- Because `app_private.scope_covers` intentionally treats `global/*` as covering
  narrower requested scopes, the scope-negative evidence is recorded as zero
  non-global authorization sources rather than treating a covered narrow request
  as a failure. With the resolver flag still `false`, the staged `AUDITOR` role
  remains inactive as an effective source; current authorization evidence still
  comes from the temporary Direct bridge only.

## Task 3 readiness prerequisite — read-only preflight

- At `2026-07-18T22:03:44+07:00`, before any readiness migration or Cloud
  smoke, linked Cloud read-only evidence reconfirmed the immutable Task 3
  baseline: source `467 = 421 REGRANT + 46 DROP`; active sensitive grants
  `103` across `10` principals; pending approved rows `318` across `12`
  principals; zero sensitive null-expiry and zero active-sensitive rows outside
  the source set.
- The pending set remains blocked by `291` declared rows across exactly `21`
  permission codes; `27` rows are already verified. All `12` pending
  principals remain blocked, so no preview or Save was attempted.
- Active non-sensitive grants remain `2179` with fingerprint
  `632d0ce644dcec52126eabf7b44909ca`; Audit-capable actors remain `2`; active
  Business Role assignments remain `3`; active warning acceptances remain `0`;
  and all four rollout flags remain `false`.
- Required migrations `20260718092455` and `20260718123119` remain applied.
  The candidate Material smoke has SHA-256
  `35692118cdf689ea473cbbd3681322f33b779bd92347330245195bb06f5ee48a`
  at Git commit `7760d700082cac3ab7ef829ef35d98fccc26738b`.
- This is read-only evidence only. Cloud Gate A is still required before the
  smoke may execute inside `BEGIN`/`ROLLBACK`; it does not authorize creating,
  applying, or repairing a migration.
- At `2026-07-18T22:07:56+07:00`, after explicit Cloud Gate A approval, the
  linked rollback-only Material smoke stopped at
  `project.material_request.approve incorrectly bypassed workflow state`.
  The intended allow and wrong-project denial ran first; the negative assertion
  then proved that the current handler accepts `DRAFT -> APPROVED`.
- Root cause is the `APPROVED` path in
  `public.transition_project_material_request_status(...)`: it resolves the
  approval permission and performs the update without validating the source
  request status. Existing workflow runtime paths promote to `APPROVED` only
  from `PENDING`.
- Post-failure read-only evidence confirmed rollback: source `467`, approved
  regrant rows `421`, DROP rows `46`, active sensitive rows `103`, pending rows
  `318`, declared pending rows `291`, blocking codes `21`, verified readiness
  actions `13`, active warning acceptances `0`, and all four rollout flags
  `false`. No readiness migration was created, applied, or repaired; no
  principal preview or Save was attempted.
- Explicit Cloud Gate A2 ran the forward
  Material Request state-guard migration together with the Material smoke in
  one linked `BEGIN`/`ROLLBACK` transaction. The new guard denied
  `DRAFT -> APPROVED` as intended, then the smoke stopped at
  `project.material_po.approve incorrectly bypassed workflow state`: the PO
  handler accepted `in_transit -> confirmed`. The error rolled back the entire
  transaction; the forward guard migration remains absent from remote history.
- Post-Gate-A2 read-only aggregates show `2282` active Direct Grants, `103`
  active sensitive grants, readiness totals `229` declared / `59` legacy /
  `13` verified, zero active warning acceptances, and zero enabled hardening
  flags. Five hardening keys now exist, all `false`; the additional
  `legacy_fallback_disabled` key is separately tracked configuration drift,
  not a Gate-A2 mutation. No principal preview, Save, readiness
  promotion, migration-history repair, or rollout-flag mutation occurred.
- Cloud Gate A3 loaded both forward state guards with the Material smoke in a
  single linked rollback-only transaction. The PO guard rejected the smoke's
  purported intended allow because that fixture was still initialized as
  `draft`; the approved PO workflow requires `sent -> confirmed|returned`.
  The error rolled back the transaction before any PO state evidence could be
  promoted. Post-failure read-only aggregates remained `2282` active Direct
  Grants, `103` sensitive grants, readiness `229` declared / `59` legacy /
  `13` verified, zero warning acceptances and zero enabled hardening flags;
  neither forward migration is present in remote history. The smoke fixtures
  are corrected locally for a new, separately approved Cloud gate.
- Cloud Gate A4 ran the corrected smoke with both forward guards in one linked
  rollback-only transaction. Material Request and PO completed their intended
  allows plus scope, workflow-state and adjacent-action denials. The smoke then
  stopped at `project.custom_material.approve incorrectly bypassed workflow
  state`: the Custom Material handler accepted `draft -> approved`.
- Post-Gate-A4 read-only evidence remained `2282` active Direct Grants, `103`
  sensitive grants, readiness `229` declared / `59` legacy / `13` verified,
  zero warning acceptances and zero enabled hardening flags. The two forward
  guard migrations remain absent from remote history. No principal preview,
  Save, readiness promotion, migration-history repair, or rollout-flag change
  occurred.
- Cloud Gate A5 loaded all three forward Material state guards and completed
  `phase02_task3_material_readiness_smoke_passed` in one linked transaction
  before its outer rollback. Material Request, PO and Custom Material approval
  now each have passing intended allow, wrong-scope, workflow-state and
  adjacent-action evidence.
- Post-Gate-A5 read-only evidence remains `2282` active Direct Grants, `103`
  sensitive grants, readiness `229` declared / `59` legacy / `13` verified,
  zero warning acceptances and zero enabled hardening flags. All three forward
  migrations remain absent from remote history. No principal preview, Save,
  readiness promotion, migration-history repair, or rollout-flag change
  occurred.
- Cloud Gate A6R at `2026-07-18T23:12:09+07:00` loaded the Payment Certificate
  and Quantity Acceptance transition migration plus its smoke in one linked
  `BEGIN`/`ROLLBACK` transaction. It reached
  `phase02_task3_payment_quantity_readiness_smoke_passed` before rollback.
- Post-Gate-A6R aggregate evidence is unchanged: `2282` active Direct Grants,
  readiness `229` declared / `59` legacy / `13` verified, zero enabled
  hardening flags, zero remote history rows for migration `20260718155122`, and
  zero persisted Payment/Quantity transition RPC rows. No principal preview,
  Save, readiness promotion, migration-history repair, or rollout-flag change
  occurred.
- The evidence is complete for `project.payment.approve` and
  `project.quantity_acceptance.approve`, so both are recorded as local
  `CANDIDATE` codes only. Payment Verify, Payment Confirm and Quantity Verify
  still lack code-specific negative coverage and remain `declared`; a later
  rollback-only gate is required before any readiness migration is considered.
- Cloud Gate A7 at `2026-07-18T23:18:21+07:00` ran the expanded Payment and
  Quantity smoke in the same linked rollback-only posture and reached
  `phase02_task3_payment_quantity_readiness_smoke_passed`. It supplied the
  missing wrong-scope, draft-state and adjacent-action denials for Payment
  Verify, Payment Confirm and Quantity Verify.
- Post-Gate-A7 aggregates remain `2282` active Direct Grants, readiness `229`
  declared / `59` legacy / `13` verified, zero enabled hardening flags, zero
  history rows for migration `20260718155122`, and zero persisted transition
  RPC rows. All five runtime-backed Payment/Quantity codes are now evidence
  `CANDIDATE` only; their Cloud readiness stays `declared` and no principal
  preview, Save, migration apply/repair or rollout-flag mutation occurred.
- Cloud Gate A8 at `2026-07-18T23:25:15+07:00` loaded readiness migration
  `20260718161857` and its promotion smoke in one linked `BEGIN`/`ROLLBACK`
  transaction. The source migration SHA-256 was
  `293f04688c62bea5f9ae70d735b4be02c8bdbb282eaf0dfac5ea9d712481a0c1`, the
  smoke SHA-256 was
  `b43359079bee68c05b7955b4de8c76f22e3f2cf88d3591ed7625449ca37017da`, and the
  combined bundle SHA-256 was
  `5ad55a0d39799fd3afad1da3d0ff5d09c2653167d54228969d1fb192e6391a0e`.
  It reached `phase02_task3_payment_quantity_readiness_promotion_smoke_passed`
  before its outer rollback.
- The temporary promotion covered exactly Payment Verify, Payment Approve,
  Payment Confirm, Quantity Verify and Quantity Approve. Read-only
  post-rollback evidence confirms all five are again `declared`, Mark Paid
  remains `declared`, remote history for `20260718161857` remains zero, active
  Direct Grants remain `2282`, and zero hardening flags are enabled. No
  principal preview/Save, migration apply/history repair, grant, or rollout
  flag mutation occurred.
- Cloud Gate A9 at `2026-07-18T23:26:51+07:00` applied exactly migration
  `20260718161857` after a matching linked read-only preflight. The five
  approved runtime-backed Payment/Quantity candidates are now persistently
  `verified`; Payment Mark Paid remains `declared`.
- Post-apply read-only evidence confirms active Direct Grants remain `2282`
  and zero hardening flags are enabled. The direct apply intentionally did not
  mutate Supabase migration history, so remote history for `20260718161857`
  remains zero. No principal preview/Save, grant, rollout-flag mutation, or
  migration-history repair occurred; any history repair is separately owned
  and unapproved.
- Cloud Gate A10 at `2026-07-18T23:37:33+07:00` applied transition migration
  `20260718155122` (SHA-256
  `804728efc3fad0b10738ea8d423fff819ea79354680f11b1e9ac2c56bd7df0ef`) before
  a savepoint, then ran the Payment/Quantity smoke (SHA-256
  `2b7fa00ccfcb4195d279f81b9f658f5ea6ea304758372a91817b714cc782de5b`) after
  that savepoint. Bundle SHA-256 was
  `e2a0269bfe3b38538b5a3a186b191d2083fe585645013db8dd21cf40e10f8e3f`; the
  checkpoint `phase02_task3_payment_quantity_readiness_smoke_passed` was
  reached, all smoke fixture work rolled back to the savepoint, and the outer
  transaction committed only the runtime objects.
- Read-only post-apply evidence confirms both transition RPCs and private
  guards exist, with exact triggers on `payment_certificates` and
  `quantity_acceptances`. The five promoted codes remain `verified`, Payment
  Mark Paid remains `declared`, active Direct Grants remain `2282`, and zero
  hardening flags are enabled. Versions `20260718155122` and `20260718161857`
  remain absent from migration history. No principal preview/Save, grant,
  warning-acceptance, rollout-flag, readiness, or history mutation occurred
  beyond the approved runtime apply.
- Cloud Gate A11 at `2026-07-18T23:39:40+07:00` repaired exactly migration
  history versions `20260718155122` and `20260718161857` to `applied` on the
  linked Cloud project. No other version was included.
- Read-only post-repair evidence confirms one history row for each exact
  version; both transition RPCs and private guards remain present; the five
  Payment/Quantity codes remain `verified`; Payment Mark Paid remains
  `declared`; active Direct Grants remain `2282`; and zero hardening flags are
  enabled. No SQL migration body, principal preview/Save, grant,
  warning-acceptance, readiness, or rollout-flag mutation occurred.
- At `2026-07-18T23:41:25+07:00`, aggregate-only readiness recomputation
  retains `318` pending approved rows across `12` principals. Payment/Quantity
  promotion moved the grantable portion to `97`, leaving `221` declared rows
  across `16` blocking permission codes; all `12` principals remain blocked
  and zero have a complete grantable draft. Closure Task 3 stays paused: no
  principal preview or Save was attempted. The next focused tranche is the
  three Material approval codes with existing rollback-only evidence.
- Cloud Gate A12 at `2026-07-19T07:52:20+07:00` applied exactly the three
  Material state-guard migrations `20260718151157`, `20260718152445`, and
  `20260718154050`, plus readiness migration `20260719004803`, in one linked
  transaction. The four migration SHA-256 values were
  `40326b97017061db08091dfd1e64c7966c348414395d21ecb5a43b3ef44b4267`,
  `fb3c86e68926e2dd0b1b79ea92a61deb7cd794b8800b31b00ea064e10e7563d6`,
  `2639f8ca5ae102f2328d8811aaf15b066e0be654f6a21cb0a1f1bf78b080c01f`, and
  `c71ed87845b8f995f512e729205e57439d7dc94b52d05c5d33b5f043b33f236b`.
- Bundle SHA-256 was
  `f7cb79247e3060c976497c388092c17713296ccd6569def7fab56d7e7caa9c81`.
  The existing Material behavior smoke and the Material readiness-promotion
  smoke both passed inside savepoint `material_readiness_smoke`; their fixture
  work rolled back before the outer transaction committed only migration
  objects.
- Read-only postchecks confirm all three Material state guards persist; exactly
  three Material approval codes are `verified`; all five Payment/Quantity codes
  remain `verified`; Payment Mark Paid plus the two named Material exclusions
  remain `declared`; active Direct Grants remain `2282`; and zero hardening
  flags are enabled. The four A12 versions remain absent from remote migration
  history. No principal preview/Save, grant, warning, rollout-flag, or history
  mutation occurred beyond the approved A12 apply.

## Resolver enablement canary

- Status: **Pending behind the 318 approved regrant rows whose 12 principals
  require fresh SoD warning acceptance and the final sensitive-grant gate.** The
  independent Auditor/control owner now exists, but the resolver flag remains
  `false` until the regrant and final-gate checkpoints pass.
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
