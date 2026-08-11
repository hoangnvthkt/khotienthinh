# Vehicle Booking Phase 1.1 Hardening Implementation Plan

> **For agentic workers:** Execute inline with the main agent only. Repository policy forbids sub-agents. Track every RED/GREEN checkpoint in command output.

**Goal:** Harden and complete the Vehicle Booking Phase 1 database surface on Supabase Cloud so it is safe for Phase 2 frontend integration.

**Architecture:** Keep the four deployed Phase 1 migrations as a reproducible baseline and append three idempotent migrations: security containment, command/state-machine completion, and jobs/audit. Exercise the real public RPC/RLS surface with authenticated JWT role impersonation, then apply each migration to the linked Cloud project and repair only its verified history version.

**Tech Stack:** PostgreSQL, Supabase Auth/RLS/Storage/Cron, PL/pgSQL, Supabase CLI 2.110.0, TypeScript/Vite/Vitest.

## Global Constraints

- Supabase Cloud only with the configured `.env`; no Supabase local and no Docker.
- Do not run unrestricted `supabase db push`.
- Do not expose private `SECURITY DEFINER` commands through the Data API.
- Every public wrapper must use `SECURITY INVOKER SET search_path = ''`.
- Business error codes must remain stable uppercase identifiers such as `PERMISSION_DENIED` and `INVALID_STATUS_TRANSITION`.
- Do not implement GPS realtime, AI dispatch, fuel tracking or UI work.

---

### Task 1: Create an authenticated regression smoke suite

**Files:**
- Replace: `supabase/tests/vehicle_booking_phase1_smoke.sql`

**Interfaces:**
- Consumes: public booking RPCs, `auth.role()`, `request.jwt.claims`, booking tables and Storage policies.
- Produces: a rollback-only SQL suite whose uncaught exception means regression failure.

- [ ] Write tests that switch to `authenticated`, set a concrete user JWT, call the real public RPC and assert `PERMISSION_DENIED` for reject, cancel, checkpoint, start, finish and feedback by an unrelated user.
- [ ] Add happy-path assertions for manager approval, dispatcher dispatch/reassign, operator response, handover, start, finish, return, external completion and no-show.
- [ ] Add direct SELECT/INSERT policy assertions for issues and `storage.objects` paths under multiple actors.
- [ ] Run the suite before fixes and record the expected authorization failure, proving RED.

Run:

```bash
npx --yes supabase@2.110.0 db query --linked --agent=no --file supabase/tests/vehicle_booking_phase1_smoke.sql
```

Expected RED: at least one assertion reports that an unrelated authenticated actor was allowed to mutate another booking.

### Task 2: Security containment migration

**Files:**
- Create using `supabase migration new`: `supabase/migrations/20260812000005_vehicle_booking_security_hardening.sql`

**Interfaces:**
- Produces: `vehicle_user_has_permission`, storage access helpers, corrected RLS policies, least-privilege grants and hardened public wrapper attributes.

- [ ] Add helper assertions to the smoke suite for permission scope/expiry, sensitive authorization visibility, operator absence notes and storage namespaces; run and confirm RED.
- [ ] Replace the booking permission adapter with `app_private.has_permission(p_user_id, code, scope_type, scope_id)` and active-user checks.
- [ ] Add private Storage helpers that parse the first path token with `storage.foldername(name)` and authorize trip/external by booking, licenses by owner/manage permission, and fleet by fleet permission.
- [ ] Drop the broad booking Storage policies, create scoped SELECT/INSERT policies and issue bucket-specific UPDATE/DELETE denial by omission; grant table operations needed by Storage API without global revoke.
- [ ] Restrict sensitive table policies and refresh the security-invoker eligible-driver view.
- [ ] Revoke private command execution from `public`, `anon`, `authenticated`; harden every public wrapper search path.
- [ ] Apply migration to Cloud, run its postflight assertions, then record its migration version as applied.

### Task 3: Complete state-machine commands and schema invariants

**Files:**
- Create using `supabase migration new`: `supabase/migrations/20260812000006_vehicle_booking_command_hardening.sql`
- Modify: `types/vehicleBooking.ts`

**Interfaces:**
- Produces public RPCs `reassign_vehicle_booking`, `respond_to_vehicle_assignment`, `complete_external_transport`, `mark_vehicle_booking_no_show`, `create_operator_unavailability`, `cancel_operator_unavailability`, `cancel_vehicle_unavailability`, `replace_vehicle_booking_participants` and hardened replacements for all existing commands.

- [ ] Add failing tests for every missing command and hard-block code.
- [ ] Add idempotent settings columns and validated constraints for assignment shape, return reason and trip evidence consistency.
- [ ] Add reusable private validators for actor permissions, operator eligibility, dispatch availability, evidence paths and audit/outbox enqueueing.
- [ ] Replace reject/cancel/checkpoint/handover/start/finish/feedback commands so they lock rows, validate actor and validate state before mutation.
- [ ] Replace dispatch so internal-with-driver requires professional driver, self-drive requires self-drive authorization/handover officer, external has no internal operator/vehicle, pending approval override requires reason, and custody is not checked until start.
- [ ] Implement the missing public RPCs and revoke/grant exact signatures.
- [ ] Update TypeScript types for settings and newly exposed result/state fields.
- [ ] Run the Cloud smoke suite until command/security cases are GREEN, then repair this migration version.

### Task 4: Audit, outbox delivery and cron

**Files:**
- Create using `supabase migration new`: `supabase/migrations/20260812000007_vehicle_booking_jobs_hardening.sql`

**Interfaces:**
- Produces service-role-only claim/deliver/fail worker RPCs, private feedback auto-close and active cron schedules.

- [ ] Add failing tests proving authenticated users cannot run workers and proving a claimed row can be delivered or retried.
- [ ] Add outbox `delivered_at` and an event type/payload contract; make claim recover stale PROCESSING rows and use `FOR UPDATE SKIP LOCKED`.
- [ ] Deliver events into `public.notifications`, mark success, and implement exponential retry capped at ten attempts.
- [ ] Restrict worker entrypoints to `service_role`; revoke the existing authenticated auto-close RPC.
- [ ] Schedule idempotent cron jobs for feedback auto-close and outbox delivery.
- [ ] Add redacted booking audit writes for required state changes and verify issue comments never enter `audit_trail`.
- [ ] Run job tests and repair this migration version.

### Task 5: Final Cloud and repository verification

**Files:**
- Verify all files above plus `types.ts`.

- [ ] Query remote function definitions, privileges, Storage policies, cron jobs and migration history.
- [ ] Run Supabase security advisors and isolate any new booking findings.
- [ ] Run booking smoke, lint, build and the full Vitest suite.
- [ ] Inspect `git diff --check` and `git status --short`; report unrelated pre-existing failures separately.

Commands:

```bash
npx --yes supabase@2.110.0 db query --linked --agent=no --file supabase/tests/vehicle_booking_phase1_smoke.sql
npx --yes supabase@2.110.0 migration list --linked
npm run lint
npm run build
npm test
git diff --check
```
