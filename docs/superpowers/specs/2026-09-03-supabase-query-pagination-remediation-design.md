# Supabase Query Pagination Remediation Design

**Status:** Approved direction from the PERF-02 review on 2026-09-03

## Problem

The current production TypeScript/JavaScript tree contains 813 `.select(...)` calls, including 496 `.select('*')` calls. Static inspection identifies 291 wildcard reads without an explicit `.limit()`, `.range()`, `.single()`, `.maybeSingle()`, or `head: true` in the same query chain. The earlier AI report therefore identifies a real problem, although its counts were produced from an older or narrower scan.

The main risks are:

- Supabase Data API result limits can silently truncate growing datasets.
- Large wildcard payloads increase network, parsing, and browser-memory cost.
- Client-side pagination over a truncated dataset gives a false impression of completeness.
- Adding a fixed `.limit()` alone can hide older records and is not a complete pagination solution.
- A broad rewrite can break screens that currently depend on globally hydrated arrays.

## Goals

1. Every list query has an explicit server-side result policy.
2. Growing operational lists use stable keyset pagination with a deterministic tie-breaker.
3. Reads that intentionally require all matching rows fetch every page explicitly and enforce a documented safety cap.
4. List screens select only the fields needed by the list model; detail fields load on demand.
5. Existing permissions, RLS behavior, realtime invalidation, exports, calculations, and deep links remain unchanged.
6. CI prevents new unsafe wildcard or unbounded list queries.
7. Database indexes are added only after Cloud evidence shows that the new filter/order shape needs them.

## Non-goals

- No blanket replacement of every `.select('*')` with `.limit(1000)`.
- No local Supabase or Docker environment.
- No schema redesign unrelated to query pagination.
- No change to RLS policy semantics or user permissions.
- No deletion of historical records.
- No reset of shared `pg_stat_statements` statistics.

## Query classification

Every finding in the generated audit manifest must be assigned exactly one policy:

| Policy | Intended use | Required shape |
|---|---|---|
| `page` | User-facing, growing list | Explicit projection, stable order, `limit + 1`, opaque keyset cursor, `nextCursor` |
| `all_pages` | Export, reconciliation, batch calculation that requires completeness | Explicit projection, deterministic keyset loop, chunked filters, maximum-row guard, abort/error propagation |
| `detail` | One entity | Primary/unique-key filter plus `.single()` or `.maybeSingle()`, explicit detail projection |
| `catalog` | Deliberately small reference data | Explicit projection and hard cap; fail visibly if the cap is reached |
| `count` | Count/existence check | `head: true` with count, or ID-only `.limit(1)` |
| `mutation_return` | Row returned after insert/update/upsert | Explicit return projection plus `.single()`/`.maybeSingle()` where cardinality is one |

An allowlist entry is permitted only for a documented singleton, count, or bounded catalog. It must include an owner, reason, maximum expected rows, and expiry/review date.

## Pagination contract

Growing lists use keyset pagination. Descending time-ordered lists sort by the business timestamp and then `id`, both descending. The next-page predicate is equivalent to:

```sql
where business_timestamp < cursor_timestamp
   or (business_timestamp = cursor_timestamp and id < cursor_id)
order by business_timestamp desc, id desc
limit page_size + 1;
```

Page sizes are clamped to 1–100 unless an existing domain contract has a stricter maximum. The service returns:

```ts
export interface CursorPage<T, C> {
  items: T[];
  nextCursor?: C;
}
```

For tables without a reliable timestamp, the cursor is the ordered primary key. Cursor values remain opaque to UI components.

## Complete-read contract

Exports and calculations that require every row do not reuse UI pagination. They call a dedicated multi-page reader with:

- explicit columns;
- deterministic keyset ordering;
- a per-request page size no greater than 1,000;
- chunking for large `.in(...)` filters;
- a domain-specific maximum row count;
- an error when the maximum is exceeded, rather than returning an incomplete result;
- optional `AbortSignal` propagation for cancellable UI operations.

## Frontend state and realtime

`AppContext` remains responsible for session-wide reference catalogs and realtime event routing. It stops being the source of truth for growing transaction and request histories. Each list screen owns its first page, filters, cursor, loading-more state, and targeted realtime invalidation.

Realtime INSERT/UPDATE/DELETE events either patch an item already present in a page or invalidate and reload the first page. They do not trigger re-fetching every historical page.

## Rollout and rollback

The cutover is split by domain. A build-time flag exists only during each domain migration, defaults to the existing path, and is removed after Cloud verification. Old and new paths are never mixed in one rendered list.

Each domain follows this sequence:

1. Add service contract and tests.
2. Add required Cloud index only after inspection.
3. Ship the new path disabled.
4. Enable for internal users/staging deployment.
5. Compare row identity, first-page ordering, filters, deep links, payload, latency, and error rates.
6. Enable for production.
7. Remove the old path and flag in the next small release.

Rollback consists of disabling the domain flag or reverting its isolated frontend commit. Index migrations are additive and remain safe during frontend rollback.

## Security and Cloud rules

- Use the configured Supabase Cloud project from `.env`; never use local Supabase or Docker.
- The browser continues using the public client key. No service-role credential is added to client code or audit output.
- Explicit projections must not widen fields currently protected by RLS or guarded RPCs.
- Query diagnostics store normalized query shape and aggregate timing only; they do not export row data or PII.
- Schema/index changes use generated migration filenames and are reviewed with Security and Performance Advisors before rollout.

## Acceptance criteria

- The audit manifest has no unclassified findings.
- No user-facing growing list uses client-only pagination over an unbounded Supabase read.
- No approved `page` query contains `.select('*')`.
- Every `page` query has deterministic order, a clamped limit, and a tested next cursor.
- Every `all_pages` query proves completeness beyond 1,000 rows and fails explicitly at its safety cap.
- `AppContext.fetchTableHelper` has no default wildcard query.
- CI rejects any new unclassified wildcard or unbounded list query.
- Focused domain tests, full Vitest, TypeScript, and production build pass.
- Cloud smoke tests confirm first-page parity, deep-link detail loading, and complete export/calculation behavior.
- Supabase Security/Performance Advisors show no new error-level finding caused by this work.

