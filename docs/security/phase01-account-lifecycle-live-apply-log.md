# Phase 01 Account Lifecycle — Live Apply Log

## Current status

- Status: **PASS by explicit operator acceptance; Phase 2 implementation authorized**
- Updated at: `2026-07-17T14:55:17+07:00`
- Branch: `refactor/module-du-an-v1`
- Verified remediation commit: `de8b22ffc3cf727aea4a5bd8d73b1275789169ad`
- Cloud mutations in this Task 7 session so far:
  - deleted the unsafe remote-only `delete-user` Edge Function;
  - revoked `lookup_login_email(text)` execution from `PUBLIC`, `anon` and
    `authenticated`;
  - repaired exactly migration-history version `20260715173948` as applied; and
  - redeployed only `manage-user-account` with the Auth password-length
    remediation.

Do not record access tokens, passwords, database URLs, emails, Auth IDs or
service-role values in this file.

## Operator evidence deferral and closure

At `2026-07-17T11:41:20+07:00`, the operator directed the roadmap to proceed to
planning the next phase without waiting for the Step 9 observation window or
executing Step 10 in this session. This is a planning-only waiver:

- the 24-hour production observation and Supabase Dashboard log review remain
  incomplete;
- the final verification and rollout-log commit remain incomplete;
- neither Step 9 nor Step 10 is marked as passed; and
- implementation of the next phase must preserve this outstanding evidence in
  its preflight rather than silently treating it as collected.

At `2026-07-17T14:27:38+07:00`, the operator superseded the planning-only
waiver by confirming that Phase 1 had been tested thoroughly, every Phase 1
behavior was currently OK, and Phase 1 was accepted as PASS. The operator
explicitly authorized Phase 2 implementation. This acceptance closes Steps 9
and 10 without claiming that the remaining elapsed portion of the 24-hour
window or unavailable Supabase Dashboard logs were collected. The historical
deferral above is retained so the evidence boundary remains auditable.

## Local verification

- Fresh closure rerun: `2026-07-17T14:54:51+07:00`.
- `npm test`: 161 test files, 934 tests passed.
- `npm run lint`: TypeScript exited `0`.
- `npm run build`: Vite exited `0`; the existing large-chunk warning remains.
- `git diff --check`: no findings.

## Phase 1 artifacts

- Active-actor migration: `20260716170338_active_actor_account_status.sql`.
- Account-lifecycle migration: `20260716170745_user_account_lifecycle_operations.sql`.
- Both versions are present in linked Cloud migration history.
- The pre-existing migration-history drift remains untouched.

## Rollback-only database smoke

The two Phase 1 migration files and both smoke files were rerun together with a
five-second local lock timeout in one linked Cloud transaction. The command
returned `phase01_rollback_smoke_passed` and then executed `rollback`; exit
status was `0`. This step did not mutate the committed schema or data.

Task 7 did not reapply or rerepair the two Phase 1 migrations: both had already
been atomically applied and were present in linked Cloud migration history.
Reapplying them would add risk without changing the verified target state.

## Read-only Cloud baseline

- Supabase CLI: `2.95.6` (the CLI reported a newer release is available; no
  upgrade was performed during the rollout audit).
- Active Auth users with anything other than exactly one active profile: `0`.
- Active profiles with a missing, deleted or nonexistent Auth identity: `0`.
- Authenticated policy rows in the active-actor surface snapshot: `1183`.
- Security-definer functions in the snapshot: `385`.
- Security-definer functions executable by `authenticated`: `283`.
- Executable security-definer functions without a statically detected active
  chain marker: `126`; the global PostgREST pre-request gate is configured and
  this count is inventory for later review, not by itself a bypass finding.
- `authenticator.pgrst.db_pre_request` rows pointing to
  `public.enforce_active_app_actor`: `1`.
- The surface snapshot initially failed because its PostgreSQL regex used a
  double-escaped opening parenthesis. A regression contract was added, the SQL
  was corrected locally, and the exact linked snapshot command then exited `0`.

### Resolved legacy-login ACL

The operator confirmed that the email-only frontend completed its required
production observation window successfully. The revoke migration was then run
first in a rollback-only transaction and reported:

- `PUBLIC EXECUTE`: `false`
- `anon EXECUTE`: `false`
- `authenticated EXECUTE`: `false`

The same migration was applied in its own explicit transaction. A fresh
connection reproduced `false/false/false`, after which exactly version
`20260715173948_revoke_legacy_login_lookup.sql` was repaired as applied in
linked Cloud migration history. No unrelated migration-history drift was
changed.

## Edge Function baseline

- `create-user`: deployed from the verified tree; active, version `19`, JWT
  verification enabled.
- `reset-password`: deployed from the verified tree; active, version `15`, JWT
  verification enabled.
- `manage-user-account`: deployed from the verified tree; active, version `2`,
  JWT verification enabled.
- `delete-user`: deleted after explicit operator approval; a fresh remote
  function listing confirmed it is absent.

The three initial functions were deployed sequentially with `--use-api`; no
unrelated function was deployed and `--prune` was not used. The CLI emitted a
non-failing fallback import-map warning for each deployment. The later
password-length remediation redeployed only `manage-user-account`.

