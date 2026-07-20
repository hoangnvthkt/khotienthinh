# VIOO Pilot Cutover and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute one auditable pilot maintenance event that establishes exactly one System Admin, installs Member application memberships and explicit permissions, enables global read-only System Admin oversight, clears Legacy/App Admin sources, and can restore the exact pre-cutover state when a defined hard failure occurs.

**Architecture:** An encrypted off-repo entitlement manifest is normalized and fingerprinted by both Node and Postgres. A governed Preview is read-only. Apply acquires a global advisory lock, revalidates readiness and fingerprints, stores a private immutable snapshot, updates roles/memberships/grants, clears Legacy arrays, enables hardening flags, audits, and emits refresh events in one database transaction. Rollback is separately governed, time-bounded, drift-protected, audited, and restores the exact snapshot plus flags.

**Tech Stack:** Supabase/Postgres, private schema, PL/pgSQL governed RPCs, RLS, SQL smoke tests, Node validation/export scripts, SHA-256 fingerprints, existing permission audit and realtime/session refresh mechanisms.

## Global Constraints

- This plan requires the foundation and enforcement exit gates to pass first.
- Plan approval does not authorize production mutation. Request approval for the exact production packet after rehearsals.
- The real manifest and snapshot contain sensitive entitlement/user data. Never commit them, print them to Codex output, or store them in an unencrypted workspace path.
- Snapshot is required both inside the private database cutover record and as an independently verified encrypted external artifact.
- Apply and rollback are all-or-nothing transactions. No per-user partial success.
- Preview is read-only and cannot create an operation row, audit row, membership, or grant.
- Apply requires the exact approved manifest fingerprint, expected pre-state fingerprint, reason, maintenance ticket/reference, and idempotency key.
- Apply sets `legacy_fallback_disabled=true` and `admin_business_approval_bypass_disabled=true`. It preserves the approved `business_role_resolver_enabled` value rather than toggling it accidentally.
- Legacy arrays are cleared as active authorization sources but their pre-state remains in the immutable snapshot for the short recovery window.
- Rollback is allowed only before the retention deadline and only when the current authorization fingerprint equals the recorded cutover post-state. Drift blocks automatic rollback.
- Re-adding an application never resurrects pre-cutover Legacy or revoked Direct Grants.
- The target manifest contains exactly one `SYSTEM_ADMIN`; that account has no membership rows.
- System Admin receives global read-only and configuration-allowlist sources, but no implicit business mutation source.
- The target state contains no Application Administrator role, access level, assignment, source, or UI payload.
- Cloud migration/apply/history operations require exact hashes and separate approval.

---

## File Structure

**Create:**

- `scripts/authorization/export-pilot-legacy-snapshot.mjs`
- `scripts/authorization/verify-cutover-artifact.mjs`
- `supabase/tests/pilot_authorization_cutover_smoke.sql`
- `supabase/tests/pilot_authorization_cutover_rollback_smoke.sql`
- `docs/security/pilot-authorization-cutover-runbook.md`
- `docs/security/pilot-authorization-postcutover-checklist.md`
- migrations created by CLI for operation schema, commands, and post-cutover Legacy-source guard.

**Modify:**

- `lib/permissions/applicationMembershipTypes.ts`
- `lib/permissions/applicationMembershipService.ts` or a new cutover-only admin service if UI invocation is approved
- `lib/permissions/authorizationGovernanceTypes.ts`
- `supabase/tests/phase5_no_legacy_fallback_smoke.sql`
- `supabase/tests/phase5_permission_health_smoke.sql`

Production execution should use reviewed SQL/RPC tooling, not an ordinary browser button.

---

### Task 1: Define Cutover Operation, Snapshot, and State Fingerprints

**Files:**
- Create via CLI: migration named `pilot_authorization_cutover_operations`
- Create: `supabase/tests/pilot_authorization_cutover_smoke.sql`

- [ ] **Step 1: Inspect CLI and create the migration**

```bash
npx supabase migration new --help
npx supabase migration new pilot_authorization_cutover_operations
rg --files supabase/migrations | rg '/[0-9]+_pilot_authorization_cutover_operations\.sql$'
```

