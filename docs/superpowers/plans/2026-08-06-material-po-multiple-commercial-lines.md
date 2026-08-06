# Material PO Multiple Commercial Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow proactive Material POs to contain independent same-SKU commercial lines at different prices while preserving line-safe delivery, receipt, return, BOQ, Excel, reporting, and planning behavior.

**Architecture:** Keep `purchase_orders.items` as JSONB and make `lineId` the explicit commercial-line identity. Add small pure domain helpers for validation, sequential BOQ snapshots, PO Excel identity, and transaction-item aggregation; wire the existing large UI component to those helpers without restructuring unrelated code. Preserve request-PO duplicate rules and existing database/RLS behavior.

**Tech Stack:** React 19, TypeScript, Vitest, Supabase/PostgreSQL JSONB, existing Material PO and WMS services.

## Global Constraints

- Apply multiple commercial lines only to `proactive_project` and `proactive_stock`.
- Preserve the current `from_request` duplicate rule exactly.
- Allow same supplier/item/BOQ source only when normalized `unitPrice` differs.
- Reject equal-price duplicates and instruct the user to merge quantity.
- Repeated `itemId` rows must have non-empty unique `lineId` values.
- Do not add a database migration or relational `purchase_order_lines` table.
- Do not change supplier splitting, procurement-group numbering, site direct purchase, or company-consolidated workflows.
- Use TDD for every task and commit each independently testable unit.

---

### Task 1: Commercial-line validation domain

**Files:**

- Create: `lib/purchaseOrderCommercialLines.ts`
- Test: `lib/__tests__/purchaseOrderCommercialLines.test.ts`

**Interfaces:**

- Consumes: `PurchaseOrderItem`, `PurchaseOrderSourceMode` from `types.ts`.
- Produces:

```ts
export type PurchaseOrderCommercialLineIssue = {
  code: 'duplicate_request_source' | 'duplicate_commercial_price' | 'missing_line_id' | 'duplicate_line_id';
  sku: string;
  unitPrice?: number;
  lineId?: string;
};

export const findPurchaseOrderCommercialLineIssue = (input: {
  items: PurchaseOrderItem[];
  sourceMode: PurchaseOrderSourceMode;
}): PurchaseOrderCommercialLineIssue | null;
```

- [ ] **Step 1: Write failing validation tests**

Cover these exact cases:

```ts
it('allows proactive same SKU rows at different prices', () => {
  expect(findPurchaseOrderCommercialLineIssue({
    sourceMode: 'proactive_project',
    items: [line('line-a', 10_000), line('line-b', 11_000)],
  })).toBeNull();
});

it('rejects proactive same SKU rows at the same normalized price', () => {
  expect(findPurchaseOrderCommercialLineIssue({
    sourceMode: 'proactive_project',
    items: [line('line-a', 10_000), line('line-b', 10_000)],
  })).toMatchObject({ code: 'duplicate_commercial_price', sku: 'SKU-1', unitPrice: 10_000 });
});

it('keeps request-source duplicates blocked even when prices differ', () => {
  expect(findPurchaseOrderCommercialLineIssue({
    sourceMode: 'from_request',
    items: [line('line-a', 10_000), line('line-b', 11_000)],
  })).toMatchObject({ code: 'duplicate_request_source' });
});
```

Also test `proactive_stock`, missing line IDs on a repeated item, duplicate line IDs, distinct BOQ sources, and distinct suppliers.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run lib/__tests__/purchaseOrderCommercialLines.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal pure validator**

Use the current request key unchanged:

```ts
const requestKey = (line: PurchaseOrderItem) => [
  line.vendorId || '',
  line.itemId,
  line.materialBudgetItemId || '',
  line.requestLineId || '',
].join('|');
```

