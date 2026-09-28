# Daily Log: exact 147 → 173 populated, sanitized Cloud rehearsal

**Checkpoint:** 28 September 2026, 20:54 ICT / 13:54 UTC. Candidate code
`d1f084a19facc1e9bf34b9c8704cd50d6884fdc7`, containing main
`4fcca71a1566421d0b5b4922b7618fe0eba911b0`. All numbers are observations at this
checkpoint and must be refreshed before release.

**Result:** the database rehearsal passed for the current 147-version logical
application parent and exactly 26 pending candidate migrations. **Production
release remains on hold; PR #13 stays draft.** This closes the earlier blocker
that the populated rehearsal used a different parent/order. It does not establish
production deployment-runner behavior, full platform/Auth/browser equivalence,
production-scale lock duration, or owner approval.

## Scope and environment

One main agent worked in the isolated PR worktree. No subagent, local Supabase,
Docker, full-data clone, production SQL mutation, main merge, or production pilot
activation was used. The dirty root checkout was read only for instructions and
`.env`; none of its files were edited/staged/restored. The candidate's pre-existing
`supabase/.temp/cli-latest` change remains unstaged.

| Environment | Cloud ref | Final ledger | Use |
| --- | --- | ---: | --- |
| Production | `ftciqmqhmfvjtwoycswe` | 147 | Read-only source and drift checks |
| Independent staging | `kkthixjcficmufpfynqx` | 173 | Logical parent restore and synthetic upgrade |
| PR preview | `fbfmonuiizfeiekxxwph` | 173 | Existing preview, two rollback smokes |
| baseline-vioo-git | `oymkraihhqahqvzahhtx` | 44 | Preserved; ledger read only |

The supplied staging ref is a Dashboard URL in `.env`; it was parsed in memory
and asserted distinct from the other three refs. Staging initially had zero
public tables and Auth users and no migration ledger. PostgreSQL is 17.6 on both
production and staging (production ARM, staging x86). Passwords/tokens were never
printed or put into command arguments. Production sessions enforced
`default_transaction_read_only=on`; staging used its distinct password.

The existing PAT returns **403** on staging project metadata. No dedicated
`SUPABASE_STAGING_ACCESS_TOKEN` was present at the final check. Direct database
access is working; management-plane access, independent verification of staging
GitHub/Auth settings, and project deletion remain unavailable. No workaround
changed the production token. Staging has **not been deleted** and may continue
incurring compute charges until the owner deletes it or provides scoped access.

## Parent reconstruction and proof boundary

A native PostgreSQL 17.10 schema-only dump exported `public`, `app_private`,
`private`, and `supabase_migrations`. A separate read-only export captured the
actual 147 migration ledger rows, one custom Auth profile trigger, 95 Auth/Storage
policies and five non-user configuration catalogs. No real Auth records,
project/operational rows, personal grants, Storage objects, Vault secrets or cron
jobs were copied. The configuration row counts are 18 permission applications,
105 modules, 407 actions, 14 Rooms and 72 Room action bindings; source fingerprints
are retained in the machine-readable results.

Staging extensions were matched to the source versions, including `pg_cron 1.6.4`,
`pg_net 0.20.3`, `btree_gist 1.7`, `pg_trgm 1.6`, `vector 0.8.0`, `unaccent 1.1`,
`hypopg 1.4.1` and `index_advisor 0.2.0`. Native `psql` restored schema objects
with `ON_ERROR_STOP`, without one giant lock-heavy transaction. Existing `public`
creation was made idempotent only in the temporary restore file; candidate
migration SQL was not rewritten.

Two restore issues were resolved before claiming parity:

- `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` was denied near the end of
  the dump. Catalog comparison proved those three source default ACLs already
  matched staging. Remaining `postgres` default privileges were restored.
- Fresh-project factory grants added effective `anon`/`authenticated` access
  beyond the source. Effective ACLs on 1,013 objects were reconciled on staging;
  56 source column grants were also restored. No product permission guard was
  loosened. A dump executing without errors alone would not have proved parity.

