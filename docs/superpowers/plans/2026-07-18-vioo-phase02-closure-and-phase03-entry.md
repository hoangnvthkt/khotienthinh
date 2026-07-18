# VIOO Phase 02 Closure and Phase 03 Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Phase 02 Business Role/Minimal SoD gates, prove the unified granular permission model on Daily Log, and stop at an evidence-backed Phase 03 Controlled Legacy Migration entry checkpoint.

**Architecture:** Keep the current compatibility posture while finishing the interrupted governed regrant flow. First make the narrowly scoped View+Audit pair grantable only after focused backend evidence, appoint one independent time-bounded control owner, and complete the remaining SoD-warning regrants through the existing governed commands. Then verify the unified permission matrix, run the additive resolver canary, and preserve separate approvals for governance and business-approval cutoffs before declaring Phase 02 complete.

**Tech Stack:** React 19, TypeScript, Vitest, Supabase PostgreSQL/RLS/RPC, Supabase CLI 2.95.6, Git, Vercel preview/production.

## Global Constraints

- This plan is inside program **Phase 02 — Business Role and Minimal SoD**. Do not implement Phase 03 source-mode or module-lifecycle code until the Phase 02 exit gate passes.
- Supabase Cloud is linked and credentials remain in `.env`; never print `.env`, database URLs, API keys, passwords, Auth IDs, JWTs, user IDs, emails, or private manifest rows.
- Do not use Docker, Supabase local, `--local`, `supabase start`, `db reset`, or `db push`.
- Read `npx supabase <command> --help` before using an unfamiliar CLI flag.
- No Cloud mutation occurs without the task-specific approval checkpoint below. A plan approval is not mutation approval.
- Never insert, update, or delete `public.user_permission_grants`, Business Role assignments, warning acceptances, or rollout settings by direct SQL.
- Permission changes use an authenticated Permission Admin and the governed Preview/Apply RPCs. Backend SoD, expiry, reason, audit, and stale-draft checks remain authoritative.
- Preserve the approved private 467-row manifest: 421 `REGRANT`, 46 `DROP`, one shared sensitive expiry `2026-10-16T12:10:00+07:00`. Do not place the manifest in Git or chat.
- Regrant batches contain at most three principals and run sequentially. Stop after every batch for approval.
- `legacy_projection_enabled` remains `false`. Do not use legacy projection to make a canary pass.
- `legacy_governance_fallback_disabled` and `system_admin_business_approval_bypass_disabled` remain `false` until their dedicated cutoff checkpoint.
- Migration `20260718092455_unified_permission_change_command.sql` is already applied and immutable. Defects use a new forward migration.
- Never stage, modify, format, or revert the user-owned dirty file `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.
- Aggregate evidence may contain counts, timestamps, fingerprints, migration versions, commit SHAs, and flag states only.
- Any unexpected allow, hard deny, stale state, fingerprint drift, audit delta, or new advisor finding stops the plan. Do not broaden a permission or flag to mask it.

---

## Starting Evidence — 2026-07-18

| Evidence | Confirmed value |
| --- | ---: |
| Local branch / merge commit | `main` / `ad0030b` |
| Remote base | `origin/main` at `e30332a` |
| Active Direct Grants | 2,280 |
| Active sensitive Direct Grants | 103 across 10 principals |
| Active sensitive grants with null expiry | 0 |
| Approved sensitive rows still pending | 318 across 12 principals |
| Active SoD warning acceptances | 0 |
| Audit-capable active actors | 1; this is not an independent control owner for the current actor |
| Readiness | 231 Declared, 59 Legacy, 11 Verified |
| Rollout flags | resolver `false`; governance cutoff `false`; approval cutoff `false`; legacy projection `false` |

The immediate next roadmap work is therefore Phase 02 closure. Phase 03 is not yet authorized because the sensitive regrant, resolver/cutoff canaries, production observation, and final Phase 02 evidence remain incomplete.

## File Structure

- Create: `lib/__tests__/authorizationAuditReadinessMigration.test.ts` — static contract for the focused authorization View+Audit readiness forward migration.
- Create through Supabase CLI: the unique migration ending `_authorization_audit_readiness.sql` — promotes only authorization View+Audit after evidence.
- Create: `supabase/tests/authorization_audit_readiness_smoke.sql` — rollback-only positive and adjacent-negative backend evidence.
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md` — aggregate Cloud checkpoints and Phase 02 closure evidence.
- Modify: `docs/security/unified-permission-matrix-manual-checklist.md` — bounded Daily Log Pass/Fail evidence.
- Verify: `supabase/tests/authorization_sensitive_grant_regrant_gate.sql` — exact final sensitive regrant gate.
- Verify: `supabase/tests/phase3_daily_log_permissions_smoke.sql` — transactional Daily Log action separation.
- Verify: `supabase/migrations/20260718092455_unified_permission_change_command.sql` — applied unified Preview/Apply contract; never edit it.

