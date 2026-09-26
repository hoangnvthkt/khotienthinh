# HRM Task 12.3 bootstrap guard — 2026-09-26

## Authorized scope

Separate branch `codex/hrm-bootstrap-guard`, based on Room bootstrap repair
`e8dae23` (PR #11). Only the Task 12.3 empty-bootstrap guard and rollback test
utilities change. No Project V2, Procurement V2, Daily Log runtime, production,
actor creation, or persistent grants are changed. Main agent only.

## Cause and repair

Phase 5 derives LEGACY_HR profiles from actual pre-cutover actors. A schema-only
preview has no actors and correctly generates no profiles. Task 12.3 previously
required both a migrated view-only profile and a remaining operator profile,
even in that empty database.

Task 12.3 now snapshots a narrowly defined empty bootstrap: no auth/public
users, projects, staff, legacy actor snapshots, LEGACY_HR profiles, role
assignments, or direct grants. Only this condition skips the two inventory
assertion blocks. Canonical-only authorization is still mandatory, including
on an empty preview. Existing reconciliation DML and all original populated
inventory assertions are unchanged.

The historical migration's bootstrap precondition is adjusted because a later
migration cannot unblock an earlier failure. No new migration version, ledger
repair, or replay of the applied migration on production is performed. A
production merge/deployment remains separately authorized work.

## TDD and Cloud evidence

Disposable no-data preview: `xllopwgistvwjwpkchtb`. Root `.env` supplies the
Management API token. No Supabase local or Docker. All fixtures exist only
inside rollback transactions, never as fake bootstrap seed profiles/grants.

RED: the empty-bootstrap regression fails with the original
`Task 12.3 found no migrated view-only HR profile to reconcile` error.

GREEN: seven real SQL migration cases pass:

1. Empty bootstrap succeeds and creates no LEGACY_HR profiles or actor grants.
2. Empty bootstrap still refuses non-canonical authorization.
3. A project-populated database still refuses the missing profile inventory.
4. Operator-only inventory still fails the view-only-profile precondition.
5. View-only inventory still fails the operator-preservation postcondition.
6. View-only attendance changes to `own`; the operator's two global items remain.
7. An existing own-scope item survives without a uniqueness conflict.

Every case compares the preview actor/catalog/grant inventory before and after
rollback. The combined Room/Authorization chain through Task 12.3 also passes:
10 migrations, plus the Room bootstrap and retirement setup, in Cloud rollback.

Commands:

```sh
node --env-file=/Users/admin/khotienthinh/.env scripts/smoke-hrm-bootstrap-cloud.mjs
node --env-file=/Users/admin/khotienthinh/.env scripts/smoke-authorization-bootstrap-cloud.mjs --through-hrm
```

Repository verification: 2,254 tests pass / 2 skipped; typecheck, build,
migration baseline (113 active / 402 archived), query inventory (zero
findings/errors), and whitespace checks pass. Existing bundle-size warnings
are outside scope. Main-agent review confirms no new ACL/RLS/runtime-function
changes and no widening of populated-database guards.

## Remaining integration gate

This repairs the HRM blocker, not a claim that the entire fresh preview pipeline
has passed. The all-in-one `--remaining-chain` rollback reaches the later Workflow
DRAFT enum migrations, then reports PostgreSQL 55P04: new enum values must be
committed before use. The repository already separates enum addition
(`20260916102000`) and use (`20260916102100`) into distinct migrations.
Do not change those unrelated migrations to satisfy a single-transaction test.

A full bootstrap must be verified through the real pipeline with each migration
transaction committed separately on a disposable preview. Current preview slots
are occupied by baseline-vioo-git and the failed PR #9 preview; neither was
deleted or mutated persistently during this repair. No full bootstrap, Daily Log
integration Completion Gate, or merge readiness is claimed here. The older Room
repair evidence describes its earlier state; this record supersedes its HRM
blocker status only.