The retained [catalog query](2026-09-28-staging-147-173/schema-contract.sql)
compares definitions, owners/effective ACLs, ordered live columns/defaults,
constraints, indexes, routines, views, enums, sequences, RLS policies, custom
triggers and default privileges in the application schemas, plus custom managed
Auth/Storage policies/triggers. It found **16,024 matching entries, zero missing,
zero changed, zero extra**. Dropped-column physical ordinal gaps and ACL ordering
are normalized; this is logical schema equivalence, not physical byte identity.
It does not assert equality of every Supabase-managed schema, role/server setting,
Storage bucket configuration, Edge deployment, Auth setting or production volume.

Only after zero differences were established were the non-user configuration and
**actual full 147-row ledger** loaded into this verified parent. The ledger was
compared byte-for-byte at the JSON row level. This was a staging logical restore
of real history, not a fabricated `migration repair`, replay of old migrations,
or a claim that an empty branch was equivalent. Raw schema/history exports remain
ignored with restricted file modes; they are not committed. The evidence package
contains hashes and sanitized results only.

Outbound isolation was checked before population and after tests: zero cron jobs,
Vault secrets and pending `net.http_request_queue` entries. Four source routines
contain outbound HTTP paths; their source guards require absent Vault credentials
before calling HTTP. No cron schedule or secret was restored and none of those
workers was invoked. Their source definitions were retained for schema parity.

## Exact populated upgrade

The committed
`supabase/tests/daily_log_forward_upgrade_legacy_fixture.sql` seeded one synthetic
project, one WBS task, three legacy logs (verified/draft/rejected), one labor row,
one machine row, one contribution and one manual progress row. No real user or
project was sampled. This small fixture covers legacy compatibility, not load or
locking behavior at production volume.

All 173 candidate SQL files were copied to a disposable CLI directory within the
isolated worktree. The full-file SHA-256 manifest for the 26 pending files was
asserted before execution. Production history was checked again against the
frozen parent. Supabase CLI 2.95.6 was used, with the staging password only in the
environment:

```text
supabase db push --workdir <isolated-staging-cli-workdir> \
  --db-url postgresql://postgres@db.kkthixjcficmufpfynqx.supabase.co:5432/postgres?sslmode=require \
  --include-all --agent=no --yes --dry-run
# Assert listed filenames equal the frozen 26-file manifest, in order.
# Same command without --dry-run, on this staging ref only.
```

Both commands exited 0. [Dry-run](2026-09-28-staging-147-173/upgrade-dry-run.txt)
and [application output](2026-09-28-staging-147-173/upgrade-apply.txt) retain the
exact ordered filenames. Final history is 173 versions: all original 147 rows
unchanged plus precisely the 26 selected versions. No repair or skipped pending
migration was used. The CLI rehearsal uses `--include-all` because pending
versions precede the latest production timestamp. This does **not** verify that
the GitHub production integration will choose the same pending files/order.

Before/after SHA-256 fingerprints and row equality over **all original columns**
matched for all seven fixture tables, both immediately after upgrade and after
all smoke tests. Legacy resources retain `resource_semantics_version = 1`, null
provider-entry mode and null physical quantity/hour fields. There are zero
inferred V2 work items. Migration-added columns are checked separately rather
than incorrectly included in the original-row fingerprint.

## Verification

- Mainline reconciliation: seven additional applied sources normalized against
  the production ledger and pinned by exact SHA-256 contract tests. Watched
  RED→GREEN source/allowlist tests; baseline union also fixed the missing
  `20260928113000` allowlist entry inherited from main. No migration bytes changed.
- Local code at `d1f084a`: **2,613 tests passed, two existing skips**; typecheck,
  lint, query audit (zero findings/errors), migration baseline (173 active / 402
  archived), and build passed. Existing SSR and large-bundle warnings remain.
- GitHub checks at that code head: Typecheck/test/build, Supabase Preview and
  Vercel Preview Comments all successful. PR remained open and draft.
- Fresh local Playwright revision/navigation suite: **4/4 passed** at 1440, 900,
  390 pixels and the locked-period navigation case. This is not a fresh live
  staging Auth/ERP browser run. The earlier full authenticated ERP/visual pilot
  evidence remains historical and is not relabeled as this checkpoint.
- **17 staging SQL smokes passed**, all writes rolled back. The machine-readable
  list covers foundation; publication/idempotency/revisions/audited exception;
  legacy permission/no-money evidence; ten source/summary UX regressions;
  pilot/shadow/pause guard; Room insert/spoof rejection; returned-source retention;
  and the Plan 2 resource evidence read model.