### Task 1: Prove and promote only the authorization View+Audit pair

**Files:**

- Create: `lib/__tests__/authorizationAuditReadinessMigration.test.ts`
- Create through CLI: the unique path resolved by `rg --files supabase/migrations | rg '_authorization_audit_readiness\.sql$'`
- Create: `supabase/tests/authorization_audit_readiness_smoke.sql`
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes: `permission_actions.grant_readiness`, `app_private.has_permission(...)`, `permission_audit_events` RLS, and the unified Preview/Apply command.
- Produces: `system.authorization.view` and `system.authorization.audit` as the only newly `verified` actions; no manage readiness row or effective permission changes.

- [ ] **Step 1: Write the failing migration contract test**

Create a Vitest contract that resolves exactly one migration by suffix and asserts all boundaries:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
const candidates = fs.readdirSync(migrationDir)
  .filter(name => name.endsWith('_authorization_audit_readiness.sql'));

describe('authorization audit readiness migration', () => {
  it('promotes only the exact authorization View and Audit actions', () => {
    expect(candidates).toHaveLength(1);
    const sql = fs.readFileSync(path.join(migrationDir, candidates[0]), 'utf8');
    expect(sql).toMatch(/permission_code\s+in\s*\([^)]*'system\.authorization\.view'[^)]*'system\.authorization\.audit'/is);
    expect(sql).toMatch(/grant_readiness\s*=\s*'verified'/i);
    expect(sql).toMatch(/grant_readiness\s*=\s*'declared'/i);
    expect(sql).not.toMatch(/system\.authorization\.(manage_roles|manage_grants|manage_scopes|override)/i);
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
  });
});
```

- [ ] **Step 2: Run the focused test and observe RED**

Run:

```bash
npx vitest run lib/__tests__/authorizationAuditReadinessMigration.test.ts
```

Expected: FAIL because no `_authorization_audit_readiness.sql` migration exists.

- [ ] **Step 3: Create the forward migration through the CLI**

Run:

```bash
npx supabase migration new authorization_audit_readiness
AUDIT_READINESS_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_audit_readiness\.sql$')"
test "$(printf '%s\n' "$AUDIT_READINESS_MIGRATION" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
```

Expected: one unique generated migration path.

- [ ] **Step 4: Implement the minimal readiness promotion**

Add only this state transition to the generated migration:

```sql
update public.permission_actions
set grant_readiness = 'verified',
    updated_at = now()
where permission_code in (
    'system.authorization.view',
    'system.authorization.audit'
  )
  and grant_readiness = 'declared'
  and is_active;

do $$
begin
  if (
    select count(*)
    from public.permission_actions
    where permission_code in (
        'system.authorization.view',
        'system.authorization.audit'
      )
      and grant_readiness = 'verified'
      and scope_modes = array['global']::text[]
      and not direct_grant_requires_expiry
  ) <> 2 then
    raise exception 'authorization View+Audit readiness promotion failed';
  end if;