For proactive modes, append `Number(line.unitPrice)` to the supplier/item/budget key. Validate equal-price duplicates before line identity so users receive the actionable “merge quantity” issue. Then require distinct non-empty line IDs for every repeated `itemId` group and reject any duplicated non-empty line ID globally.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run lib/__tests__/purchaseOrderCommercialLines.test.ts`
Expected: all commercial-line validation cases pass.

- [ ] **Step 5: Commit the domain unit**

```bash
git add lib/purchaseOrderCommercialLines.ts lib/__tests__/purchaseOrderCommercialLines.test.ts
git commit -m "feat: validate multiple commercial PO lines"
```

### Task 2: Wire proactive PO save behavior

**Files:**

- Modify: `pages/project/SupplyChainTab.tsx:3454-3532`
- Test: `lib/__tests__/purchaseOrderCommercialLines.test.ts`
- Test: `lib/__tests__/materialPoCommercialLinesUiContract.test.ts`

**Interfaces:**

- Consumes: `findPurchaseOrderCommercialLineIssue` from Task 1.
- Produces: source-mode-specific save validation and stable user-facing Vietnamese errors.

- [ ] **Step 1: Add a failing UI contract test**

Read `SupplyChainTab.tsx` and assert it imports and calls the validator after item/supplier normalization. Assert the old inline `duplicatedSku` search no longer exists.

```ts
expect(source).toContain('findPurchaseOrderCommercialLineIssue({');
expect(source).toContain('sourceMode: pSourceMode');
expect(source).not.toContain('const duplicatedSku = validItems.find');
```

- [ ] **Step 2: Run validation and UI contract tests to verify RED**

Run: `npx vitest run lib/__tests__/purchaseOrderCommercialLines.test.ts lib/__tests__/materialPoCommercialLinesUiContract.test.ts`
Expected: UI contract fails because `SupplyChainTab` still contains the inline duplicate block.

- [ ] **Step 3: Replace the inline block with issue mapping**

After `validItems` and supplier validation:

```ts
const commercialLineIssue = findPurchaseOrderCommercialLineIssue({
  items: validItems,
  sourceMode: pSourceMode,
});
if (commercialLineIssue?.code === 'duplicate_commercial_price') {
  toast.warning(
    'Dòng thương mại bị trùng',
    `SKU ${commercialLineIssue.sku} đã có dòng giá ${fmtMoney(commercialLineIssue.unitPrice || 0)} đ. Vui lòng gộp số lượng.`,
  );
  return;
}
```

Map `duplicate_request_source` to the existing message and map identity issues to “Dòng PO thiếu hoặc trùng mã dòng; vui lòng tải lại form.” Do not change supplier grouping or save order.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run lib/__tests__/purchaseOrderCommercialLines.test.ts lib/__tests__/materialPoCommercialLinesUiContract.test.ts`.

- [ ] **Step 5: Commit the UI wiring**

```bash
git add pages/project/SupplyChainTab.tsx lib/__tests__/materialPoCommercialLinesUiContract.test.ts
git commit -m "feat: allow proactive PO price lines"
```

### Task 3: Sequential BOQ over-budget allocation

**Files:**

- Create: `lib/purchaseOrderBudgetSnapshots.ts`
- Test: `lib/__tests__/purchaseOrderBudgetSnapshots.test.ts`
- Modify: `pages/project/SupplyChainTab.tsx:2820-2895,3480-3490,5685-5695,8495-8515`

**Interfaces:**

- Produces:

```ts
export type PurchaseOrderBudgetLineInput = {
  lineId: string;
  materialBudgetItemId: string | null;
  stockQty: number;
};

export type PurchaseOrderBudgetBaseline = {
  budgetQty: number;
  previousRequestedQty: number;
  previousOrderedQty: number;
};

export const calculateSequentialPoBudgetSnapshots = (
  lines: PurchaseOrderBudgetLineInput[],
  baselines: Map<string, PurchaseOrderBudgetBaseline>,
): Map<string, {
  reservedBeforeQtySnapshot: number;
  overBudgetQtySnapshot: number;
  overBudgetPercentSnapshot: number;
}>;
```

- [ ] **Step 1: Write failing overage allocation tests**

