# Material Request Retired Direct Grant UI Design

**Date:** 2026-07-19
**Status:** Approved
**Phase:** Phase 02 - Business Role and Minimal SoD, Closure Task 3 readiness

## Goal

Allow the authenticated governed Direct Grant panel to remove, but never add,
the two approved retired Material Request permissions that can no longer appear
in the current registry:

- `project.material_request.confirm`
- `project.material_request.verify`

## Decision

`PrincipalDirectGrantPanel` derives a retired-grant subset from its already
loaded full draft. When non-empty, the panel displays retirement-only checked
controls. Clearing one control removes only that exact draft entry. The
section is absent otherwise and never offers add, scope, expiry, or a bypass.

The existing fresh backend Preview and governed Save remain the only mutation
path. The B1 reason, warning rules, hard-deny behavior, full-draft preservation,
and audit behavior are unchanged.

## Verification

A source-level UI contract proves the panel defines the exact two-code
allowlist, filters it from the existing drafts, and removes only a selected
retired draft. The test must fail before the component changes and pass after.

## Non-Goals

- No new permission registry action or readiness transition.
- No catalog or migration change.
- No direct SQL, service-role, bulk, or bypass mutation.
- No change to non-retired Direct Grant behavior.
