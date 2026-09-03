# Supabase Query Pagination Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Workspace `AGENTS.md` prohibits sub-agents.

**Goal:** Remove unsafe wildcard and unbounded Supabase list reads across Vioo without truncating data or breaking existing workflows.

**Architecture:** Generate an authoritative query manifest, classify each read as page/detail/catalog/count/mutation-return/all-pages, and migrate one domain at a time. Growing lists use explicit projections and keyset cursors; complete operations use a separately tested multi-page reader. `AppContext` keeps small reference data but no longer hydrates growing histories globally, and CI blocks new violations.

**Tech Stack:** React 18, TypeScript 5.8, Supabase JS 2.98, Supabase Cloud Postgres, Vitest 4, Node 24, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-03-supabase-query-pagination-remediation-design.md`

## Global Constraints

- Use Supabase Cloud from `.env`; never use Supabase local or Docker.
- Execute implementation in an isolated git worktree so the current dirty workspace and unrelated user changes remain untouched.
- Do not expose service-role or secret credentials in browser code, test output, audit artifacts, or commits.
- Do not change RLS semantics or permission scope as part of PERF-02.
- Preserve realtime behavior, filters, deep links, exports, calculations, and user-visible ordering.
- Use keyset pagination for growing lists; do not introduce deep OFFSET pagination.
- Add indexes only after Cloud query-shape and index inspection; every index migration is additive.
- Do not modify, stage, or restore unrelated dirty-worktree files.
- Do not modify, stage, or restore `supabase/.temp/cli-latest`.
- Do not push commits or Cloud migrations unless the user explicitly authorizes that step.
- Run the focused test before and after each implementation slice; run the full verification gate before each rollout.

---

### Task 1: Create the authoritative PERF-02 query inventory and CI guard

**Files:**
- Create: `scripts/lib/supabaseQueryAudit.mjs`
- Create: `scripts/audit-supabase-queries.mjs`
- Create: `scripts/supabase-query-policy.json`
- Create: `scripts/fixtures/supabase-query-audit-safe.ts`
- Create: `scripts/fixtures/supabase-query-audit-unsafe.ts`
- Create: `lib/__tests__/supabaseQueryAudit.test.ts`
- Create: `docs/performance/supabase-query-inventory.json`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `analyzeSource(source, filePath): QueryFinding[]`.
- Produces: `scanWorkspace(rootDir, policy): QueryAuditReport`.
- Produces: `npm run audit:supabase-queries` for a readable report.
- Produces: `npm run check:supabase-queries` for a non-zero exit when a new or unclassified violation appears.
- Produces: the inventory consumed by Tasks 3–9; each finding has `fingerprint`, `file`, `line`, `table`, `projection`, `modifiers`, `classification`, and `owner`.

- [ ] **Step 1: Write fixture-driven failing tests for query classification**

Add fixtures covering a wildcard list, explicit cursor page, singleton, head count, fixed-limit catalog, mutation return, and a query assigned filters after initial builder creation.

```ts
it('flags wildcard lists and accepts explicit keyset pages', async () => {
  const unsafe = await readFixture('supabase-query-audit-unsafe.ts');
  const safe = await readFixture('supabase-query-audit-safe.ts');

  expect(analyzeSource(unsafe, 'unsafe.ts')).toEqual(expect.arrayContaining([
    expect.objectContaining({ rule: 'wildcard-list', severity: 'error' }),
    expect.objectContaining({ rule: 'missing-result-policy', severity: 'error' }),
  ]));
  expect(analyzeSource(safe, 'safe.ts').filter(row => row.severity === 'error')).toEqual([]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx vitest run lib/__tests__/supabaseQueryAudit.test.ts
```

Expected: FAIL because the analyzer module does not exist.

- [ ] **Step 3: Implement syntax-aware scanning and stable fingerprints**

Use the TypeScript compiler API already present in `devDependencies`. Detect Supabase `.from(...).select(...)` chains, follow assigned query builders within a function, and classify terminal modifiers. Do not classify from raw string matching alone.

```js
export function fingerprintFinding({ file, table, projection, functionName }) {
  return `${file}::${functionName || '(module)'}::${table || '(dynamic)'}::${projection}`;
}

export function isBoundedQuery(modifiers) {
  return modifiers.has('range')
    || modifiers.has('limit')
    || modifiers.has('single')
    || modifiers.has('maybeSingle')
    || modifiers.has('head:true');
}
```

The policy JSON must use explicit entries, not a global wildcard waiver:

```json
{
  "version": 1,
  "allowedClassifications": ["page", "all_pages", "detail", "catalog", "count", "mutation_return"],
  "allowlist": []
}
```

- [ ] **Step 4: Generate and review the initial inventory**

```bash
node scripts/audit-supabase-queries.mjs --write docs/performance/supabase-query-inventory.json
node scripts/audit-supabase-queries.mjs --summary
```

Expected: the report records the baseline counts and every finding; generation does not fail merely because legacy findings exist.

- [ ] **Step 5: Add ratchet mode to package scripts and CI**

Add:

```json
{
  "scripts": {
    "audit:supabase-queries": "node scripts/audit-supabase-queries.mjs --summary",
    "check:supabase-queries": "node scripts/audit-supabase-queries.mjs --check docs/performance/supabase-query-inventory.json"
  }
}
```

Add `npm run check:supabase-queries` after `npm run lint` in `.github/workflows/ci.yml`. Ratchet mode fails on new fingerprints, worsened classifications, missing owner/reason metadata, or removed pagination; it permits the checked-in legacy baseline until each later task removes findings.

- [ ] **Step 6: Verify the guard**

```bash
npx vitest run lib/__tests__/supabaseQueryAudit.test.ts
npm run check:supabase-queries
```

Expected: PASS. Temporarily adding a fixture violation must make the focused test fail; restore the fixture before committing.

- [ ] **Step 7: Commit the audit foundation**

```bash
git add scripts/lib/supabaseQueryAudit.mjs scripts/audit-supabase-queries.mjs scripts/supabase-query-policy.json scripts/fixtures lib/__tests__/supabaseQueryAudit.test.ts docs/performance/supabase-query-inventory.json package.json .github/workflows/ci.yml docs/superpowers/specs/2026-09-03-supabase-query-pagination-remediation-design.md docs/superpowers/plans/2026-09-03-supabase-query-pagination-remediation.md
git commit -m "test(perf): inventory unsafe Supabase reads"
```

---

### Task 2: Add shared cursor and complete-read contracts

**Files:**
- Create: `lib/supabasePagination.ts`
- Create: `lib/__tests__/supabasePagination.test.ts`
- Create: `lib/__tests__/activityService.test.ts`
- Modify: `lib/activityService.ts`
- Modify: `lib/notificationService.ts`

**Interfaces:**
- Produces: `CursorPage<T, C>`, `clampPageSize`, `takeCursorPage`, `encodeCursor`, `decodeCursor`, `chunkValues`, and `fetchAllPages`.
- Keeps `activityService.listPage` and `notificationService.listPage` as reference implementations.

- [ ] **Step 1: Write failing tests for cursor stability, page boundaries, chunking, cancellation, and safety caps**

```ts
it('returns a cursor only when limit plus one proves another page', () => {
  const result = takeCursorPage([{ id: '3' }, { id: '2' }, { id: '1' }], 2, row => row.id);
  expect(result).toEqual({ items: [{ id: '3' }, { id: '2' }], nextCursor: '2' });
});

it('fails instead of returning an incomplete complete-read result', async () => {
  await expect(fetchAllPages({
    pageSize: 2,
    maxRows: 3,
    loadPage: async cursor => cursor ? { items: [{ id: 3 }, { id: 4 }] } : { items: [{ id: 1 }, { id: 2 }], nextCursor: '2' },
  })).rejects.toThrow('exceeded safety cap of 3 rows');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx vitest run lib/__tests__/supabasePagination.test.ts
```

Expected: FAIL because the pagination module does not exist.

- [ ] **Step 3: Implement the shared types and pure helpers**

```ts
export interface CursorPage<T, C> {
  items: T[];
  nextCursor?: C;
}

export const clampPageSize = (value: number | undefined, fallback = 50, maximum = 100) =>
  Math.min(Math.max(Math.floor(Number(value || fallback)), 1), maximum);

export async function fetchAllPages<T, C>(input: {
  pageSize: number;
  maxRows: number;
  signal?: AbortSignal;
  loadPage: (cursor?: C) => Promise<CursorPage<T, C>>;
}): Promise<T[]>;
```

Reject repeated cursors, non-positive caps, abort signals, and results beyond `maxRows`. Keep Supabase query construction inside domain services so RLS and projections remain visible at call sites.

- [ ] **Step 4: Refactor the two existing reference services without behavior changes**

Use `clampPageSize` and `takeCursorPage` in `activityService.listPage` and `notificationService.listPage`. Do not change their projections, cursor order, or public result types.

- [ ] **Step 5: Verify reference services and commit**

```bash
npx vitest run lib/__tests__/supabasePagination.test.ts lib/__tests__/activityService.test.ts lib/__tests__/notificationService.test.ts
npm run lint
git add lib/supabasePagination.ts lib/__tests__/supabasePagination.test.ts lib/__tests__/activityService.test.ts lib/activityService.ts lib/notificationService.ts
git commit -m "refactor(perf): standardize Supabase pagination contracts"
```

---

### Task 3: Move WMS transactions and material requests out of global unbounded hydration

**Files:**
- Create: `lib/wmsTransactionListService.ts`
- Create: `lib/__tests__/wmsTransactionListService.test.ts`
- Create: `lib/__tests__/appContextPagedReads.test.ts`
- Create: `lib/__tests__/materialRequestPagination.test.ts`
- Modify: `lib/materialRequestService.ts`
- Modify: `lib/requestRuntimeService.ts`
- Modify: `context/AppContext.tsx`
- Modify: `pages/Inventory.tsx`
- Modify: `pages/Operations.tsx`
- Modify: `pages/request/RequestList.tsx`
- Modify: `components/RequestModal.tsx`
- Modify: `lib/featureFlags.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `wmsTransactionListService.listPage(filters): Promise<CursorPage<TransactionSummary, TransactionCursor>>`.
- Produces: `wmsTransactionListService.getById(id): Promise<Transaction | null>`.
- Reuses: `requestRuntimeService.list(filters)` and detail loading by request ID.
- Removes after cutover: `transactions` and `requests` as full-history data sources from WMS module hydration.

- [ ] **Step 1: Add RED tests for more-than-1,000-row completeness and stable page order**

Use a Supabase query-builder fake that returns duplicate timestamps around the page boundary. Assert that the service orders by `date desc, id desc`, requests `limit + 1`, uses both cursor fields, selects only summary columns, and loads detail separately by ID.

```ts
expect(query.calls).toContainEqual(['order', 'date', { ascending: false }]);
expect(query.calls).toContainEqual(['order', 'id', { ascending: false }]);
expect(query.calls).toContainEqual(['limit', 51]);
expect(query.selectedColumns).not.toBe('*');
```

- [ ] **Step 2: Add a source-contract test that protects AppContext**

```ts
it('does not hydrate growing WMS histories through fetchTableHelper', () => {
  const source = readFileSync('context/AppContext.tsx', 'utf8');
  expect(source).not.toMatch(/fetchTableHelper\('transactions'/);
  expect(source).not.toMatch(/fetchTableHelper\('requests'/);
  expect(source).not.toMatch(/query:\s*any\s*=\s*supabase\.from\(table\)\.select\('\*'\)/);
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

```bash
npx vitest run lib/__tests__/wmsTransactionListService.test.ts lib/__tests__/appContextPagedReads.test.ts
```

Expected: FAIL on the missing service and current `fetchTableHelper` calls.

- [ ] **Step 4: Implement explicit WMS list/detail projections and cursor service**

Define `WMS_TRANSACTION_LIST_SELECT` and `WMS_TRANSACTION_DETAIL_SELECT`. The list projection must include only fields rendered in the list/filter/status UI; the detail projection includes item JSON and attachments only when opening a transaction.

- [ ] **Step 5: Convert WMS and Request screens under isolated rollout flags**

Add flags defaulting to false:

```ts
export const isPerf02WmsPagingEnabled = import.meta.env.VITE_ENABLE_PERF02_WMS_PAGING === 'true';
export const isPerf02RequestPagingEnabled = import.meta.env.VITE_ENABLE_PERF02_REQUEST_PAGING === 'true';
```

The new branches own page items, next cursor, filters, loading-more, deep-link detail, and retry state. A realtime event reloads page one or patches a loaded row; it never fetches full history.

- [ ] **Step 6: Remove global history reads after parity is proven**

Make `fetchTableHelper(table, query)` require an explicit query. Keep small WMS catalogs in context with explicit projections. Remove the transaction/request fetches at current module-load locations and update consumers to use the services.

- [ ] **Step 7: Verify and commit the WMS/Request slice**

```bash
npx vitest run lib/__tests__/wmsTransactionListService.test.ts lib/__tests__/appContextPagedReads.test.ts lib/__tests__/materialRequestPagination.test.ts lib/__tests__/requestRuntimeService.test.ts
npm run lint
npm run build
git add lib/wmsTransactionListService.ts lib/__tests__/wmsTransactionListService.test.ts lib/__tests__/appContextPagedReads.test.ts lib/__tests__/materialRequestPagination.test.ts lib/materialRequestService.ts lib/requestRuntimeService.ts context/AppContext.tsx pages/Inventory.tsx pages/Operations.tsx pages/request/RequestList.tsx components/RequestModal.tsx lib/featureFlags.ts .env.example
git commit -m "perf(wms): page transactions and material requests"
```

---

### Task 4: Migrate project procurement, PO, and fulfillment reads

**Files:**
- Modify: `lib/projectService.ts`
- Modify: `lib/materialRequestFulfillmentService.ts`
- Modify: `lib/companyProcurementService.ts`
- Modify: `lib/purchasePackageService.ts`
- Modify: `lib/supplierDeliveryStatementService.ts`
- Modify: `pages/project/SupplyChainTab.tsx`
- Modify: `components/project/PurchaseOrderCockpitDrawer.tsx`
- Create: `lib/__tests__/procurementQueryPagination.test.ts`

**Interfaces:**
- Extends existing `ListPage<T>` contracts in `projectService` without changing item mapping.
- Adds explicit list/detail projections per PO, request-link, delivery-batch, fulfillment-line, supplier-note, and statement model.
- Uses `fetchAllPages` only for approval/print/reconciliation operations that require a complete bounded set.

- [ ] **Step 1: Add RED tests for list projection, cursor boundaries, chunked `.in(...)`, and complete print data**

```ts
it('loads every fulfillment line for a bounded request set', async () => {
  const rows = await loadFulfillmentLinesForRequests(requestIdsOfLength(125), { pageSize: 50, maxRows: 5000 });
  expect(rows).toHaveLength(1200);
  expect(fakeSupabase.maxInValues).toBeLessThanOrEqual(100);
  expect(fakeSupabase.pagesRequested).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run lib/__tests__/procurementQueryPagination.test.ts lib/__tests__/projectService.materialPo.phase3.test.ts lib/__tests__/purchaseOrderAmount.test.ts
```

- [ ] **Step 3: Convert UI lists to cursor pages and detail/print paths to explicit complete reads**

Keep PO calculations unchanged. The PO list loads summary columns and item identifiers; opening the cockpit or printing fetches the explicit detail graph for that PO. Request-link and fulfillment queries chunk ID arrays and page until complete.

- [ ] **Step 4: Prove business parity**

Test PO totals, request-to-PO allocation, single/multiple delivery pricing, fulfillment received quantities, supplier statements, print rows, and deep links using datasets above 1,000 child rows.

- [ ] **Step 5: Update inventory, verify, and commit**

```bash
node scripts/audit-supabase-queries.mjs --write docs/performance/supabase-query-inventory.json
npx vitest run lib/__tests__/procurementQueryPagination.test.ts lib/__tests__/projectService.materialPo.phase3.test.ts lib/__tests__/purchaseOrderAmount.test.ts lib/__tests__/materialRequestFulfillmentService.actualReceipt.test.ts
npm run lint
git add lib/projectService.ts lib/materialRequestFulfillmentService.ts lib/companyProcurementService.ts lib/purchasePackageService.ts lib/supplierDeliveryStatementService.ts pages/project/SupplyChainTab.tsx components/project/PurchaseOrderCockpitDrawer.tsx lib/__tests__/procurementQueryPagination.test.ts docs/performance/supabase-query-inventory.json
git commit -m "perf(procurement): bound PO and fulfillment reads"
```

---

### Task 5: Migrate workflow, chat, notifications, and AI history reads

**Files:**
- Modify: `context/WorkflowContext.tsx`
- Modify: `context/ChatContext.tsx`
- Modify: `lib/projectWorkflowService.ts`
- Modify: `lib/chatV2Service.ts`
- Modify: `lib/notificationService.ts`
- Modify: `pages/AiAssistant.tsx`
- Modify: `pages/settings/SettingsAiLearning.tsx`
- Create: `lib/__tests__/workflowChatQueryPagination.test.ts`

**Interfaces:**
- Workflow templates remain a capped catalog; nodes/edges load by template IDs.
- Workflow instances/logs, chat messages, notifications, AI runs, feedback, and memory history use cursor pages.
- Detail screens use explicit entity projections.

- [ ] **Step 1: Add RED tests for domain-scoped loading and realtime invalidation**

Assert that `WorkflowContext.refreshData` no longer loads every node and edge globally, chat history requests `limit + 1`, AI run history paginates, and updates at a cursor boundary neither duplicate nor skip rows.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run lib/__tests__/workflowChatQueryPagination.test.ts lib/__tests__/notificationService.test.ts
```

- [ ] **Step 3: Implement explicit projections and page contracts**

Use the existing `chatV2Service` and `notificationService` cursor patterns. Load workflow nodes/edges only for active templates. Keep unread-count queries as ID-only bounded reads or head counts.

- [ ] **Step 4: Verify and commit**

```bash
node scripts/audit-supabase-queries.mjs --write docs/performance/supabase-query-inventory.json
npx vitest run lib/__tests__/workflowChatQueryPagination.test.ts lib/__tests__/notificationService.test.ts lib/__tests__/chatV2Service.test.ts
npm run lint
git add context/WorkflowContext.tsx context/ChatContext.tsx lib/projectWorkflowService.ts lib/chatV2Service.ts lib/notificationService.ts pages/AiAssistant.tsx pages/settings/SettingsAiLearning.tsx lib/__tests__/workflowChatQueryPagination.test.ts docs/performance/supabase-query-inventory.json
git commit -m "perf(workflow): page workflow chat and AI histories"
```

---

### Task 6: Migrate vehicle, safety, HRM, and asset operational lists

**Files:**
- Modify: `lib/vehicleBookingService.ts`
- Modify: `lib/vehicleBookingAuditService.ts`
- Modify: `lib/vehicleBookingIssueService.ts`
- Modify: `lib/safetyService.ts`
- Modify: `lib/hrmSharedCatalogService.ts`
- Modify: `context/AppContext.tsx`
- Modify: `pages/booking/DispatcherWorkbenchPage.tsx`
- Modify: `pages/booking/VehicleBookingAuditTrailPage.tsx`
- Modify: `pages/booking/VehicleBookingIssuesPage.tsx`
- Modify: `pages/hrm/Attendance.tsx`
- Modify: `pages/hrm/LeaveManagement.tsx`
- Modify: `pages/ts/AssetAssignment.tsx`
- Modify: `pages/ts/AssetAudit.tsx`
- Modify: `pages/ts/AssetCatalog.tsx`
- Modify: `pages/ts/AssetDashboard.tsx`
- Modify: `pages/ts/AssetMaintenance.tsx`
- Modify: `pages/ts/AssetProfile.tsx`
- Modify: `pages/ts/AssetReports.tsx`
- Create: `lib/__tests__/operationsQueryPagination.test.ts`

**Interfaces:**
- Booking, audit, issue, attendance, leave, assignment, maintenance, and transfer lists return cursor pages.
- Availability checks remain bounded time-window queries with explicit projections.
- HR shared catalogs remain capped catalogs; operational HR rows do not remain globally hydrated.

- [ ] **Step 1: Add RED tests for date-window filters, actor scope, cursor order, and details**

Cover identical timestamps, booking status filters, site-scoped safety rosters, own-scoped HR records, and asset history above 1,000 rows. Permission and RLS expectations must remain identical.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run lib/__tests__/operationsQueryPagination.test.ts lib/__tests__/vehicleBookingAuditRedaction.test.ts lib/__tests__/safetyWorkforceReadApiMigration.test.ts
```

- [ ] **Step 3: Implement page/detail/catalog projections**

Reuse existing vehicle issue/audit and safety roster cursor contracts. Replace client-only slicing of server data with service paging. Keep dropdown/reference catalogs capped and fail visibly if a catalog reaches its cap.

- [ ] **Step 4: Verify and commit**

```bash
node scripts/audit-supabase-queries.mjs --write docs/performance/supabase-query-inventory.json
npx vitest run lib/__tests__/operationsQueryPagination.test.ts lib/__tests__/vehicleBookingAuditRedaction.test.ts lib/__tests__/safetyWorkforceReadApiMigration.test.ts
npm run lint
git add lib/vehicleBookingService.ts lib/vehicleBookingAuditService.ts lib/vehicleBookingIssueService.ts lib/safetyService.ts lib/hrmSharedCatalogService.ts context/AppContext.tsx pages/booking pages/hrm/Attendance.tsx pages/hrm/LeaveManagement.tsx pages/ts/AssetAssignment.tsx pages/ts/AssetAudit.tsx pages/ts/AssetCatalog.tsx pages/ts/AssetDashboard.tsx pages/ts/AssetMaintenance.tsx pages/ts/AssetProfile.tsx pages/ts/AssetReports.tsx lib/__tests__/operationsQueryPagination.test.ts docs/performance/supabase-query-inventory.json
git commit -m "perf(operations): page vehicle safety HRM and asset reads"
```

---

### Task 7: Migrate finance, contracts, cost, dashboards, and remaining manifest findings

**Files:**
- Modify: `lib/advancePaymentService.ts`
- Modify: `lib/contractItemService.ts`
- Modify: `lib/contractMetadataService.ts`
- Modify: `lib/costEstimateService.ts`
- Modify: `lib/costNorm/g8NormConsumptionService.ts`
- Modify: `lib/costNorm/costNormImportService.ts`
- Modify: `lib/dashboardService.ts`
- Modify: `lib/hdService.ts`
- Modify: `lib/inventoryLedgerService.ts`
- Modify: `lib/partnerService.ts`
- Modify: `lib/projectFinanceWorkspaceService.ts`
- Modify: `lib/projectMasterService.ts`
- Modify: `lib/projectTransactionService.ts`
- Modify: `lib/supplierPaymentBatchService.ts`
- Modify: every remaining source file named by `docs/performance/supabase-query-inventory.json`
- Create: `lib/__tests__/remainingSupabaseQueryPolicies.test.ts`

**Interfaces:**
- Consumes the Task 1 manifest as the exhaustive file list and refuses unclassified entries.
- Uses `page` for user lists, `all_pages` for exports/calculations/import reconciliation, `detail` for one record, and `catalog` only for documented small reference tables.
- Produces a manifest with zero unclassified findings.

- [ ] **Step 1: Add the RED completeness gate**

```ts
it('has no unclassified Supabase query findings', async () => {
  const report = await scanWorkspace(process.cwd(), policy);
  expect(report.findings.filter(row => !row.classification)).toEqual([]);
  expect(report.findings.filter(row => row.classification === 'page' && row.projection === '*')).toEqual([]);
});
```

- [ ] **Step 2: Run the completeness gate and verify RED**

```bash
npx vitest run lib/__tests__/remainingSupabaseQueryPolicies.test.ts
```

Expected: FAIL and print the remaining fingerprints grouped by file and table.

- [ ] **Step 3: Process findings in deterministic batches**

For each manifest file, update no more than one domain per commit. Replace wildcard list projections with named constants, add cursor pages to screens, use complete reads for exports/calculations, and document capped catalogs in policy JSON. After each batch, regenerate the manifest and run the domain's existing tests plus the completeness gate.

- [ ] **Step 4: Verify no unsafe remainder**

```bash
node scripts/audit-supabase-queries.mjs --write docs/performance/supabase-query-inventory.json
npm run check:supabase-queries
npx vitest run lib/__tests__/remainingSupabaseQueryPolicies.test.ts
```

Expected: zero unclassified findings, zero wildcard `page` reads, and no missing-result-policy errors.

- [ ] **Step 5: Commit the final application-query batch**

```bash
git add lib context pages components scripts/supabase-query-policy.json docs/performance/supabase-query-inventory.json lib/__tests__/remainingSupabaseQueryPolicies.test.ts
git commit -m "perf(data): classify and bound remaining Supabase reads"
```

---

### Task 8: Measure Cloud query plans and add only evidence-backed indexes

**Files:**
- Create: `supabase/audits/perf02_query_baseline.sql`
- Create: migration via `npx --yes supabase@2.110.0 migration new perf02_query_indexes`
- Modify: the migration file emitted by the preceding CLI command with suffix `_perf02_query_indexes.sql`
- Create: `lib/__tests__/perf02QueryIndexMigration.test.ts`
- Create: `docs/performance/perf02-cloud-results.md`

**Interfaces:**
- Consumes normalized high-call/high-time shapes from `pg_stat_statements` and index metadata from Supabase Cloud.
- Produces additive composite/partial indexes aligned with equality filters first, range/order columns second, and `id` as the cursor tie-breaker.

- [ ] **Step 1: Add a migration contract test before generating SQL**

The test must reject non-concurrent index creation on populated operational tables, missing `IF NOT EXISTS`, and indexes unrelated to a recorded query shape.

```ts
expect(sql).toMatch(/create index concurrently if not exists/i);
expect(sql).not.toMatch(/drop\s+(table|column|index)/i);
```

- [ ] **Step 2: Capture a read-only Cloud baseline**

The audit SQL reports table row estimates, existing indexes, unused/missing-index advisor output, and aggregate `pg_stat_statements` timing without row payloads. Run only against the configured linked Cloud project:

```bash
npx --yes supabase@2.110.0 db query --linked --file supabase/audits/perf02_query_baseline.sql
npx --yes supabase@2.110.0 db advisors --linked --type performance --level warn --fail-on none
```

Do not reset statistics. Store sanitized aggregate results in `docs/performance/perf02-cloud-results.md`.

- [ ] **Step 3: Generate the migration through the CLI**

```bash
npx --yes supabase@2.110.0 migration new perf02_query_indexes
```

Add only indexes supported by the captured query shapes. Example shape for a descending cursor list:

```sql
create index concurrently if not exists transactions_warehouse_date_id_idx
  on public.transactions (warehouse_id, date desc, id desc);
```

Do not copy the example unless the Cloud plan confirms this exact filter/order shape and the equivalent index is absent.

- [ ] **Step 4: Review and dry-run the Cloud migration**

```bash
npx --yes supabase@2.110.0 db push --linked --dry-run
npx vitest run lib/__tests__/perf02QueryIndexMigration.test.ts
```

Expected: only additive index statements; no table rewrite, destructive DDL, RLS change, or unrelated migration.

- [ ] **Step 5: Stop for explicit Cloud-write authorization**

Present the dry-run, expected index sizes, lock behavior, and rollback SQL. Do not apply the migration until the user authorizes the linked Cloud write.

- [ ] **Step 6: After authorization, apply during a low-traffic window and verify**

```bash
npx --yes supabase@2.110.0 db push --linked
npx --yes supabase@2.110.0 migration list --linked
npx --yes supabase@2.110.0 db advisors --linked --type security --level error --fail-on none
npx --yes supabase@2.110.0 db advisors --linked --type performance --level error --fail-on none
```

Record migration version, before/after plans, aggregate timing, and advisor results. Rollback drops only the new named indexes concurrently.

- [ ] **Step 7: Commit Cloud evidence and migration**

```bash
git add supabase/audits/perf02_query_baseline.sql supabase/migrations/*_perf02_query_indexes.sql lib/__tests__/perf02QueryIndexMigration.test.ts docs/performance/perf02-cloud-results.md
git commit -m "perf(db): index paged Supabase query paths"
```

---

### Task 9: Complete rollout, remove temporary flags, and enforce the final zero-regression policy

**Files:**
- Modify: `lib/featureFlags.ts`
- Modify: `.env.example`
- Modify: `scripts/supabase-query-policy.json`
- Modify: `docs/performance/supabase-query-inventory.json`
- Create: `docs/runbooks/perf02-paged-reads-rollout.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Removes temporary `VITE_ENABLE_PERF02_*` flags after each enabled path has passed its Cloud observation window.
- Changes the query audit from legacy-ratchet mode to final policy mode.

- [ ] **Step 1: Execute the domain rollout checklist**

For WMS/Request, Procurement, Workflow/Chat/AI, Operations, and Remaining Domains, record:

- first-page IDs and ordering match the legacy path;
- next-page navigation has no duplicates or gaps;
- filters/search are server-side and preserved across pages;
- deep links load details not present on page one;
- exports/calculations exceed 1,000 test rows without truncation;
- realtime events update or invalidate the visible page correctly;
- browser payload and render time do not regress;
- frontend/API error rate does not regress during the observation window.

- [ ] **Step 2: Remove legacy branches and temporary flags**

Delete the old global/unbounded code only after its domain checklist passes. Remove its flag from `featureFlags.ts` and `.env.example` in the same commit so dead paths cannot return.

- [ ] **Step 3: Tighten CI to final policy**

Final check mode must fail on:

- any unclassified Supabase read;
- any wildcard `page` query;
- any `page` query without stable ordering, `limit + 1`, and cursor predicate;
- any `all_pages` query without deterministic paging and a safety cap;
- any expired allowlist entry;
- any reintroduction of a default wildcard `fetchTableHelper` query.

- [ ] **Step 4: Run the full verification gate**

```bash
npm run check:supabase-queries
npm run lint
npm test
npm run build
npx --yes supabase@2.110.0 db advisors --linked --type security --level error --fail-on none
npx --yes supabase@2.110.0 db advisors --linked --type performance --level error --fail-on none
```

Expected: all local commands pass; no new error-level Cloud advisor finding.

- [ ] **Step 5: Commit the final enforcement and runbook**

```bash
git add lib/featureFlags.ts .env.example scripts/supabase-query-policy.json docs/performance/supabase-query-inventory.json docs/runbooks/perf02-paged-reads-rollout.md .github/workflows/ci.yml
git commit -m "chore(perf): enforce bounded Supabase reads"
```

## Release checkpoints

Do not combine these checkpoints into one production release:

1. Audit guard and shared primitives.
2. WMS and Request cutover.
3. Procurement and fulfillment cutover.
4. Workflow, chat, notifications, and AI cutover.
5. Vehicle, safety, HRM, and assets cutover.
6. Finance, contracts, cost, dashboards, and residual cleanup.
7. Evidence-backed Cloud indexes.
8. Flag removal and final CI enforcement.

At each checkpoint, a failed parity test, incomplete result, elevated error rate, or permission/RLS difference blocks the next checkpoint and triggers rollback of that domain only.