Test budget `100`, baseline `0`, and two rows of `60` each. Expected row A overage `0`, row B overage `20`, total overage `20`. Also test a baseline of `90` with rows `5` and `10`, and independent budget IDs.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run lib/__tests__/purchaseOrderBudgetSnapshots.test.ts`.

- [ ] **Step 3: Implement sequential allocation**

For each budget in form order:

```ts
const reservedBefore = baseline.previousRequestedQty + baseline.previousOrderedQty + runningQty;
const overBefore = Math.max(0, reservedBefore - baseline.budgetQty);
const overAfter = Math.max(0, reservedBefore + line.stockQty - baseline.budgetQty);
const overBudgetQtySnapshot = Math.max(0, overAfter - overBefore);
runningQty += line.stockQty;
```

- [ ] **Step 4: Wire `buildPoBudgetSnapshot` to the precomputed map**

Build the map from normalized `pItems` in form order and use `lineId` to read the current row's reserved-before and overage snapshots. Preserve `previousRequestedQtySnapshot`, `previousOrderedQtySnapshot`, and unit conversion behavior.

- [ ] **Step 5: Run BOQ and adjacent PO tests**

Run: `npx vitest run lib/__tests__/purchaseOrderBudgetSnapshots.test.ts lib/__tests__/purchaseOrderDemand.test.ts lib/__tests__/purchaseOrderAmount.test.ts`.

- [ ] **Step 6: Commit the BOQ correction**

```bash
git add lib/purchaseOrderBudgetSnapshots.ts lib/__tests__/purchaseOrderBudgetSnapshots.test.ts pages/project/SupplyChainTab.tsx
git commit -m "fix: allocate PO budget overage by line order"
```

### Task 4: PO Excel commercial-line identity

**Files:**

- Create: `lib/purchaseOrderExcelImport.ts`
- Test: `lib/__tests__/purchaseOrderExcelImport.test.ts`
- Modify: `pages/project/SupplyChainTab.tsx:4240-4400`

**Interfaces:**

- Produces:

```ts
export const getPoExcelCreateCommercialKey = (sku: unknown, unitPrice: unknown): string;

export const preparePoExcelUpdateRows = (input: {
  rows: Record<string, unknown>[];
  existingItems: PurchaseOrderItem[];
}): Array<Record<string, unknown> & {
  __poImportKey: string;
  __poImportError?: string;
}>;
```

- [ ] **Step 1: Write failing Excel identity tests**

Test that create keys differ for `SKU-1 @ 10,000` and `SKU-1 @ 11,000`, but normalize `10.000` and `10000` to the same key. Test update resolution by `Mã dòng PO`, SKU fallback for a unique SKU, and an ambiguity error for repeated SKU without line ID.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run lib/__tests__/purchaseOrderExcelImport.test.ts`.

- [ ] **Step 3: Implement the PO-specific Excel key helpers**

Keep shared `lib/excelImport.ts` defaults unchanged. Preprocess PO rows with an internal `__poImportKey`:

- create mode: normalized `sku|unitPrice`;
- update mode: explicit `Mã dòng PO`, otherwise the sole matching existing line ID;
- ambiguous update: empty key plus `__poImportError`.

- [ ] **Step 4: Wire create and update previews**

For create mode, configure `buildImportPreview` with `keyAliases: ['__poImportKey']` and get the visible SKU from the original row in `createBaseRecord`. For update mode, key existing records by `lineId || itemId`, pass `__poImportError` through `validateKey`, and apply updates through a `Map<lineId, record>` instead of `records.find(record.sku)`.

- [ ] **Step 5: Update the Excel template**

Add `Mã dòng PO` to `Cap_nhat` and document:

```text
Khi một SKU có nhiều dòng giá, Mã dòng PO là bắt buộc để cập nhật đúng dòng.
```

Keep the create sheet's user-facing columns unchanged; repeated SKU rows are differentiated by `Đơn giá`.

- [ ] **Step 6: Run Excel and UI contract tests**

Run: `npx vitest run lib/__tests__/purchaseOrderExcelImport.test.ts lib/__tests__/materialPoCommercialLinesUiContract.test.ts`.

- [ ] **Step 7: Commit Excel support**

```bash
git add lib/purchaseOrderExcelImport.ts lib/__tests__/purchaseOrderExcelImport.test.ts pages/project/SupplyChainTab.tsx
git commit -m "feat: import PO commercial price lines"
```

