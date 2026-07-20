# Payment And Quantity Runtime Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the invariant that the five Payment/Quantity permission codes promoted to `verified` at Cloud Gate A9 have their exact scoped command RPCs and direct-workflow guards persistently installed before Phase 02 Closure Task 3 can continue.

**Architecture:** Keep this work inside the Phase 02 Task 3 readiness prerequisite. Apply the already tested transition migration and run its existing smoke in one linked Cloud transaction: create the runtime objects before a savepoint, run the smoke after the savepoint, roll the smoke fixtures back to that savepoint, and commit the runtime objects only after the checkpoint succeeds. Repair only the two exact direct-applied migration versions in a later, separately approved gate.

**Tech Stack:** PostgreSQL 15+, Supabase CLI 2.95.6, linked Supabase Cloud, transactional SQL smoke, TypeScript 5.8, Vitest 4.

## Global Constraints

- This remains **Phase 02 - Business Role and Minimal SoD**, inside the readiness prerequisite of Closure Task 3. Do not start Phase 03.
- Do not Preview or Save any of the 12 pending principals while any approved permission row remains blocked.
- Do not print or commit identities, emails, Auth IDs, tokens, database URLs, raw grant rows, or the approved manifest.
- Do not mutate Cloud without approval for the exact gate described below.
- Do not edit any applied migration, including `20260718092455_unified_permission_change_command.sql` and `20260718123119_authorization_audit_readiness.sql`.
- Do not edit the source artifacts covered by this plan. Any defect requires a new forward migration and a new approval.
- Do not use `db push`, local Supabase, Docker, `--local`, `supabase start`, or `db reset`.
- Do not edit, stage, format, overwrite, or revert `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.
- Keep `project.payment.mark_paid` at `declared` because it has no approved lifecycle owner.
- Keep all authorization rollout flags disabled and preserve the Direct Grant baseline.

---

## Current Read-Only Evidence

At HEAD `a7da2188215ba5ef1e66ed4b1f7c88fa93a2ec96`:

- migration `20260718155122_payment_quantity_transition_commands.sql` SHA-256 is `804728efc3fad0b10738ea8d423fff819ea79354680f11b1e9ac2c56bd7df0ef`;
- smoke `phase3_payment_contract_permissions_smoke.sql` SHA-256 is `2b7fa00ccfcb4195d279f81b9f658f5ea6ea304758372a91817b714cc782de5b`;
- Cloud history count for `20260718155122` is zero;
- both exact eight-argument transition RPCs are absent;
- both private direct-workflow guard functions and both table triggers are absent;
- the five runtime permission codes are already `verified` from Gate A9;
- `project.payment.mark_paid` remains `declared`;
- enabled hardening flags remain zero.

This is a runtime/readiness integrity gap. It does not authorize a readiness rollback, principal Save, history repair, or unrelated tranche.

### Task 1: Freeze And Reverify The Exact Runtime Artifacts

**Files:**

- Verify: `supabase/migrations/20260718155122_payment_quantity_transition_commands.sql`
- Verify: `supabase/tests/phase3_payment_contract_permissions_smoke.sql`
- Test: `lib/__tests__/paymentQuantityTransitionMigration.test.ts`
- Test: `lib/__tests__/paymentQuantityReadinessSmoke.test.ts`
- Test: `lib/__tests__/paymentCertificateTransitionService.test.ts`
- Test: `lib/__tests__/quantityAcceptanceTransitionService.test.ts`
- Test: `lib/__tests__/paymentQuantityReadinessMigration.test.ts`
- Test: `lib/__tests__/paymentQuantityReadinessPromotionSmoke.test.ts`

**Interfaces:**

- Consumes the immutable transition migration and the A7 smoke.
- Produces hash-bound local evidence for Cloud Gate A10; it produces no code or Cloud mutation.

- [x] **Step 1: Reconfirm Git boundaries**

Run:

```bash
git branch --show-current
git rev-parse HEAD
git status --short --branch
git diff --cached --name-only
```

Expected: branch `refactor/module-du-an-v1`; the user-owned roadmap remains dirty; no file is staged.

- [x] **Step 2: Recompute the two artifact hashes**

Run:

```bash
shasum -a 256 supabase/migrations/20260718155122_payment_quantity_transition_commands.sql
shasum -a 256 supabase/tests/phase3_payment_contract_permissions_smoke.sql
```

Expected exactly:

```text
804728efc3fad0b10738ea8d423fff819ea79354680f11b1e9ac2c56bd7df0ef
2b7fa00ccfcb4195d279f81b9f658f5ea6ea304758372a91817b714cc782de5b
```

- [x] **Step 3: Run focused local verification**

Run:

```bash
npm test -- --run lib/__tests__/paymentQuantityTransitionMigration.test.ts lib/__tests__/paymentQuantityReadinessSmoke.test.ts lib/__tests__/paymentCertificateTransitionService.test.ts lib/__tests__/quantityAcceptanceTransitionService.test.ts lib/__tests__/paymentQuantityReadinessMigration.test.ts lib/__tests__/paymentQuantityReadinessPromotionSmoke.test.ts
npx tsc --noEmit
git diff --check
```

Expected: all six focused test files pass, TypeScript exits zero, and the diff check is clean. An unrelated full-suite baseline failure does not authorize changing this tranche.

### Task 2: Run The Final Read-Only Cloud Preflight

**Files:**

- Verify only: linked Cloud catalog and migration history.
- Modify after evidence: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes the exact hashes from Task 1.
- Produces an aggregate-only A10 preflight with no identifying data.

- [x] **Step 1: Re-read the known CLI query surface**

Run:

```bash
node_modules/.bin/supabase db query --help
```

- [x] **Step 2: Require the fail-closed Cloud baseline**

Use one linked read-only `SELECT` and require:

```text
transition history rows = 0
payment RPC present = false
quantity RPC present = false
payment guard present = false
quantity guard present = false
payment trigger count = 0
quantity trigger count = 0
five promoted readiness values = verified
project.payment.mark_paid = declared
active Direct Grants = 2282
enabled hardening flags = 0
```

The exact RPC signatures are:

```text
public.transition_project_payment_certificate_status(uuid,text,uuid,text,text,text,text,text)
public.transition_project_quantity_acceptance_status(uuid,text,uuid,text,text,text,text,text)
```

Any mismatch invalidates Gate A10 before mutation.

- [x] **Step 3: Request Cloud Gate A10**

Approval scope: execute the exact transition migration and its exact smoke in one transaction using a savepoint; commit the migration only if the smoke reaches `phase02_task3_payment_quantity_readiness_smoke_passed`; roll back all smoke fixtures before commit. This gate does not authorize migration-history repair, a principal Preview/Save, readiness changes, grants, or rollout flags.

### Task 3: Atomically Apply Runtime Enforcement And Roll Back Smoke Fixtures

**Files:**

- Apply exactly: `supabase/migrations/20260718155122_payment_quantity_transition_commands.sql`
- Execute transactionally: `supabase/tests/phase3_payment_contract_permissions_smoke.sql`
- Modify after evidence: `docs/security/phase02-task3-permission-readiness-matrix.md`
- Modify after evidence: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes explicit A10 approval and exact Task 1 hashes.
- Produces two persistent transition RPCs, two private guard functions, and two persistent table triggers; smoke data never persists.

- [x] **Step 1: Build the exact savepoint bundle in memory**

Run these steps in one shell session. Build the SQL input without writing a
temporary file:

```bash
transition_migration='supabase/migrations/20260718155122_payment_quantity_transition_commands.sql'
runtime_smoke='supabase/tests/phase3_payment_contract_permissions_smoke.sql'
payment_quantity_runtime_bundle="$({
  printf 'begin;\n'
  sed -n '1,$p' "$transition_migration"
  printf '\nsavepoint payment_quantity_runtime_smoke;\n'
  awk '
    /^[[:space:]]*begin;[[:space:]]*$/ && !removed_begin {
      removed_begin = 1
      next
    }
    { lines[++line_count] = $0 }
    END {
      last_nonblank = line_count
      while (last_nonblank > 0 && lines[last_nonblank] ~ /^[[:space:]]*$/) {
        last_nonblank--
      }
      for (position = 1; position <= line_count; position++) {
        if (position == last_nonblank && lines[position] ~ /^[[:space:]]*rollback;[[:space:]]*$/) {
          continue
        }
        print lines[position]
      }
    }
  ' "$runtime_smoke"
  printf '\nrollback to savepoint payment_quantity_runtime_smoke;\n'
  printf 'commit;\n'
})"
```

The migration executes before the savepoint, so it survives `ROLLBACK TO SAVEPOINT`. Every disposable row and workflow transition in the smoke executes after the savepoint and is removed before commit. A smoke exception aborts the outer transaction and prevents the runtime migration from committing.

- [x] **Step 2: Recheck the hashes immediately before execution**

Abort unless the migration and smoke hashes still match Task 1. Record a SHA-256 of the complete generated bundle without printing its SQL.

- [x] **Step 3: Execute the single linked transaction**

Run the in-memory bundle with:

```bash
node_modules/.bin/supabase db query --linked --agent=no --output json "$payment_quantity_runtime_bundle"
```

Expected output contains:

```text
phase02_task3_payment_quantity_readiness_smoke_passed
```

Any error is an A10 failure. Do not retry with modified SQL or direct Cloud patches.

- [x] **Step 4: Verify the persistent postconditions read-only**

Require:

```text
payment RPC present = true
quantity RPC present = true
payment guard present = true
quantity guard present = true
payment trigger count = 1
quantity trigger count = 1
five promoted readiness values = verified
project.payment.mark_paid = declared
active Direct Grants = 2282
enabled hardening flags = 0
transition history rows = 0
readiness history rows = 0
```

History remains zero because A10 applies SQL directly and does not authorize repair.

- [x] **Step 5: Record and commit aggregate evidence only**

Append the A10 timestamp, HEAD, three hashes, deterministic checkpoint, object-presence booleans, counts, readiness states, and zero history rows. Then run:

```bash
git add docs/security/phase02-task3-permission-readiness-matrix.md docs/security/phase02-business-role-sod-live-apply-log.md
git diff --cached --name-only
git diff --cached --check
git commit -m "docs(authz): record payment quantity runtime apply"
```

Expected: exactly the two evidence documents are staged. The dirty roadmap and untracked plan/handoff files remain unstaged.

### Task 4: Repair Only The Two Exact Direct-Applied Versions

**Files:**

- No repository source file changes.
- Modify after evidence: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes a passing A10 postcheck.
- Produces exact remote migration-history entries for the runtime migration and the already applied readiness migration.

- [x] **Step 1: Discover the repair command again**

Run:

```bash
node_modules/.bin/supabase migration repair --help
```

- [x] **Step 2: Request Cloud Gate A11**

Approval scope: mark exactly versions `20260718155122` and `20260718161857` as applied in linked Supabase migration history. No SQL body, grant, readiness, principal, warning, or flag mutation is authorized.

- [x] **Step 3: Repair the exact versions after approval**

Run:

```bash
node_modules/.bin/supabase migration repair 20260718155122 20260718161857 --status applied --linked --agent=no
```

Do not include any other version.

- [x] **Step 4: Verify history and runtime state read-only**

Require one history row for each exact version, both RPCs/guards/triggers present, the five codes still `verified`, `mark_paid` still `declared`, Direct Grants still `2282`, and enabled hardening flags still zero.

- [x] **Step 5: Record and commit only the A11 evidence**

Stage only `docs/security/phase02-business-role-sod-live-apply-log.md`, verify the staged name, and commit:

```bash
git commit -m "docs(authz): record payment quantity history repair"
```

### Task 5: Recalculate The Remaining Task 3 Readiness Work

**Files:**

- Modify: `docs/security/phase02-task3-permission-readiness-matrix.md`
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`
- Follow next: a focused Material runtime/readiness plan.

