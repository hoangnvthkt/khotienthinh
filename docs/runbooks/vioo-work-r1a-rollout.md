# Vioo Work R1A rollout

## Release controls

- Supabase project: `ftciqmqhmfvjtwoycswe`
- Delivery branch: `feature/vioo-work-r1a`
- Source baseline: `74d18a1`
- Approved design: `e251c9a`
- Feature flag: `VITE_ENABLE_VIOO_WORK=false`
- Pilot access: canonical grants to named users only
- Database target: linked Supabase Cloud only; no local database or Docker

## Baseline evidence

Captured on 2026-09-07 before Work implementation:

- Local and Cloud migration ledgers match through
  `20260905041938_material_issue_approval_reversal_return.sql` (8/8 active migrations).
- `npm test -- --reporter=dot`: 346 files and 1,639 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed with the existing chunk-size warning only.
- `npm run check:supabase-migrations`: passed; 8 active and 402 archived SQL files.
- `npm run audit:supabase-queries`: 0 findings and 0 errors.
- `npm ci`: completed without tracked-file changes. Existing dependency audit result:
  14 vulnerabilities (1 low, 5 moderate, 6 high, 2 critical); remediation is not
  included in the Work rollout because forced upgrades may be breaking.

## Mandatory migration checkpoint

For every Work migration:

1. Run its Cloud rollback smoke test.
2. Commit the release candidate with explicit paths only.
3. Run `supabase db push --linked --dry-run` with the repository `.env` loaded.
4. Apply only the expected migration to project `ftciqmqhmfvjtwoycswe`.
5. Run postflight checks and record evidence below.

Never amend a migration that has been applied. Roll back behavior with the feature
flag and repair schema or data with a forward migration.

## Rollout gates

- [x] Permission catalog and route boundary verified.
- [ ] Core schema/RLS and six-persona Cloud smoke verified.
- [ ] Commands, lifecycle, SLA, collaboration, and outbox verified.
- [ ] Private Storage and upload processor verified.
- [ ] Responsive UI verified at 360x800, 768x1024, and 1440x900.
- [ ] Named pilot grants reviewed; no bulk grants exist.
- [ ] Feature flag enabled only for the approved deployment environment.
- [ ] Forty-eight-hour observation completed.

## Cloud rollout evidence

Append migration dry-run/apply output, smoke personas, query plans, advisor results,
Edge Function deployment, pilot grants, and the 48-hour observation summary here.

### Task 1 — canonical permission boundary (2026-09-07)

- Applied `20260907012229_work_r1a_permission_registry.sql` after rollback smoke,
  release-candidate commit and linked dry-run.
- Authenticated-role regression exposed an overly broad EXECUTE revocation on
  the existing `app_private.has_permission` helper. Forward migration
  `20260907015936_work_r1a_restore_permission_execution.sql` restored the baseline
  authenticated EXECUTE grant. Its rollback smoke, isolated dry-run/apply and
  authenticated-role postflight passed. Applied migration files were not amended.
- Frontend denies unknown Work routes and technical ADMIN without canonical
  grants. Module visibility uses the canonical `access` action, not a legacy key.
- Flag remains off; no pilot grants or Work legacy aliases were created.

### Task 2 — core schema release candidate (2026-09-07)

- Candidate: `20260907021001_work_r1a_core_schema.sql`.
- Real Cloud transaction smoke uses `SET LOCAL ROLE authenticated` with ten
  synthetic JWT contexts: creator, assignee, watcher, reviewer, scoped manager,
  unrelated user, inactive user, restricted manager, technical ADMIN without
  Work grants, and department-scoped watcher. All fixtures roll back.
- RED/GREEN checks caught and fixed: helper EXECUTE access, seven-digit code
  truncation, mutable task identity/history, cross-task reply/mention/transfer,
  bucket scope rewriting, missing FK indexes/private RLS, scoped view grants,
  and audit scope incorrectly treating an unrelated manager as assigned.
- Cloud smoke passed for standard/restricted visibility, department/project
  isolation, audit grants, direct UPDATE denial, immutable histories and schema
  integrity. This is database-role testing, not yet the R1A HTTP/JWT acceptance
  suite, Storage smoke, concurrency/load tests or scaled EXPLAIN evidence.
- Targeted frontend/migration regression: 53 tests across 7 files passed.
- `npm run lint` and `npm run build` passed (existing chunk-size warning).
- Migration baseline: 11 active files, 402 archived; query audit: 0 findings.
- Pre-apply Cloud security advisor at `--level error`: no issues.
- Security design follows the grants-plus-RLS separation in
  [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).
- Core apply/postflight: pending; feature remains disabled.