### Task 5: Aggregate repeated transaction items in fallback views

**Files:**

- Create: `lib/transactionItemAggregation.ts`
- Test: `lib/__tests__/transactionItemAggregation.test.ts`
- Modify: `pages/Reports.tsx:335-370`
- Modify: `components/InventoryDetailModal.tsx:610-670`

**Interfaces:**

- Produces:

```ts
export const aggregateTransactionItemsForInventory = (
  items: TransactionItem[],
  itemId: string,
): {
  quantity: number;
  accountingQty: number;
  accountingUnit: string | null;
  accountingPrice: number | null;
} | null;
```

- [ ] **Step 1: Write failing aggregation tests**

Use two rows for one item: `3 @ 10,000` and `7 @ 12,000`. Expect quantity `10`. When accounting quantities/prices exist in one common unit, expect summed accounting quantity and weighted accounting price; when units differ, expect accounting price `null`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run lib/__tests__/transactionItemAggregation.test.ts`.

- [ ] **Step 3: Implement the pure aggregator**

Filter all matching `itemId` rows, sum stock quantity, sum accounting quantity, and compute weighted price as total accounting amount divided by accounting quantity only when all non-empty accounting units match.

- [ ] **Step 4: Replace first-row lookups**

In the fallback stock report, replace `tx.items.find(...)` with the aggregate quantity. In Inventory Detail history, render aggregate stock quantity/accounting quantity and weighted accounting price; leave `TransactionDetailModal` unchanged because it intentionally shows each commercial line.

- [ ] **Step 5: Run focused tests and build type-check through Vite**

Run: `npx vitest run lib/__tests__/transactionItemAggregation.test.ts`.

- [ ] **Step 6: Commit fallback reporting corrections**

```bash
git add lib/transactionItemAggregation.ts lib/__tests__/transactionItemAggregation.test.ts pages/Reports.tsx components/InventoryDetailModal.tsx
git commit -m "fix: aggregate repeated inventory transaction lines"
```

### Task 6: Deterministic material-planning price

**Files:**

- Modify: `lib/projectMaterialPlanningService.ts:160-205`
- Test: `lib/__tests__/projectMaterialPlanningService.aggregate.test.ts`

**Interfaces:**

- Existing output remains `planningUnitPrice` plus source `latest_confirmed_po`, `latest_received`, `material_master`, or `fallback`.
- The newest confirmed PO contributes one stock-unit weighted price per inventory item.

- [ ] **Step 1: Add a failing planning-price test**

Create one confirmed PO with the same `itemId` on line A (`qty 3`, stock-unit price `10,000`) and line B (`qty 7`, stock-unit price `12,000`). Expect planning price `11,400`, not whichever row appears first. Add an older PO with a different price and verify it is ignored.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run lib/__tests__/projectMaterialPlanningService.aggregate.test.ts`
Expected: current first-line selection returns `10,000` or `12,000` instead of `11,400`.

- [ ] **Step 3: Aggregate within the newest matching PO**

Sort valid POs deterministically by `orderDate || expectedDeliveryDate || createdAt`, then `createdAt`, then `id`. Select the newest PO containing positive-price matching lines. Convert each line quantity and price to stock units, then compute:

```ts
const weightedPrice = matchingLines.reduce(
  (sum, line) => sum + stockQty(line) * stockUnitPrice(line),
  0,
) / matchingLines.reduce((sum, line) => sum + stockQty(line), 0);
```

Preserve the existing received-transaction and material-master fallbacks.

- [ ] **Step 4: Run planning tests and verify GREEN**

Run: `npx vitest run lib/__tests__/projectMaterialPlanningService.aggregate.test.ts`.

- [ ] **Step 5: Commit deterministic planning pricing**

```bash
git add lib/projectMaterialPlanningService.ts lib/__tests__/projectMaterialPlanningService.aggregate.test.ts
git commit -m "fix: weight latest PO planning prices"
```

### Task 7: Line-linked workflow regression coverage

**Files:**