- Resource evidence checks include 40 labor hours / 12 machine hours, catalog and
  manual provider snapshots, inactive supplier preservation, money-field denial,
  cross-scope/denied access, cursor uniqueness, superseded-history visibility
  without current-total duplication, and no project transaction creation.

Persona tests used six synthetic canonical profiles, created through the actual
Auth trigger, scoped Room grants and `SET LOCAL ROLE authenticated` plus JWT
claims. All six business actors were asserted `EMPLOYEE`, not admin. Fixture IDs
were mapped to their generated canonical profile IDs in memory; assertions and
product SQL were unchanged. The area-history smoke additionally needed a
rollback-only setup admin because its existing setup explicitly queries an
admin. Its user actions still assert non-admin behavior.

Failed setup attempts are not counted as passes: area-history initially lacked
that setup admin; resource setup initially used an invalid legacy machine column
and was corrected to the observed schema. Its next run hit the test's literal
`900000` money sentinel because a synthetic lineage UUID began `79000000`;
changing only that fixture UUID prefix to `7a000000` cleared the false positive
with the same money assertion unchanged. Final relevant reruns passed. No
application or migration fix was needed.

## Final safety inventory

At 13:53:54 UTC production history **and the compared application catalog** still
matched the frozen 147-version parent. Production had 62 Auth users, 86 projects,
323 logs, 827 labor rows, 408 machine rows, 1,100 transactions and ten active cron
jobs. These were read-only observations, not exported data.

Staging retained only the named legacy fixture: one project, three logs, one labor
and one machine row. Auth users, project transactions, V2 work items, publication
commands, rollout scopes, cron jobs, Vault secrets and pending HTTP queue were
all **zero**. Preview is 173; baseline remains 44. Git main remains `4fcca71`.

See [results and hashes](2026-09-28-staging-147-173/results.json). This is a main
agent self-review; no independent reviewer was used, per the owner's instruction.

## Production decision checklist — not executed

1. Obtain staging management/API access or owner verification of GitHub/Auth
   settings; complete any required fresh authenticated staging UI acceptance.
   Retain this evidence, verify exact ref `kkthixjcficmufpfynqx` and delete only
   that temporary project when cleanup access is available. The owner already
   authorized cleanup; a new release approval does not need to cover deletion.
2. Refresh main, production full history/catalog and candidate checks immediately
   before release. If the parent or pending manifest differs from this checkpoint,
   stop and reconcile/rehearse the changed path; these results are not transferable
   by migration count alone.
3. Resolve and record the production execution mechanism. Confirm the enabled
   GitHub deployment handles the same 26 retroactive pending versions/order, or
   present an explicit separately approved operator deployment procedure. Do not
   assume a successful empty preview or CLI `--include-all` proves auto-deploy.
4. Record release owner/window, current backup/PITR recovery availability and
   restore decision owner, previous app artifact, monitoring and stop thresholds.
   No claim about current recovery availability is made by this rehearsal.
5. Request **separate explicit owner approval** naming PR/head, production ref,
   the migration manifest and deployment mechanism. Approval to rehearse is not
   approval to merge/deploy. Keep the PR draft until this decision.
6. After an approved deployment, verify exact ledger/source set and scoped
   non-destructive permission/legacy/evidence checks before activating a cohort.
   Use the existing Daily Log operator audit operation and
   [runbook](../../runbooks/erp-completion-pilot-rollout.md#daily-log-wbs-pilot-riêng-không-dùng-mode-của-procurement):
   explicit project/site, active owner, release, cutover and least required Room
   actions. Start pilot/shadow; enforce only after fresh matching comparisons.
7. On duplicate progress, permission leak, unexpected money/transactions or failed
   invariant, stop rollout. Use the audited `paused`/`off` operation where safe,
   retain all source/snapshot/audit rows and restore the previous app artifact if
   compatible. `paused`/`off` returns progress authority to legacy; it does not
   freeze all writes. Never drop the new schema, delete evidence, repair history
   or overwrite real data as an automatic rollback. Database recovery/forward fix
   requires its own reviewed decision and approval.