### Resolved critical finding: legacy `delete-user`

The remote-only source was downloaded to a disposable audit directory. It:

- accepts `callerId` from the request body as an admin identity candidate;
- uses the service-role client after that check;
- deletes the linked Auth user; and
- hard-deletes `public.users`.

The current repository has no caller or local source for this function. Leaving
the remote endpoint active violated the no-actor-spoofing and no-hard-delete
account-lifecycle boundary. The operator explicitly approved immediate
fail-closed containment, and the remote function was deleted before rollout
continued.

## Hosting baseline

- `vercel.json` is present with the existing SPA rewrite.
- Git remote points to the existing GitHub repository.
- Vercel Git integration is confirmed for the branch preview. Public GitHub
  metadata reports `main` as the default branch, and the latest `Production`
  deployment references the exact current `origin/main` commit. This identifies
  `main` as the existing production path. The 24-hour production observation
  evidence has not yet started. No second hosting path was introduced.

## Vercel preview publication

- Branch: `refactor/module-du-an-v1`.
- Canary commit: `454db6a2adf115586a4f99527581752e53817aca`.
- Git push completed without force at `2026-07-17T10:02+07:00`.
- GitHub deployment environment: `Preview`.
- Vercel status: `success` — `Deployment has completed` at
  `2026-07-17T10:02:41+07:00`.
- Preview URL:
  `https://khotienthinh-7h2bfxxjk-hoangnvthkts-projects.vercel.app`.
- An unauthenticated HTTP check returned `302` to Vercel SSO, confirming that
  Deployment Protection is enabled. The current execution environment had no
  signed-in browser session, so no interactive preview canary was attempted.
- The operator initially reported that the manual preview flow had passed. A
  later concrete disable attempt exposed an `AUTH_RETRY` operation, so that
  blanket attestation is superseded and Step 8 is reopened pending retry and
  read-only Cloud verification.
- A read-only lookup for the separately supplied permission-test account found
  zero lifecycle operations, zero lifecycle audit events and zero `AUTH_RETRY`
  operations. That account therefore provides permission-navigation evidence,
  not the disposable disable/reactivate canary required by Step 8.

No production promotion was performed.

The remediation commit
`de8b22ffc3cf727aea4a5bd8d73b1275789169ad` was pushed without force to the
same preview branch after a fresh 934-test, lint and build verification. Vercel
reported `Deployment has completed` with `success` at
`2026-07-17T10:51:00+07:00` for the exact commit. Remediation preview URL:
`https://khotienthinh-l6q12xci5-hoangnvthkts-projects.vercel.app`.

## Step 9 production checkpoint inventory

- The public repository default branch is `main`.
- The latest GitHub `Production` deployment references the exact current
  `origin/main` commit, confirming the existing production path.
- `origin/main` is an ancestor of the remediation canary commit.
- The canary branch is 24 commits ahead of `origin/main`, with an aggregate
  delta of 88 files, 18,315 insertions and 1,960 deletions.

Promoting the exact canary commit deployed the complete 24-commit branch delta,
not only the account-lifecycle commits. The operator explicitly approved this
material production checkpoint after reviewing the delta. No cherry-pick,
force-push, merge commit or alternate rebuild was used.

## Production deployment and observation

- Fresh pre-push verification: 161 test files and 934 tests passed; TypeScript
  lint exited `0`; Vite build exited `0`; `git diff --check` had no findings.
- `main` fast-forwarded without force from
  `3aafb5ed222456e997313e7d992af1e4e80e6a8e` to the exact canary commit
  `de8b22ffc3cf727aea4a5bd8d73b1275789169ad`.
- A fresh fetch confirmed both `origin/main` and the preview branch point to the
  exact same commit.
- Vercel Production reported `Deployment has completed` with `success` at
  `2026-07-17T11:14:57+07:00`.
- Production deployment URL:
  `https://khotienthinh-c4yasw5su-hoangnvthkts-projects.vercel.app`.
- An unauthenticated HTTP check returned `302` to Vercel SSO, so Deployment
  Protection remains enabled on the deployment URL.
- Observation window: `2026-07-17T11:14:57+07:00` through at least
  `2026-07-18T11:14:57+07:00`.

T0 read-only Cloud baseline after production success:

- `manage-user-account`: active version `2`, JWT verification enabled.
- Current `AUTH_RETRY` profiles: `0`.
- Current `AUTH_RETRY` lifecycle operations: `0`.
- Lifecycle operations created since production success: `0`.
- `account_auth_retry_required` events since production success: `0`.
- Active direct grants, project staff, responsibility slots or runtime
  assignments attached to inactive accounts: `0` for every source.
- Responsibility slots marked `needsReassignment`: `1`, originating from the
  disposable canary and requiring normal operational reassignment.
- Runtime assignments marked `needsReassignment`: `0`.

The installed Supabase CLI exposes no Edge invocation or PostgREST log-reading
command, and no Supabase log connector is available in this execution
environment. `manage-user-account` invocation/failure counts, PostgREST
`Active application account required` denials and unexpected active-user
denials must therefore be reviewed in the Supabase Dashboard logs over the same
24-hour window; they are not inferred from database counters.

