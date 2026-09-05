# Material issue reversal and return rollout

## Release

- Date: 2026-09-05 (Asia/Ho_Chi_Minh)
- Supabase project: `ftciqmqhmfvjtwoycswe`
- Migration: `20260905041938_material_issue_approval_reversal_return.sql`
- Release-candidate source commit: `4ff8f03d1102`
- Status: preflight passed; Cloud apply pending

## Verification before apply

- `npm test`: 346 files, 1639 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed (only existing chunk-size warnings).
- `npm run audit:supabase-queries`: 0 findings, 0 errors.
- `npm run check:supabase-migrations`: passed; 8 active and 402 archived SQL files.
- `git diff --check`: passed.
- Cloud rollback runner: migration plus
  `material_issue_reversal_return_smoke.sql` passed. The smoke response reported
  `materialIssueApprovalReversal=ok`, `safeUnusedReturn=ok`, and
  `transaction=rollback`.
- Cloud migration dry-run listed exactly one pending file: the release migration.
- Security and performance advisors both exited successfully with
  `--fail-on error`. They returned existing workspace-level warnings and no
  blocking error.

## Cloud preflight

Captured at `2026-09-05T04:49:34.464724+00:00`:

| Check | Value |
| --- | --- |
| Item stock checksum | `11d8902c220e160b67d0baa411bdf6e8` |
| Inventory balance checksum | `520444c8aabc8310ded5e1231e1e38b6` |
| Inventory on-hand total | `58133.9445` |
| Inventory value total | `1900529126908.6472` |
| Issue equation violations | `0` |
| Completed WMS without inventory ledger | `1` |

The single pre-existing WMS/ledger exception is transaction
`e663c294-1251-43cc-b587-b3258771e165`, a completed inventory adjustment dated
2026-06-20. This rollout does not backfill or alter it; postflight must preserve
the count and identity.

Status counts before apply:

- Material issue orders: `cancelled=22`, `closed=3`, `issued=14`,
  `received=19`, `rejected=2`.
- Material issue returns: `cancelled=1`, `completed=2`.
- WMS transactions: `APPROVED=1`, `CANCELLED=37`, `COMPLETED=192`, `PENDING=10`.

## Apply and postflight

To be completed after the release-candidate commit is created. The apply must
use `supabase db push --linked` with the configured Cloud password. The smoke is
transactional and must leave no fixtures. Postflight must confirm unchanged
stock/balance checksums and totals, the expected ACLs, capability metadata, and
migration history.