- [ ] **Step 2: Write failing schema and privilege assertions**

Assert operation/snapshot tables do not exist before implementation; afterward require private schema ownership, no `anon`/`authenticated` table privileges, immutable snapshots, unique idempotency key, status checks, and retention deadline.

- [ ] **Step 3: Create private operation metadata**

```sql
create table app_private.authorization_cutover_operations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  status text not null check (status in ('APPLIED','ROLLED_BACK')),
  requested_by uuid not null references public.users(id),
  reason text not null,
  change_reference text not null,
  manifest_fingerprint text not null,
  before_fingerprint text not null,
  after_fingerprint text not null,
  snapshot_fingerprint text not null,
  applied_at timestamptz not null default now(),
  rollback_deadline timestamptz not null,
  rolled_back_at timestamptz,
  rolled_back_by uuid references public.users(id),
  rollback_reason text,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 4: Create immutable private snapshot storage**

Snapshot JSON contains only the exact rows required for recovery:

```json
{
  "users": [{
    "id":"uuid",
    "role":"EMPLOYEE",
    "allowedModules":[],
    "allowedSubModules":{},
    "adminModules":[],
    "adminSubModules":{},
    "assignedWarehouseId":null
  }],
  "memberships": [],
  "activeGrants": [],
  "rolloutFlags": {}
}
```

Use a one-to-one snapshot table keyed by operation ID with `jsonb` payload, SHA-256, created timestamp, and trigger that rejects UPDATE/DELETE. Revoke direct privileges from public roles.

- [ ] **Step 5: Implement deterministic authorization-state fingerprint**

Hash sorted active-user role/Legacy fields, active memberships, active grants, and relevant rollout flags. Exclude volatile timestamps except where semantically part of a grant. Use the same normalization keys in Preview, Apply, status, and rollback.

- [ ] **Step 6: Verify and commit**

```bash
npx supabase db reset
npx supabase test db supabase/tests/pilot_authorization_cutover_smoke.sql
git add supabase/migrations/*_pilot_authorization_cutover_operations.sql supabase/tests/pilot_authorization_cutover_smoke.sql
git commit -m "feat: add pilot cutover operation snapshots"
```

---

### Task 2: Implement Read-only Cutover Preview

**Files:**
- Create via CLI: migration named `pilot_authorization_cutover_preview`
- Modify: `supabase/tests/pilot_authorization_cutover_smoke.sql`

**Public RPC:**

```sql
public.preview_pilot_authorization_cutover(
  p_manifest jsonb,
  p_expected_manifest_fingerprint text
) returns jsonb
```

- [ ] **Step 1: Add failing Preview tests**

Cover unauthorized actor, malformed manifest, fingerprint mismatch, missing one of 42 active users, duplicate user, zero or two `SYSTEM_ADMIN` rows, System Admin membership, unknown/inactive account, unknown app/code/scope, missing mutation assignment, declared/legacy permission, sensitive self-grant, and Member membership/action mismatch.

- [ ] **Step 2: Reuse the readiness gate**

Call the private implementation behind `preview_pilot_permission_readiness`; do not duplicate business validation logic.

- [ ] **Step 3: Require complete active-user coverage**

Preview compares normalized manifest user IDs with every active `public.users` row. Extra inactive users or missing active users are hard denies. This prevents leaving a Legacy-only user behind.

- [ ] **Step 4: Return aggregate plan only**

```json
{
  "manifestFingerprint":"...",
  "beforeFingerprint":"...",
  "activeUserCount":42,
  "membershipCount":0,
  "grantCount":0,
  "legacyUsersToClear":0,
  "keeperRolesToConvert":0,
  "systemAdminCount":1,
  "systemAdminReadWorkflowCount":0,
  "sensitiveGrantCount":0,
  "hardDenies":[],
  "warnings":[]
}
```

Do not return raw user/grant rows.

- [ ] **Step 5: Prove Preview is mutation-free**

Compare operation, snapshot, membership, grant, audit, and refresh-event counts before/after.

- [ ] **Step 6: Verify and commit**

```bash
npx supabase db reset
npx supabase test db supabase/tests/pilot_authorization_cutover_smoke.sql
git add supabase/migrations/*_pilot_authorization_cutover_preview.sql supabase/tests/pilot_authorization_cutover_smoke.sql
git commit -m "feat: preview pilot authorization cutover"
```

---

### Task 3: Implement Atomic Cutover Apply

**Files:**
- Create via CLI: migration named `pilot_authorization_cutover_apply`
- Modify: `supabase/tests/pilot_authorization_cutover_smoke.sql`

**Public RPC:**

```sql
public.apply_pilot_authorization_cutover(
  p_manifest jsonb,
  p_manifest_fingerprint text,
  p_expected_before_fingerprint text,
  p_reason text,
  p_change_reference text,
  p_idempotency_key uuid,
  p_rollback_retention interval default interval '72 hours'
) returns jsonb
```

- [ ] **Step 1: Add failing Apply tests**

Cover missing reason/reference, unauthorized actor, self-sensitive grant, stale pre-state, manifest mismatch, active-user drift, readiness regression, duplicate idempotency mismatch, mid-command forced exception, and second successful retry with the same key.

- [ ] **Step 2: Lock the maintenance boundary**

Acquire a transaction-scoped advisory lock such as `hashtextextended('vioo_pilot_authorization_cutover', 0)`, then lock all active user authorization rows, membership rows, active grants, and hardening flag rows used in the fingerprint.

- [ ] **Step 3: Snapshot before mutation**

Insert operation/snapshot only after all validation passes but before state changes, in the same transaction. Compute and store the snapshot fingerprint independently from the state fingerprint.

- [ ] **Step 4: Apply target state in deterministic order**

1. Map manifest account role `SYSTEM_ADMIN -> ADMIN`, `MEMBER -> EMPLOYEE` and require exactly one ADMIN target.
2. Convert all existing `WAREHOUSE_KEEPER` users to `EMPLOYEE`; their WMS responsibilities/grants come from the manifest.
3. Revoke existing active memberships not in target; upsert target memberships.
4. Revoke existing active Direct Grants not in target; insert target grants with governed metadata.
5. Preserve canonical subject assignments; do not fabricate them from membership.
6. Clear `allowed_modules`, `admin_modules`, `allowed_sub_modules`, `admin_sub_modules` for every active user.
7. Set `legacy_fallback_disabled=true` and `admin_business_approval_bypass_disabled=true`; preserve the approved business-role flag.
8. Append one cutover audit summary and per-user aggregate audit entries without exposing the full manifest.
9. Emit authorization refresh events for every active user.
10. Recompute post-state fingerprint and store it.

- [ ] **Step 5: Assert postconditions inside Apply**

Before commit, hard-fail unless:

- zero active user has nonempty Legacy arrays;
- zero effective source is `LEGACY`;
- all target memberships/grants exist exactly once;
- no unexpected active membership/grant remains;
- no `WAREHOUSE_KEEPER` active role remains;
- required hardening flags are true;
- exactly one active ADMIN remains and it has no membership row;
- every required System Admin read workflow resolves `SYSTEM_ADMIN_VIEW` globally;
- only allowlisted configuration resolves `SYSTEM_ADMIN_CONFIGURATION`;
- no business mutation resolves from System Admin role alone;
- zero effective source is `APP_ADMIN`;
- audit and refresh counts equal expected active-user coverage.

- [ ] **Step 6: Prove transactional rollback on forced failure**

Use a test-only transaction-local setting checked before final postcondition. Raise an exception and assert users, roles, Legacy fields, memberships, grants, flags, operation, snapshot, audit, and events all remain unchanged.

- [ ] **Step 7: Verify and commit**

```bash
npx supabase db reset
npx supabase test db supabase/tests/pilot_authorization_cutover_smoke.sql
git add supabase/migrations/*_pilot_authorization_cutover_apply.sql supabase/tests/pilot_authorization_cutover_smoke.sql
git commit -m "feat: apply atomic pilot authorization cutover"
```

---

### Task 4: Implement Drift-protected Emergency Rollback

**Files:**
- Create via CLI: migration named `pilot_authorization_cutover_rollback`
- Create: `supabase/tests/pilot_authorization_cutover_rollback_smoke.sql`

**Public RPC:**

```sql
public.rollback_pilot_authorization_cutover(
  p_operation_id uuid,
  p_expected_after_fingerprint text,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
```

- [ ] **Step 1: Write failing rollback tests**

Reject wrong actor, wrong operation, expired deadline, wrong fingerprint, post-cutover drift, already rolled back mismatch, missing reason, and snapshot hash mismatch.

- [ ] **Step 2: Verify snapshot integrity before restore**

Recompute snapshot SHA-256 from immutable payload and compare stored fingerprint. A mismatch is a hard stop requiring manual incident response.

- [ ] **Step 3: Restore exact pre-state**

Under the same global advisory lock:

- restore roles/Legacy fields/warehouse compatibility field from snapshot;
- revoke current memberships/grants and restore snapshot active rows with original semantic timestamps/expiry/reasons where safe;
- restore rollout flags;
- append rollback audit;
- emit refresh for all restored active users;
- mark operation `ROLLED_BACK`.

Do not delete the operation or snapshot.

- [ ] **Step 4: Prove exact fingerprint restoration**

After rollback, the current state fingerprint must equal the original `before_fingerprint`. Run Legacy fallback/effective-source checks proving the recovered operating mode works.

- [ ] **Step 5: Prove drift blocks destructive overwrite**

After cutover, create one legitimate governed permission change, then attempt rollback. It must fail without altering any state.

- [ ] **Step 6: Verify and commit**

```bash
npx supabase db reset
npx supabase test db supabase/tests/pilot_authorization_cutover_smoke.sql
npx supabase test db supabase/tests/pilot_authorization_cutover_rollback_smoke.sql
git add supabase/migrations/*_pilot_authorization_cutover_rollback.sql supabase/tests/pilot_authorization_cutover_rollback_smoke.sql
git commit -m "feat: add protected pilot cutover rollback"
```

---

### Task 5: Build External Snapshot Export and Verification Tooling

**Files:**
- Create: `scripts/authorization/export-pilot-legacy-snapshot.mjs`
- Create: `scripts/authorization/verify-cutover-artifact.mjs`
- Test: `lib/__tests__/pilotCutoverArtifact.test.ts`

- [ ] **Step 1: Write failing artifact tests**

Cover canonical sorting/fingerprint, missing active user, duplicate grant, malformed Legacy maps, plaintext output refusal, encryption-command failure, checksum mismatch, and accidental output inside Git worktree.

- [ ] **Step 2: Implement explicit-path safety**

Require:

```text
--input-json <explicit read-only export>
--encrypted-output <explicit path outside repository>
--encryption-command <approved executable/config>
```

Reject missing/relative output paths, repository descendants, `$HOME`, `/`, globs, and existing files unless `--replace-exact-file` is supplied. Never print payload content.

- [ ] **Step 3: Emit a non-sensitive receipt**

The receipt may contain version, created time, active-user count, row counts, plaintext SHA-256, encrypted SHA-256, encryption method identifier, and output path basename. It must not contain IDs, names, email, grant codes by user, or the key.

- [ ] **Step 4: Implement independent verification**

Decrypt to a secure temporary directory created with `mktemp -d`, verify both hashes/schema/counts, then remove the exact temporary directory through a trap. Do not write decrypted data into the repo.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- lib/__tests__/pilotCutoverArtifact.test.ts
git add scripts/authorization/export-pilot-legacy-snapshot.mjs scripts/authorization/verify-cutover-artifact.mjs lib/__tests__/pilotCutoverArtifact.test.ts
git commit -m "feat: export encrypted permission rollback artifacts"
```

---

### Task 6: Add Post-cutover Legacy and Health Gates

**Files:**
- Modify: `supabase/tests/phase5_no_legacy_fallback_smoke.sql`
- Modify: `supabase/tests/phase5_permission_health_smoke.sql`
- Create via CLI: migration named `postcutover_legacy_source_guard`

- [ ] **Step 1: Extend no-Legacy smoke**

Assert hardening flag true, all active Legacy arrays empty, effective source query returns neither `LEGACY` nor `APP_ADMIN`, and resolver cannot be made to read Legacy by a browser/session setting.

- [ ] **Step 2: Add a post-cutover write guard**

Once fallback is disabled, a trigger rejects nonempty writes to the four Legacy authorization fields except the governed rollback command's transaction-local capability. Profile/account updates cannot repopulate Legacy.

- [ ] **Step 3: Extend permission health**

Report anything other than exactly one active System Admin, System Admin membership rows, orphan membership, inactive-user access, unknown app/code, unsupported scope, expired active grant, Member membership/grant mismatch, missing mutation assignment, sensitive self-grant, unexpected admin mutation source, missing System Admin global-view coverage, and unexpected admin bypass flag.

- [ ] **Step 4: Verify and commit**

```bash
npx supabase db reset
npx supabase test db supabase/tests/phase5_no_legacy_fallback_smoke.sql
npx supabase test db supabase/tests/phase5_permission_health_smoke.sql
git add supabase/migrations/*_postcutover_legacy_source_guard.sql supabase/tests/phase5_no_legacy_fallback_smoke.sql supabase/tests/phase5_permission_health_smoke.sql
git commit -m "fix: guard postcutover authorization health"
```

---

### Task 7: Write the Operator Runbook and Checklist

**Files:**
- Create: `docs/security/pilot-authorization-cutover-runbook.md`
- Create: `docs/security/pilot-authorization-postcutover-checklist.md`
- Test: `lib/__tests__/pilotCutoverRunbook.test.ts`

- [ ] **Step 1: Write a runbook contract test**

Require sections for authority, exact environment, freeze, preflight, migration hashes, external snapshot, Preview, Apply, verification, rollback thresholds, drift handling, communications, monitoring, retention, and unfreeze.

- [ ] **Step 2: Define hard rollback thresholds**

Rollback immediately when any occurs before unfreeze:

- Apply/postcondition transaction fails;
- any active user is missing from target state;
- any effective `LEGACY` source remains;
- System Admin cannot administer accounts/apps/configuration;
- System Admin cannot read a required record outside project/warehouse/department assignment;
- System Admin can mutate business data without an explicit grant and required relationship;
- ordinary Member gains an unassigned project/warehouse/business record;
- System Admin gains or self-grants a sensitive business action;
- required pilot route/backend operation is denied for its approved user;
- audit/refresh counts are incomplete;
- post-state fingerprint differs from Apply result.

Cosmetic layout issues and a single noncritical label defect do not trigger authorization rollback; record and hotfix separately.

- [ ] **Step 3: Define user archetype checks**

At minimum:

1. System Admin all-app and cross-scope read allow.
2. System Admin allowlisted configuration allow.
3. System Admin ungranted create/edit/delete/transition/export denial.
4. System Admin sensitive self-grant and sensitive-action denial.
5. ordinary Member app-not-assigned denial.
6. Project Member correct-project allow + wrong-project denial.
7. WMS assignee correct-warehouse allow + other-warehouse denial.
8. sensitive Member approver explicit-grant allow.
9. membership removal reflected in active session.

- [ ] **Step 4: Define monitoring window**

Monitor permission denials, authorization refresh failures, unexpected route 403/200, audit completeness, membership/grant health, and user-reported blockers at 15 minutes, 1 hour, end of day, and end of rollback-retention window.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- lib/__tests__/pilotCutoverRunbook.test.ts
git add docs/security/pilot-authorization-cutover-runbook.md docs/security/pilot-authorization-postcutover-checklist.md lib/__tests__/pilotCutoverRunbook.test.ts
git commit -m "docs: add pilot authorization cutover runbook"
```

---

### Task 8: Rehearse Locally and in an Approved Non-production Environment

- [ ] **Step 1: Local fresh-database rehearsal**

```bash
npx supabase db reset
npx supabase test db supabase/tests/pilot_permission_readiness_gate.sql
npx supabase test db supabase/tests/pilot_authorization_cutover_smoke.sql
npx supabase test db supabase/tests/pilot_authorization_cutover_rollback_smoke.sql
npx supabase test db supabase/tests/phase5_no_legacy_fallback_smoke.sql
npx supabase test db supabase/tests/phase5_permission_health_smoke.sql
```

- [ ] **Step 2: Local representative 42-user rehearsal**

Use generated fixture IDs, not production identities. Match only aggregate role/app/grant/scope distribution. Preview, Apply, all archetype checks, rollback, and second Apply must pass.

- [ ] **Step 3: Prepare exact non-production packet**

Include environment ID, migration filenames/hashes, app commit, manifest fingerprint, aggregate counts, commands, expected outputs, external snapshot location policy, rollback deadline, and named operator. Request explicit approval.

- [ ] **Step 4: Run non-production rehearsal one**

Apply, verify, simulate authorization failure, rollback, and prove original fingerprint restored.

- [ ] **Step 5: Run non-production rehearsal two**

Apply without rollback, verify active-session refresh and complete archetype checklist, monitor for one agreed interval.

- [ ] **Step 6: Record aggregate evidence**

Do not commit raw environment data. Record hashes, counts, timings, pass/fail markers, and any remediation in the runbook execution appendix.

---

### Task 9: Prepare the Exact Production Approval Packet

The packet must contain:

- exact branch/commit and application build identifier;
- every migration filename plus SHA-256 and remote-history expectation;
- database project/environment identifier;
- approved manifest SHA-256 and aggregate counts;
- expected pre-state fingerprint from read-only preflight;
- encrypted snapshot destination and verifier receipt format;
- maintenance start/end, freeze owner, and communications;
- exact Preview/Apply/status/rollback commands with secrets redacted;
- idempotency key and change reference;
- rollback deadline and hard thresholds;
- non-production rehearsal evidence;
- known nonblocking issues;
- explicit statement that no command runs until approved.

- [ ] **Step 1:** Generate packet from the current commit and approved manifest.
- [ ] **Step 2:** Re-run full tests/typecheck/build/local SQL tests.
- [ ] **Step 3:** Run read-only production preflight only if authorized.
- [ ] **Step 4:** Compare actual pre-state aggregate counts with the packet; any drift invalidates approval.
- [ ] **Step 5:** Ask for explicit production mutation approval.

---

### Task 10: Execute Production Maintenance Event Only After Approval

- [ ] **Step 1:** Announce/freeze authorization administration.
- [ ] **Step 2:** Verify environment, commit/build, migration state, actor, manifest fingerprint, and idempotency key.
- [ ] **Step 3:** Export and independently verify encrypted Legacy snapshot.
- [ ] **Step 4:** Call Preview and require zero blockers plus exact expected counts/fingerprints.
- [ ] **Step 5:** Call Apply once.
- [ ] **Step 6:** Verify returned post-state fingerprint, DB status, zero Legacy sources, hardening flags, audit, and refresh.
- [ ] **Step 7:** Execute every archetype checklist item.
- [ ] **Step 8:** If a hard threshold fails, stop writes and call rollback only if drift check passes; otherwise enter manual incident recovery.
- [ ] **Step 9:** If all checks pass, unfreeze and begin monitoring schedule.
- [ ] **Step 10:** At retention deadline, verify stable health before deleting the external recovery artifact according to the approved retention policy; database audit metadata remains.

---

## Final Verification Before Production Approval

```bash
npm test
npm run lint
npm run build
npx supabase db reset
npx supabase test db
git status --short
```

Required evidence:

- two successful Apply rehearsals;
- one successful exact-fingerprint rollback rehearsal;
- one proven drift-blocked rollback;
- zero readiness blockers for the approved manifest;
- no required Legacy/declared action;
- zero active keeper-role dependency;
- exactly one active System Admin and zero System Admin membership rows;
- System Admin global read passed across required project/warehouse/department scopes;
- System Admin ungranted business mutations and sensitive self-grant are denied;
- zero effective `APP_ADMIN` source and no App Admin target-state field;
- external snapshot encryption/verification passed;
- post-cutover Legacy write guard passed;
- runbook contract passed;
- production packet has exact hashes and explicit approval boundary.