end;
$$;
```

- [ ] **Step 5: Add rollback-only backend evidence**

Create `supabase/tests/authorization_audit_readiness_smoke.sql` with a transaction that:

1. asserts only `system.authorization.view` and `system.authorization.audit` changed from Declared to Verified;
2. creates two temporary active non-Admin app users and one unrelated audit event;
3. grants the exact global View+Audit pair to only the first fixture;
4. impersonates each fixture through transaction-local JWT claims;
5. proves the Audit fixture can read the unrelated event;
6. proves the no-grant fixture cannot read it;
7. proves the Audit fixture cannot insert/update/delete audit rows and cannot manage roles or grants;
8. prints `authorization_audit_readiness_smoke_passed` and rolls back.

The smoke must end with:

```sql
select 'authorization_audit_readiness_smoke_passed' as checkpoint;
rollback;
```

- [ ] **Step 6: Run local/static verification**

Run:

```bash
npx vitest run lib/__tests__/authorizationAuditReadinessMigration.test.ts lib/__tests__/permissionReadiness.test.ts lib/__tests__/unifiedPermissionMatrix.test.tsx
git diff --check
```

Expected: all tests pass and no whitespace error.

- [ ] **Step 7: Run the migration and smoke in one linked rollback transaction**

After explicit approval for rollback-only Cloud execution, concatenate the migration and smoke between one outer `BEGIN`/`ROLLBACK`, run with `npx supabase db query --linked --agent=no --file`, and confirm the checkpoint. Then query read-only and prove Cloud still reports Audit as Declared because the transaction rolled back.

- [ ] **Step 8: Stop for exact migration-apply approval**

Present the generated version, rollback checkpoint, focused tests, and the four unchanged flags. Do not apply or repair history yet.

- [ ] **Step 9: Apply and repair exactly the Audit-readiness migration**

After explicit approval, apply only the generated file in one transaction, verify the checkpoint, and repair only its exact version as `applied`. Do not use `db push`.

- [ ] **Step 10: Verify and commit Task 1**

Run the smoke again inside `BEGIN/ROLLBACK`, confirm readiness counts become 229 Declared, 59 Legacy, 13 Verified, confirm grants remain 2,280 and all four flags remain `false`, then commit only the migration, test, smoke, and aggregate apply-log entry:

```bash
git add lib/__tests__/authorizationAuditReadinessMigration.test.ts \
  supabase/migrations/*_authorization_audit_readiness.sql \
  supabase/tests/authorization_audit_readiness_smoke.sql \
  docs/security/phase02-business-role-sod-live-apply-log.md
git diff --cached --check
git diff --cached --name-only
git commit -m "feat(authz): verify audit permission readiness"
```

Expected: the user-owned dirty plan is absent from the staged list.

### Task 2: Appoint one independent, least-privilege control owner

**Files:**

- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes: the Verified `system.authorization.view` + `system.authorization.audit` pair and unified Preview/Apply.
- Produces: one active independent control owner with only a temporary global Direct View+Audit pair plus an expiring `AUDITOR` Business Role; a new approved non-sensitive fingerprint baseline.

- [ ] **Step 1: Select the candidate read-only**

Through the authenticated governance UI, select an active non-Admin principal who is:

- not the current Permission Admin;
- not one of the 12 warned target principals;
- not a current maker/checker target in the pending warning set;
- able and authorized by the business owner to review authorization evidence through `2026-10-16T12:10:00+07:00`.

Record the identity only in the private runtime handoff, never in Git/chat.

- [ ] **Step 2: Preview the minimal grant**

In the unified matrix choose Audit; the View master control must be included in the same global scope. The exact resulting pair is:

```text
system.authorization.view  :: global :: *
system.authorization.audit :: global :: *
```

Use a reason of at least 10 characters and Preview. Expected: no hard deny, no SoD warning, and no adjacent governance permission added. The current unified editor does not expose expiry for non-sensitive Direct Grants, so this Direct pair is an explicitly temporary bridge removed in Task 7; do not invent a hidden expiry input.

- [ ] **Step 3: Stop for control-owner appointment approval**

Present aggregate before/after intent: Direct Grant total `2280 -> 2282`, sensitive total remains `103`, Audit-capable actors `1 -> 2`, four flags unchanged. Do not Save until approved.

- [ ] **Step 4: Save the temporary Direct pair once**

After approval, Save through `apply_user_permission_change` using the exact preview fingerprint. Exactly one permission-change audit event must be added.

- [ ] **Step 5: Stage the expiring Auditor Business Role**

Through the Business Role panel, Preview and assign the existing `AUDITOR` role to the same principal at `global/*`, expiring at `2026-10-16T12:10:00+07:00`. Use a reason of at least 10 characters. Expected while the resolver flag is still `false`: the assignment is active and audited but the current effective Audit source remains Direct, not Role.

- [ ] **Step 6: Prove least privilege in a fresh session**

Verify:

- `system.authorization.view` and `system.authorization.audit` are allowed globally;
- audit/source reads are allowed;
- `manage_roles`, `manage_grants`, `manage_scopes`, `override`, and business approvals are denied;
- wrong-scope and adjacent-action checks deny;
- the Direct change and Business Role assignment created exactly one audit event each.

- [ ] **Step 7: Rebaseline the non-sensitive fingerprint once**

Compute the active non-sensitive canonical fingerprint read-only. Store it only in the private runtime and record aggregate count `2179` plus the fingerprint in the apply log. This is the single approved exception to the original `2177` invariant; later drift still fails closed.

- [ ] **Step 8: Commit aggregate appointment evidence**

```bash
git add docs/security/phase02-business-role-sod-live-apply-log.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs(authz): record independent control owner"
```

Expected: no identity or raw permission payload appears in the diff.

### Task 3: Resume the 12 warned principals in bounded batches

**Files:**

- Verify: `docs/superpowers/plans/2026-07-18-vioo-sensitive-direct-grant-revoke-all-regrant.md`
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes: the approved private manifest, shared cutoff, independent control owner, and governed Direct Grant command.
- Produces: all 421 approved sensitive rows active across 22 principals; all 46 DROP rows inactive.

- [ ] **Step 1: Reconfirm immutable preflight**

Read-only evidence must match:

- 467 source rows = 421 REGRANT + 46 DROP;
- currently active sensitive rows = 103 across 10 principals;
- pending approved rows = 318 across 12 principals;
- active sensitive null-expiry rows = 0;
- active sensitive rows outside the approved manifest = 0;
- non-sensitive active count = 2,179 and fingerprint equals the Task 2 baseline;
- active Audit-capable actors = 2;
- active Business Role assignments = 3, including the staged expiring `AUDITOR` assignment;
- all four rollout flags remain `false`.

Any mismatch stops execution.

- [ ] **Step 2: Prepare exact warning evidence**

For each warned principal, use the independent control owner and provide one acceptance per backend warning containing:

- exact backend `ruleCode`, `scopeType`, and `scopeId`;
- business-owner approved reason of at least 10 characters;
- concrete compensating control of at least 10 characters;
- acceptance expiry no later than `2026-10-16T12:10:00+07:00`.

Never reuse a warning acceptance for a different rule or scope.

- [ ] **Step 3: Preview and save one principal**

Load the complete current Direct Grant draft, append only that principal's approved manifest rows, set the shared sensitive expiry and standardized reason:

```text
Task 13 Step 5: tái cấp quyền nhạy cảm đã được phê duyệt
```

Preview, compare exact keys/scopes/expiry, attach the warning evidence, and Save once. An identical retry must be a no-op.

- [ ] **Step 4: Verify after every principal**

Read-only checks must prove:

- cumulative sensitive active count/fingerprint equals the processed manifest subset;
- no active key exists outside the approved manifest;
- every active sensitive row has the exact shared cutoff and reason;
- audit delta is exactly one per newly processed principal;
- non-sensitive count/fingerprint remains at the Task 2 baseline;
- Business Role assignments remain at the Task 2 baseline of 3; no responsibility, app assignment, migration history, or rollout flag changed.

- [ ] **Step 5: Close each batch at three principals**

Run four batches of at most three principals. After each batch, record only counts/fingerprints/timestamps and stop for approval before the next batch.

- [ ] **Step 6: Prove the completed regrant totals**

Expected final maintenance totals:

- 421 active sensitive rows across 22 regranted principals;
- 46 approved DROP rows remain inactive;
- 22 regrant audit events total from the maintenance regrant phase;
- 23 revoke audit events retained from the revoke phase;
- exactly 12 active warning acceptances, one for each freshly previewed warned principal;
- non-sensitive count 2,179 with the Task 2 fingerprint;
- all four rollout flags `false`.

### Task 4: Pass the exact sensitive-grant final gate and close maintenance

**Files:**

- Verify: `supabase/tests/authorization_sensitive_grant_regrant_gate.sql`
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes: completed approved regrant state and the revised Task 2 non-sensitive fingerprint.
- Produces: final sensitive-remediation PASS evidence while resolver and both cutoffs remain disabled.

- [ ] **Step 1: Run the existing final gate with revised runtime values**

Use the existing gate unchanged. Inject at runtime:

- expected regrant count `421`;
- approved regrant fingerprint from the private manifest;
- expected expiry `2026-10-16T12:10:00+07:00` converted to the exact canonical timestamptz used by the manifest;
- the revised non-sensitive fingerprint from Task 2.

Expected checkpoint: `authorization_sensitive_grant_regrant_gate_passed` followed by rollback.

- [ ] **Step 2: Run final aggregate and advisor checks**

Confirm the exact grant/audit arithmetic, durable rollout operator count at least `1`, Audit-capable actors `2`, four flags `false`, security advisor baseline `170`, and performance advisor baseline `97`, unless a separately evidenced baseline change exists.

- [ ] **Step 3: Run repository verification**

```bash
npm run lint
npx vitest run --exclude '.worktrees/**'
npm run build
git diff --check
git status --short
```

Expected: zero failures; only the known bundle-size advisory may remain.

- [ ] **Step 4: Close maintenance and commit evidence**

Update the apply log with the final gate, four batch checkpoints, warning-acceptance aggregate, revised non-sensitive control baseline, advisors, and repository results. Commit only the apply log:

```bash
git add docs/security/phase02-business-role-sod-live-apply-log.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs(authz): close sensitive grant remediation"
```

### Task 5: Publish the exact merged candidate to Vercel preview

**Files:**

- Verify only; modify code only through a separately reviewed forward-fix plan.

**Interfaces:**

- Consumes: closed maintenance and verified `main`.
- Produces: one immutable preview SHA for UI and resolver canaries.

- [ ] **Step 1: Freeze the candidate**

Run `git status --short`, `git rev-parse HEAD`, `git diff --check`, and the focused authorization suite. The only unstaged entry may be the user-owned plan.

- [ ] **Step 2: Stop for push/deployment approval**

Present local/remote SHAs and the exact commit range. Do not push `main` until approved.

- [ ] **Step 3: Push main without force**

After approval:

```bash
git push origin main
```

Expected: `origin/main` advances to the exact local candidate. Never force-push.

- [ ] **Step 4: Verify the existing Vercel preview**

Confirm deployment success for the exact SHA, then verify the governance page loads, the unified matrix shows View/action hierarchy, source badges render, Preview is readable, and no checkbox mutates Cloud before Save.

### Task 6: Prove granular Daily Log separation

**Files:**

- Verify: `supabase/tests/phase3_daily_log_permissions_smoke.sql`
- Modify: `docs/security/unified-permission-matrix-manual-checklist.md`
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes: exact preview candidate, 11 Verified Daily Log actions, and the bounded manual checklist.
- Produces: positive, adjacent-negative, scope-negative, and ownership-negative evidence for the simple matrix.

- [ ] **Step 1: Run rollback-only backend separation smoke**

After rollback-only approval, run `phase3_daily_log_permissions_smoke.sql` against linked Cloud. Expected: transaction checkpoint/pass and rollback. If the current responsibility-assignment migration makes the historical smoke fail, stop and create a focused forward test fix; do not change production responsibility slots in Phase 02.

- [ ] **Step 2: Select disposable UI fixtures**

Use one active non-Admin test account with no Role/Legacy umbrella, Project A as the granted scope, Project B as the denied scope, and eligible Daily Log records. Keep fixture identities private.

- [ ] **Step 3: Stop for manual test-account mutation approval**

Present the account/project eligibility and exact restoration draft. Do not grant or change test records until approved.

- [ ] **Step 4: Execute the checklist one row at a time**

Run View, View+Create, View+Edit own, View+Edit all, View+Submit, View+Verify, and View+Approve exactly as recorded in `docs/security/unified-permission-matrix-manual-checklist.md`. For every row:

- Preview and Save the complete test-account draft;
- exercise the intended backend action;
- exercise at least one adjacent denied action;
- verify Project B denial;
- distinguish permission denial from missing state/assignment precondition;
- stop at the first unexpected allow.

- [ ] **Step 5: Restore the test account**

Apply the exact captured pre-test permission draft through governed Preview/Apply. Verify the before/after fingerprint returns to the captured baseline and no test grant remains active.

- [ ] **Step 6: Record and commit aggregate results**

Mark each checklist row Pass/Fail with timestamp and backend result category, without identities. Commit the checklist and aggregate apply-log entry:

```bash
git add docs/security/unified-permission-matrix-manual-checklist.md \
  docs/security/phase02-business-role-sod-live-apply-log.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs(authz): verify granular permission separation"
```

### Task 7: Canary the resolver, then keep both cutoffs separate

**Files:**

- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes: final sensitive gate, preview candidate, granular verification, durable operator, and the staged expiring Auditor/control owner.
- Produces: additive resolver evidence, rollback-only cutoff impact inventory, and two explicit mutation checkpoints.

- [ ] **Step 1: Reconfirm the staged Auditor assignment and stop for resolver-only flag approval**

Read-only evidence must show the independent control owner has the temporary Direct View+Audit pair and one active `AUDITOR` assignment expiring at the shared cutoff. The Role source must still be absent while resolver is `false`.

The intended transition is exactly:

```text
(resolver, governance cutoff, approval cutoff) = (false,false,false)
                                              -> (true,false,false)
```

`legacy_projection_enabled` remains `false`.

- [ ] **Step 2: Enable only the additive resolver**

After approval, call `set_authorization_rollout_flags(true,false,false,reason)` through the authenticated System Admin/Permission Admin session.

- [ ] **Step 3: Run resolver canaries**

Verify Role, Direct, and Legacy source explanations; correct scope/expiry; revoked/expired source removal; inactive-user zero sources; adjacent-action denial; stable navigation; and effective Auditor source. On failure restore `(false,false,false)` immediately and stop.

- [ ] **Step 4: Remove the temporary Direct View+Audit pair**

Only after the `AUDITOR` Role source is effective, Preview removal of the two temporary Direct rows, confirm effective View+Audit remains through Role, and Save once. Read-only evidence must show:

- active non-sensitive Direct Grants return from 2,179 to the original 2,177 baseline and original fingerprint;
- Audit-capable active actors remain 2;
- the control owner source is Role with the shared expiry;
- no manage or business permission appears;
- resolver remains `true` and both cutoffs remain `false`.

- [ ] **Step 5: Run rollback-only cutoff impact inventory**

Inside one linked transaction temporarily evaluate `(true,true,true)`, count governance/business-approval rights lost and explicit sources retained, verify System Admin keeps technical account/settings recovery, then roll back. Record aggregates only.

- [ ] **Step 6: Stop for governance cutoff approval**

If approved, transition only to `(true,true,false)`, force fresh sessions, and prove legacy SETTINGS arrays no longer confer role/grant/audit/override authority while explicit Permission Admin/Auditor paths remain valid. Roll back to `(true,false,false)` on failure.

- [ ] **Step 7: Stop for business-approval cutoff approval**

If approved, transition only to `(true,true,true)` and verify System Admin has no implicit Daily Log/payment approval, explicit scoped approval remains scope-bound, and technical recovery remains. Roll back only the failing layer according to the approved Task 13 rollback rules.

### Task 8: Promote, observe, and close Phase 02

**Files:**

- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`
- Create after the exit gate: `docs/session-handoff-2026-07-18-phase03-controlled-legacy-migration.md`

**Interfaces:**

- Consumes: exact preview SHA and successful three-stage canaries.
- Produces: production evidence, 24-hour observation or explicit waiver, final Phase 02 exit-gate decision, and a Phase 03 planning handoff.

- [ ] **Step 1: Stop for production promotion approval**

Present exact preview SHA, flag state, rollback commands, final grant gate, matrix checklist, and cutoff canaries. Promote only the exact SHA through the existing Git/Vercel workflow after approval.

- [ ] **Step 2: Verify production frontend/backend readiness**

Confirm fresh authentication, source hydration, unified Preview/Apply, Permission Admin/Auditor UI gates, stale-draft rejection, and safe errors. Do not continue if production differs from preview.

- [ ] **Step 3: Observe for 24 hours or record an explicit owner waiver**

Record resolver failures, `42501` denials by permission code without PII, unexpected active-user denials, governance command failures, SoD acceptance/expiry anomalies, account lifecycle regressions, and frontend source-load errors. Do not infer unavailable telemetry.

- [ ] **Step 4: Re-evaluate every Phase 02 exit criterion**

Phase 02 closes only if effective permissions are source/scope/time explainable, sensitive grants expire, System Admin business approval is removed, legacy governance is cut off, hard SoD/self-grant denies hold, warning evidence is valid, disabled accounts resolve no sources, the exact candidate is healthy, and observation/waiver is recorded.

- [ ] **Step 5: Write the Phase 03 handoff, not Phase 03 implementation**

The handoff must start Phase 03 with design/review for:

1. module lifecycle states;
2. per-user/module/scope source modes;
3. coverage preview and source badges;
4. atomic profile/role/direct/source-mode diff command;
5. projection guard and rollback source mode;
6. one bounded cohort before Daily Log `NEW_ONLY`.

Do not add Phase 03 migrations or flags in this plan.

- [ ] **Step 6: Final verification and evidence commit**

```bash
npm run lint
npx vitest run --exclude '.worktrees/**'
npm run build
git diff --check
git status --short
git add docs/security/phase02-business-role-sod-live-apply-log.md \
  docs/session-handoff-2026-07-18-phase03-controlled-legacy-migration.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs(authz): close phase 02 rollout"
```

Expected: tests/build pass, aggregate evidence is complete, and the user-owned dirty plan remains unstaged.

---

## Completion Criteria

- Authorization View+Audit are the only newly Verified actions and have focused positive/adjacent-negative backend evidence.
- One independent control owner ends with only an expiring `AUDITOR` Business Role; the temporary Direct View+Audit bridge is removed after resolver canary, and no broad legacy Admin or service-role bypass is introduced.
- All 421 approved sensitive rows are active with the exact shared cutoff; all 46 DROP rows remain inactive; the exact final gate passes.
- Unified Daily Log View/Create/Edit/Submit/Verify/Approve separation has backend and bounded manual evidence, including scope and ownership negatives.
- Resolver canary passes before either cutoff; governance and business-approval cutoffs are separately approved and reversible.
- Production runs the exact verified preview SHA, followed by 24-hour evidence or an explicit waiver.
- Phase 02 exit gate is fully evidenced before the Phase 03 design handoff is used.

## Execution Checkpoints

Cloud or external mutation approvals remain separate at these boundaries:

1. rollback-only Audit readiness smoke;
2. exact Audit-readiness migration apply/repair;
3. independent control-owner Save;
4. each sensitive regrant batch;
5. push/deploy exact `main` candidate;
6. disposable manual matrix mutation;
7. resolver-only flag;
8. temporary Direct View+Audit removal after the Role source is proven;
9. governance cutoff;
10. business-approval cutoff;
11. production promotion.
