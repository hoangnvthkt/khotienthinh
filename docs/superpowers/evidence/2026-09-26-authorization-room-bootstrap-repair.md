# Authorization Room bootstrap repair — 2026-09-26

## Scope and status

Separate branch `codex/authorization-bootstrap-repair`, based on PERF02
`28ba180d2f30ea29a7a2ca8281e8fe5b0ede445c`. No Daily Log, Project V2,
Procurement V2, root-workspace changes, production deployment, or actor grants.
The missing Room inventory regression is addressed; full preview bootstrap is
**still blocked by a separate HRM data-reconciliation precondition**. Draft only.

## Root cause and minimal repair

Disposable PR #9 Cloud preview `xllopwgistvwjwpkchtb` had 363 permission
actions, zero Rooms, zero bindings, zero retirement dispositions, and zero
users. The baseline is schema-only. Phase 4 expected archived Room reference
metadata that was not rehydrated after the baseline boundary.

New migration restores exactly nine metadata-only SQL sections from the
versioned pre-baseline archive, in historical order. Source filenames are
recorded next to each section and tested for byte-identical SQL. No archived
functions, domain migrations, memberships, grant backfills, or users are
replayed. The existing Phase 4 migration and its security guards are unchanged.

Any existing catalog is a strict no-op, even if partial: it must not be silently
rewritten. An empty catalog with users, projects, staff, memberships, grants,
or bindings fails closed. Catalog initialization is serialized with table locks.

The file was regenerated with `supabase migration new`, then explicitly ordered
as version `20260903063822` after PERF02 and before catalog consumers. A current
timestamp would execute too late to fix bootstrap. The baseline itself is not
modified. This historical dependency insertion is **not authorization for
production history repair or an include-all deployment**; production rollout
requires its own migration-history review and approval.

## Verification

- TDD RED on Cloud: without repair, the 14-Room assertion fails.
- GREEN: restores 14 Rooms; unchanged Phase 4 retirement/enforcement runs;
  all original final binding, fallback, stale-membership and retirement guards pass.
- Existing-catalog sentinel remains untouched, with no generated bindings.
- Empty catalog plus rollback-only project fixture is rejected with
  `AUTHORIZATION_BOOTSTRAP_NONEMPTY`.
- All Cloud cases roll back; the no-data preview inventory remains unchanged.
- Local regression: 11 tests pass; full suite: 2,254 pass, 2 skipped.
- Typecheck, build, migration baseline check (113 active / 402 archived),
  query inventory check (zero findings/errors), and diff whitespace check pass.
- Existing dependency audit and bundle-size warnings are outside this repair.
- Main-agent review: only reference catalog/binding DML, no new ACL/RLS/function
  changes. No sub-agent review, per the user's explicit restriction.

Reproduce scoped Cloud checks (authorized root environment; hardcoded test ref):

```sh
node --env-file=/Users/admin/khotienthinh/.env scripts/smoke-authorization-bootstrap-cloud.mjs
```

## Next independent blocker — not repaired

The optional `--remaining-chain` rollback advances past Phase 4, then fails at
`20260911041501_authorization_v2_task12_3_restore_own_attendance_scope.sql`:
`Task 12.3 found no migrated view-only HR profile to reconcile`.

Phase 5 creates LEGACY_HR templates from actual pre-cutover users. A no-data
preview correctly has no such profiles. Task 12.3 nevertheless requires a
view-only profile and later an operator profile to exist. Do not seed fake
HR profiles/users/grants merely to satisfy these assertions. A separate,
authorized repair must distinguish an empty bootstrap from a populated
reconciliation while retaining the production security invariants.

The full-chain failure is reported, not skipped or claimed as success. Its
transaction also rolls back and verifies the preview inventory is unchanged.
No preview was deleted/recreated, and baseline-vioo-git remains untouched.