**Interfaces:**

- Consumes reconciled runtime and migration history.
- Produces the next principal-free tranche decision; it does not resume principal Saves.

- [x] **Step 1: Recompute pending readiness using aggregate-only Cloud evidence**

Return pending row totals by readiness, remaining blocking permission-code count, blocked-principal count, and complete-grantable-principal count. Do not return any principal column or raw grant row.

- [x] **Step 2: Keep Closure Task 3 blocked**

The original 21-code blocker set has only five promoted codes. The three Material approval candidates and thirteen other codes still require work, so do not Preview or Save a pending principal.

- [ ] **Step 3: Start the next focused tranche**

The next implementation tranche is the three Material approvals:

```text
project.material_request.approve
project.material_po.approve
project.custom_material.approve
```

Their three forward state-guard migrations and Gate A5 smoke are already locally evidenced but not persistently installed. Prepare an atomic runtime-guard plus readiness migration plan with rollback-only smoke fixtures, using the same savepoint pattern as A10. Keep `project.material_request.confirm` and `project.material_request.verify` outside that tranche.

---

## Final Verification Checklist

- [x] The five `verified` Payment/Quantity codes have persistent scoped command RPCs and direct-update guards.
- [x] Smoke fixtures and workflow changes do not persist.
- [x] `project.payment.mark_paid` remains `declared`.
- [x] No grant, principal, warning acceptance, or rollout flag changes.
- [x] History repair covers exactly `20260718155122` and `20260718161857` and occurs only after A11 approval.
- [x] The dirty roadmap is untouched and unstaged.
- [x] Closure Task 3 remains blocked until every approved pending row is `verified` or `enforced`.