## Disposable-account canary

Result: **PASS — operator functional confirmation plus read-only Cloud lifecycle
evidence, with the documented legacy-discoverability caveat** at
`2026-07-17T11:03:05+07:00`.

A concrete disable attempt completed the database revocation but failed at the
Supabase Auth update. Read-only Cloud evidence showed:

- the application profile was `DISABLED` and inactive;
- the profile and latest lifecycle operation were `AUTH_RETRY` for `DISABLE`;
- the linked Auth identity still existed and was not yet banned; and
- the stored safe error matched Supabase Auth's 72-character password limit.

Root-cause tracing found that the Edge Function generated a 78-character
revocation password from two UUIDs plus a complexity suffix. A TDD regression
test reproduced the exact length failure. Commit
`de8b22ffc3cf727aea4a5bd8d73b1275789169ad` now generates one UUID plus the
suffix (40 characters), and only `manage-user-account` was redeployed as active
version `2` with JWT verification enabled.

After the operator retried, fresh read-only Cloud evidence confirmed:

- `DISABLE` completed with `banned_password_rotated`, cleared its error and
  recorded revocation of 149 direct grants, three project-staff rows and one
  responsibility slot;
- `REACTIVATE` completed with `unbanned_password_reset` and cleared its error;
- the profile is now `ACTIVE`, active, `IDLE` and role `EMPLOYEE`; and
- active direct grants, project staff, responsibility slots and runtime
  assignments are all zero.

The operator then assigned exactly one new capability through the existing UI
and confirmed that capability worked, an adjacent unassigned capability was
denied, and no previous rights returned. Before the next disable, Cloud captured
exactly one `allowedModules` compatibility entry and zero active PBAC direct
grants. This is not represented as a successful new-only PBAC persistence test:
it is the same known legacy-discoverability boundary recorded below. The
operator had already directed that out-of-Phase-1 finding to be documented and
deferred rather than used to silently recreate old rights.

The operator disabled the account again after that functional check. Fresh
Cloud evidence confirms the latest `DISABLE` completed with
`banned_password_rotated`, the application profile is `DISABLED`, Supabase Auth
is currently banned, and active direct grants, project staff, responsibility
slots and runtime assignments are all zero. Together with the operator's
positive/negative permission check, this closes Step 8 for the Phase 1 account
lifecycle scope while preserving the explicit legacy compatibility caveat.

## Deferred permission-discovery finding (outside Phase 1)

During operator testing, a user with new scoped permission grants did not see
the expected module/home entry until legacy module/submodule assignments were
also selected. The disposable account identifier is intentionally omitted from
this log.

Earlier read-only Cloud evidence confirmed that scoped permission grants could
be saved and active. The final post-reactivation functional check, however, was
persisted as one legacy `allowedModules` entry with zero active PBAC direct
grants. Static data-flow tracing identified the compatibility boundary:

- authentication loads active `user_permission_grants` into the current user;
- route and sidebar authorization use the unified permission resolver; but
- Home capabilities, module data loading and shortcuts still call
  `lib/homeCapabilities.ts`, whose `canUseModule` reads only legacy
  `allowedModules`.

The Phase 5 hardening contract explicitly lists `lib/homeCapabilities.ts` as an
allowed legacy consumer pending module readiness. This is therefore not an
Account Lifecycle/active-actor defect and must not be worked around by silently
recreating legacy grants. Track removal of this dependency in the Phase 3
Controlled Legacy Migration and Phase 5-7 module rollout plans, with tests that
prove a scoped new `view` grant makes the correct module entry discoverable
without legacy fields.

This finding did not prevent the operator from confirming Step 8 item 10: the
newly granted permission itself became effective without restoring prior
rights. It remains a separate discoverability/legacy-consumer gap for the Phase
3 Controlled Legacy Migration and Phase 5-7 module rollout; those phases must
still migrate Home navigation and module data loading to the unified resolver.

## Completed checkpoint decisions

1. The operator approved deleting the remote-only `delete-user` Edge Function;
   containment is complete and remotely verified.
2. The operator confirmed the required email-only production observation;
   revoke apply, fresh ACL verification and single-version history repair are
   complete.
3. Task 7 may proceed to Step 3 rollback-only migration/smoke execution. Git
   push was later explicitly approved. Step 3, the Step 6 Edge deployments and
   the Step 7 branch preview publication are now complete.
4. The password-length remediation retry, subsequent reactivation, functional
   single-capability check and final disable are complete. Step 8 is closed with
   the documented legacy-discoverability caveat.
5. The operator approved the reviewed 24-commit exact-tree promotion. `main`
   was fast-forwarded without force to the canary SHA and Vercel Production
   succeeded. The mandatory 24-hour observation began after production.
6. The operator later confirmed all Phase 1 behavior was tested thoroughly and
   currently OK, accepted Phase 1 as PASS, waived the unelapsed remainder of
   the observation/Dashboard-log collection, and authorized Phase 2
   implementation.
