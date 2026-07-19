# Material Request Readiness Retirement Design

**Date:** 2026-07-19
**Status:** Approved design; implementation planning pending review
**Phase:** Phase 02 - Business Role and Minimal SoD, Closure Task 3 readiness

## Goal

Remove two obsolete Material Request catalog actions from the approved sensitive
regrant decision without inventing a workflow merely to make a Direct Grant
draft grantable:

- `project.material_request.confirm`
- `project.material_request.verify`

The live Material Request lifecycle retains `submit`, `return`, `approve`, and
`confirm_fulfillment`. `confirm_fulfillment` remains the only permission for
the fulfilment-confirmation action.

## Decision

This is a manifest-only retirement. The two obsolete actions remain active and
`declared` in the permission catalog during this tranche. They are not
promoted, deactivated, renamed, remapped, granted, or removed by SQL.

The approved regrant decision is revised so any source key for either obsolete
code is classified `DROP`. All other prior decisions remain unchanged only if
the frozen source and original regrant subset can be reconstructed and verified
exactly in private runtime state.

## Runtime Evidence

Static repository evidence establishes that:

- the Material Request RPC maps fulfilment confirmation to
  `project.material_request.confirm_fulfillment`;
- the current Project Material permission surface exposes
  `confirm_fulfillment`, not either obsolete action;
- no UI, service, transition RPC, or current roadmap lifecycle consumes
  `project.material_request.verify`.

Cloud checks in this tranche are read-only and aggregate-only. They must never
print principal IDs, account data, grant keys, raw manifest records, or private
fingerprint inputs.

## Manifest Revision Gate

The revision is constructed only in a private, mode-restricted runtime file or
session. Before changing a decision, the reconstruction must prove all of the
following from the recorded maintenance criteria:

- frozen source count and source fingerprint match the approved values;
- original regrant count, regrant fingerprint, and DROP count match the
  approved values;
- the sole Permission Admin source remains entirely outside the original
  regrant subset;
- the active regrant rows still have the canonical expiry and standard reason;
- active non-sensitive fingerprint, active Direct Grant count, audit baseline,
  durable operator baseline, and all rollout flags match their approved
  expectations.

Any mismatch is a hard stop. The private runtime artifact is deleted after the
aggregate result is recorded; no identity-bearing data is written to Git,
documentation, or chat.

Only after the original invariants pass may the runtime revision reclassify the
two obsolete codes from `REGRANT` to `DROP`, then calculate and retain only the
new aggregate counts and fingerprints. The new regrant fingerprint replaces the
old fingerprint for later exact gates. The source fingerprint remains unchanged.

## Cloud Boundary

No Cloud mutation is part of this tranche's first checkpoint. In particular it
does not run a permission migration, edit `permission_actions`, repair
migration history, Preview or Save a principal, change a Direct Grant, accept a
warning, assign a Business Role, or enable a rollout flag.

After the revised manifest passes the read-only gate, a separate operator
approval is required before any warned principal is previewed or saved. The
regrant workflow still operates in bounded batches with a fresh backend warning
and independent-control evidence for every principal.

## Verification

Local tests will lock the retirement boundary: obsolete codes cannot enter the
frontend verified allowlist, the current Material lifecycle only uses
`confirm_fulfillment`, and the manifest-revision builder rejects a missing or
inconsistent baseline.

The linked Cloud read-only gate returns aggregates and boolean assertions only:
old-baseline match, revised regrant/DROP arithmetic, revised blocker code count,
pending row/principal count, active sensitive contract match, unchanged
non-sensitive fingerprint, durable operator count, and disabled rollout flags.

The readiness matrix and live apply log record only the resulting aggregate
evidence and the explicit decision. Closure Task 3 remains paused unless the
exact revised-manifest gate proves a complete grantable draft for a principal.

## Non-Goals

- No new Material Request verification workflow.
- No catalog deactivation or data cleanup for the two obsolete actions.
- No dynamic Cloud-read frontend readiness resolver.
- No Phase 03 work, resolver enablement, deployment, or production rollout.
- No edit to applied migrations or the user-owned roadmap.
