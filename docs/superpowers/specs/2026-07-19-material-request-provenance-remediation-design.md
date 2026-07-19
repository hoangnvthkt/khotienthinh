# Material Request Retirement Provenance Remediation Design

**Date:** 2026-07-19
**Status:** Approved design; pending written-spec review
**Phase:** Phase 02 - Business Role and Minimal SoD, Closure Task 3 readiness

## Goal

Repair the grant-provenance metadata unintentionally overwritten while the
approved B1 governed command retired the eight Material Request direct grants.
The repair must preserve the completed retirement itself and make the frozen
Task 3 manifest reconstruction trustworthy again.

## Incident Boundary

The B1 command removed exactly the retired Material Request grants through the
authenticated governed UI. Its underlying full-draft replacement function,
however, writes the operation actor, timestamp, and reason to every retained
active grant in that draft. Cloud read-only evidence establishes the exact
bounded impact:

- three B1 retirement audit events;
- zero active retired Material Request grants;
- 363 active direct grants with the B1 retirement reason;
- 69 of those are active sensitive grants; and
- every affected active grant has one recoverable prior governed audit snapshot
  containing the same grant key.

No entitlement, scope, expiry, active state, retired row, permission catalog,
or rollout flag is eligible for remediation.

## Decision

Implement one forward migration and one dedicated governed repair command.
The migration changes future full-draft replacement behavior so an already
active, unchanged grant retains its existing `granted_by`, `granted_at`, and
`grant_reason`; an added or reactivated grant continues to receive the actor,
timestamp, and reason of the new command. `expires_at` remains an intentional
field of the incoming full draft. The normal permission-change audit continues
to record the operation reason for every actual change.

The dedicated repair command is the only path that can restore B1-affected
provenance. It derives original provenance server-side from the immediately
preceding governed audit snapshot rather than accepting provenance values from
the browser.

## Governed Repair Contract

Two RPCs live behind the existing authenticated authorization assertion
`system.authorization.manage_grants`:

- `preview_material_request_retirement_provenance_repair(p_user_id uuid)`
  returns aggregate eligibility and a fresh fingerprint only.
- `apply_material_request_retirement_provenance_repair(p_user_id uuid,
  p_expected_fingerprint text, p_reason text)` re-evaluates the exact same
  eligibility and atomically restores provenance only when the fingerprint is
  fresh.

For a target to be eligible, the backend must prove all of the following:

1. The target has exactly one B1 retirement audit with reason
   `Task 13 Step 5: thu hồi quyền Material Request đã retire`.
2. The target has no active
   `project.material_request.confirm` or `project.material_request.verify`
   grant.
3. Every active candidate has that exact B1 retirement reason, and no active
   non-candidate grant is changed by this command.
4. Each candidate resolves to exactly one grant tuple in the `after_grants`
   snapshot of the immediately preceding direct-grant audit event for the same
   target.
5. That preceding event has a non-empty reason and actor, and its timestamp is
   present; the candidate coverage is complete with no duplicate or ambiguous
   source.

When eligible, the update changes only `granted_by`, `granted_at`, and
`grant_reason` for the resolved active tuple. It never changes the tuple key,
scope, expiry, activity, revocation metadata, or any retired row. One repair
audit event is written per successful target with aggregate changed-count and
fingerprint metadata only. A repeated apply after success is a no-op and adds
no event.

The proposed exact repair reason is:

```text
Task 13 Step 5: khôi phục provenance sau thu hồi Material Request
```

It is a Cloud Gate C2 input: it must be explicitly confirmed before any Cloud
apply, and the browser may submit only this exact value.

## UI Boundary

The existing `PrincipalDirectGrantPanel` gains a narrow repair action that is
absent unless the backend preview says the selected principal is eligible. It
shows aggregate-only changed-count and a fresh-preview requirement. Its Save
is disabled until that preview is fresh, and it submits no grant tuple,
identity list, audit payload, actor, timestamp, or provenance value. Existing
Direct Grant edit, Preview, and Save behavior remains unchanged.

## Security and Migration Rules

The private implementation functions use `security definer` with
`set search_path = ''`, schema-qualified references, and no exposed-table
write path. The public RPC facades are executable by `authenticated` only;
`public` and `anon` retain no execute privilege. The forward migration is
created with the Supabase CLI and is additive: no applied migration is edited,
no direct SQL mutation is performed, and no local Supabase/Docker workflow is
used.

## Cloud Gates

### Cloud Gate C0: Recovery Evidence

Read-only aggregate evidence must still show zero active retired keys, exactly
363 affected active grants, exactly 69 affected active sensitive grants, and
complete one-to-one recovery coverage for all 363 affected grants. It must
also show the B1 audit count is three, no repair audit exists, the active
Direct Grant count is 2274, the non-sensitive tuple fingerprint is unchanged,
one durable rollout operator remains, and hardening flags remain disabled.
Any mismatch stops the work without mutation.

### Cloud Gate C1: Forward Migration

After local test and static contract checks pass, apply only the newly created
forward migration through the approved Cloud migration path. Re-run C0 and
the migration-specific read-only smoke checks. A failed check stops before
any repair command.

### Cloud Gate C2: Three Bounded Repair Saves

After the exact repair reason is confirmed, use the authenticated UI for each
of the three eligible principals. For each: reload, Preview, stop on any hard
deny or warning, Save once with the fresh fingerprint, reload, and prove that
an identical retry is a no-op. No identity, raw tuple, or private-manifest
data is emitted to chat, logs, or committed files.

### Cloud Gate C3: Task 3 Reconstruction

Run rollback-only aggregate gates after all three repairs. Required results:

- original source count `467` and fingerprint
  `a3d0cf9514e487111c5ae27873c8f6cd`;
- original regrant count `421` and fingerprint
  `00a8f7f0f3a39721474a582592cf0b2e`;
- revised regrant count `383` and fingerprint
  `43676e109ad8c48a83243adedcfa6e33`;
- zero active retired keys;
- 95 active sensitive grants and 2274 active Direct Grants;
- three B1 retirement audits and three remediation audits;
- unchanged non-sensitive tuple fingerprint;
- one durable rollout operator; and
- zero enabled hardening flags.

The manifest revision gate is updated only to recognize inactive retired rows
with the approved B1 revoke reason as historical source rows. It remains
rollback-only and must not reconstruct rows from the repair audit.

## Verification

Tests are written red first. They cover the forward replacement provenance
rule, the repair eligibility contract, security-definer and privilege boundary,
the frontend fresh-preview contract, and the revised manifest source filter.
Focused tests, the full TypeScript test suite, `npx tsc --noEmit`, and
`git diff --check` must pass before Cloud Gate C0. Cloud evidence remains
aggregate-only and does not reveal identities, raw grants, audit payloads, or
connection data.

## Non-Goals

- No restoration of the retired Material Request permissions.
- No permission catalog, readiness-state, resolver, rollout, or Phase 03 work.
- No bulk provenance input from a client, service-role bypass, or direct SQL
  grant mutation.
- No rewrite of historical B1 audits or applied migrations.