- Modify: `lib/__tests__/purchaseOrderAmount.test.ts`
- Modify: `lib/__tests__/purchaseOrderDeliveryDraft.test.ts`
- Modify: `lib/__tests__/materialRequestFulfillmentService.proactiveReceipt.test.ts`
- Modify: `lib/__tests__/purchaseOrderSupplierReturnService.test.ts`

**Interfaces:**

- Verifies existing delivery, WMS, amount/print, and return interfaces remain keyed by `lineId` when `itemId` repeats.

- [ ] **Step 1: Add same-SKU line fixtures**

Use two PO items with one `itemId`, line IDs `commercial-10k` and `commercial-12k`, quantities `3` and `7`, and prices `10,000` and `12,000`.

- [ ] **Step 2: Assert totals and print lines**

Expect two print lines and total `114,000`:

```ts
expect(lines.map(line => line.lineKey)).toEqual(['commercial-10k', 'commercial-12k']);
expect(lines.reduce((sum, line) => sum + line.totalAmount, 0)).toBe(114_000);
```

- [ ] **Step 3: Assert delivery draft identity**

Call `makePoDeliveryLineDraft` for both commercial-line fixtures and expect `purchaseOrderLineId` values `commercial-10k` and `commercial-12k`, even though both rows use the same `itemId`. The UI contract from Task 2 separately confirms `SupplyChainTab` maps every normalized PO row through the line-based delivery builder.

- [ ] **Step 4: Assert proactive WMS receipt prices**

Expect the generated transaction payload to contain two item rows with distinct `purchaseOrderLineId` and their corresponding accounting/stock prices.

- [ ] **Step 5: Assert supplier-return line identity**

Submit returns for both line IDs and verify the RPC payload preserves both IDs instead of collapsing by item ID.

- [ ] **Step 6: Run the workflow regression group**

Run:

```bash
npx vitest run \
  lib/__tests__/purchaseOrderAmount.test.ts \
  lib/__tests__/purchaseOrderDeliveryDraft.test.ts \
  lib/__tests__/materialRequestFulfillmentService.proactiveReceipt.test.ts \
  lib/__tests__/purchaseOrderSupplierReturnService.test.ts
```

- [ ] **Step 7: Commit workflow regression coverage**

```bash
git add lib/__tests__/purchaseOrderAmount.test.ts lib/__tests__/purchaseOrderDeliveryDraft.test.ts lib/__tests__/materialRequestFulfillmentService.proactiveReceipt.test.ts lib/__tests__/purchaseOrderSupplierReturnService.test.ts
git commit -m "test: cover repeated SKU PO workflows"
```

### Task 8: Final verification and handoff

**Files:**

- Verify all files changed in Tasks 1–7.
- Update design/implementation evidence only if implementation reveals a material deviation.

- [ ] **Step 1: Review the final diff against the spec**

Confirm no changes to Supabase migrations, RLS, request-PO duplicate semantics, supplier splitting, company procurement, or direct purchase.

- [ ] **Step 2: Run formatting/whitespace validation**

Run: `git diff --check`.

- [ ] **Step 3: Run the complete branch test suite**

Run: `npx vitest run --exclude '.worktrees/**'`
Expected: all test files and tests pass.

- [ ] **Step 4: Build production assets**

Run: `npm run build`
Expected: Vite production build succeeds; existing chunk-size warnings are non-blocking.

- [ ] **Step 5: Inspect final repository state**

Run: `git status --short` and `git log --oneline -12`. Confirm only intentional commits/files are present and no build artifacts are tracked.

- [ ] **Step 6: Perform manual acceptance checks**

In the PO form:

1. In an authorized test environment, create a disposable `proactive_project` draft PO with one SKU at two different prices and confirm save reaches Supabase; delete the draft before it has stock impact after checks finish.
2. Try the same SKU at the same normalized price and confirm the merge-quantity warning.
3. Verify PO print has two rows and the correct total.
4. Create delivery lines for both commercial line IDs and confirm receipt/return screens keep them separate.
5. Verify a `from_request` duplicate still shows the existing duplicate-source warning.

- [ ] **Step 7: Hand off without deploying unless explicitly requested**

Report commit IDs, test counts, build result, known non-blocking warnings, and branch integration choices. This feature changes application code only; Cloud database apply is not required.
