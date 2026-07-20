# Material Request Retirement Governed Revoke Design

**Date:** 2026-07-19
**Status:** Approved design; implementation planning pending review
**Phase:** Phase 02 - Business Role and Minimal SoD, Closure Task 3 readiness

## Goal

Remove exactly the eight already-active keys for the retired Material Request
actions so the approved manifest retirement can be safely re-evaluated:

- `project.material_request.confirm`
- `project.material_request.verify`

## Decision

Each change uses the existing governed Direct Grant replacement command through
an authenticated Permission Admin. The full fresh draft for a principal is
preserved except for the retired keys selected by the private runtime set.

Every changed Save uses the exact audit reason:

```text
Task 13 Step 5: thu hồi quyền Material Request đã retire
```

No direct SQL grant mutation, service-role bypass, catalog change, readiness
change, migration repair, or rollout-flag change is allowed.

## Execution Boundary

The private runtime set contains only the eight active canonical keys and their
principal grouping. It is generated from the approved B0 reconstruction,
stored outside Git with restricted permissions, and never printed in chat,
logs, or committed files.

For each affected principal, in batches of at most three:

1. Reload the complete current Direct Grant draft.
2. Remove exactly the retired keys in that principal's private set.
3. Preserve all other grants, scopes, expiries, and reasons.
4. Run a fresh backend Preview.
5. Stop on hard deny. For a warning, Save only with a fresh valid independent
   control-owner acceptance.
6. Save once through the governed command, then reload.
7. Submit the identical full draft only when permitted to prove the retry is a
   no-op with no additional audit event.

## Aggregate Preconditions

Before the first Save, read-only Cloud evidence must still match:

- original source/regrant/DROP counts and fingerprints;
- eight active retired keys;
- canonical active sensitive expiry and regrant reason for all other keys;
- active Direct Grants `2282`;
- unchanged non-sensitive fingerprint;
- one durable rollout operator; and
- zero enabled hardening flags.

Any mismatch closes the checkpoint without mutation.

## Per-Batch Postconditions

Record aggregate-only evidence after every batch:

- active retired count decreases exactly by the processed private-key count;
- active sensitive count decreases by the same count;
- active non-sensitive fingerprint and Direct Grant baseline remain unchanged
  except for the intended sensitive removals;
- the standardized retirement-revoke audit count increases by one per changed
  principal;
- the identical retry adds no grant or audit change; and
- the durable operator and all rollout flags remain unchanged.

No principal name, ID, raw grant key, audit payload, warning payload, or
private-manifest path is recorded.

## Completion

When active retired count reaches zero, rerun Cloud Gate B0 with the candidate
revision count `383` and fingerprint
`43676e109ad8c48a83243adedcfa6e33`. Only a B0 PASS adopts the revised manifest
with regrant `383` and DROP `84`.

The subsequent Task 3 readiness calculation remains separate. It may resume a
principal only when the revised exact manifest shows that principal has a
complete grantable draft and its fresh SoD warning requirements are satisfied.

## Non-Goals

- No partial replacement or bulk update.
- No automatic warning acceptance.
- No catalog retirement/deactivation.
- No resolver enablement, deployment, or Phase 03 work.
