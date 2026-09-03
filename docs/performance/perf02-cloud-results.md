# PERF-02 Supabase Cloud query baseline

Captured on 2026-09-03 from the linked Supabase Cloud database using the configured `.env` connection. The audit read catalog metadata and normalized `pg_stat_statements` aggregates only; it did not export application rows or reset statistics.

## Current scale and observed workload

| Table | Estimated rows | Total relation size |
|---|---:|---:|
| `notifications` | 4,597 | 8,120 kB |
| `project_transactions` | 944 | 784 kB |
| `project_tasks` | 860 | 1,544 kB |
| `transactions` | 230 | 696 kB |
| `workflow_instances` | 125 | 544 kB |
| `requests` | 50 | 592 kB |
| `purchase_orders` | 46 | 592 kB |

The pre-deployment statistics still contain legacy PostgREST `LIMIT/OFFSET` shapes. The busiest relevant aggregates were:

| Normalized shape | Calls | Total execution | Mean execution |
|---|---:|---:|---:|
| Workflow-instance read | 11,306 | 2,753,895 ms | 243.58 ms |
| Global request history ordered by `created_date` | 6,859 | 954,025 ms | 139.09 ms |
| Project request list ordered by `created_date, id` | 7,275 | 235,347 ms | 32.35 ms |
| Global transaction history ordered by `date` | 351 | 307,980 ms | 877.44 ms |

These numbers are a baseline, not a before/after claim: the new keyset code has not been deployed yet.

## Existing-index review

Cloud already has exact or near-exact composite indexes for project tasks, notification pages, chat messages, workflow status filters, project request pages, and active purchase-order pages. No additional index is proposed for those paths.

The WMS warehouse indexes are actively used but stop before the new deterministic `id` tie-breaker:

- `idx_transactions_source_wh_date`: 4,917 scans, `(source_warehouse_id, date desc)`.
- `idx_transactions_target_wh_date`: 32 scans, `(target_warehouse_id, date desc)`.
- `idx_transactions_date_desc`: 514 scans, `(date desc)`.

Project request paths already have a five-column index including `id`, but the WMS path filters by `request_origin` without a project/site key. The general `created_date` index has 138 scans and cannot satisfy that equality prefix plus the complete keyset order.

## Supported migration indexes

Only the following additive indexes are included:

- `idx_transactions_source_wh_date_id_perf02`: supports source-warehouse keyset pages.
- `idx_transactions_target_wh_date_id_perf02`: supports target-warehouse keyset pages used by the same OR filter.
- `idx_requests_origin_created_id_perf02`: supports WMS/project-origin keyset pages with `request_origin` as the equality prefix.

At the current table sizes, each index is expected to be roughly 16–40 kB based on adjacent Cloud indexes. `CREATE INDEX CONCURRENTLY` performs two table scans and takes brief catalog locks, but does not hold the write-blocking lock used by ordinary index creation.

The Cloud `index_advisor` helper could not produce a hypothetical plan because the installed `hypopg` extension reported `not more oid available`; no suggestion from that failed helper was used to justify this migration.

## Dry-run and rollout status

- Local migration contract: passed; only the three concurrent additive indexes above are present.
- Linked Cloud dry-run: blocked before SQL execution because local/remote migration history has drifted. Cloud records 151 migrations through `20260830081946`; the CLI requested `--include-all` for hundreds of older local files. That unsafe expansion was not attempted.
- Cloud apply: **not authorized and not run**.
- Security/performance advisors after apply: pending.

Rollback, if needed, removes only these new indexes:

```sql
drop index concurrently if exists public.idx_transactions_source_wh_date_id_perf02;
drop index concurrently if exists public.idx_transactions_target_wh_date_id_perf02;
drop index concurrently if exists public.idx_requests_origin_created_id_perf02;
```
