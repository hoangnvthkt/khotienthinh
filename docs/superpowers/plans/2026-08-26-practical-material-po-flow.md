# Practical Material PO Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Workspace `AGENTS.md` prohibits sub-agents.

**Goal:** Replace rejected PO V3/V4 behavior with one practical MR → order/batch → WMS → quality approval → stock receipt flow that accepts explained shortages and overages.

**Architecture:** Return application code to the existing V2 PO/WMS foundation, then add neutral commands for single-order approval, multi-batch approval, quality capture, and stock finalization. Keep applied migrations as immutable history, convert the three affected Cloud POs forward, and retire obsolete RPCs after the new path is verified.

**Tech Stack:** React 19, TypeScript, Vitest, Supabase Cloud Postgres, Supabase JS, existing WMS `transactions`.

**Spec:** `docs/superpowers/specs/2026-08-26-practical-material-po-flow-design.md`

## Global Constraints

- Use Supabase Cloud from `.env`; never use Supabase local or Docker.
- Do not modify/remove an applied migration; add forward corrective migrations.
- Do not create another flow version, receipt table, or master-estimate layer.
- Preserve unrelated contract work in `pages/hd/ContractOverview.tsx`, `pages/hd/SupplierContracts.tsx`, `pages/project/ContractTab.tsx`, `lib/projectContractAggregation.ts`, and its test.
- Never cap ordered, delivered, or accepted quantities by MR quantity; require a reason at the variance boundary.
- Inventory changes only on WMS `APPROVED -> COMPLETED`, using `accepted_stock_qty` exactly once.
- PO-211, PO-259, and PO-414 must remain traceable and operational.
- Every mutating Cloud smoke test runs inside `BEGIN ... ROLLBACK` before release.

---

### Task 1: Isolate rejected PO work without losing unrelated changes

**Files:**
- Preserve: `.env`
- Preserve: `pages/hd/ContractOverview.tsx`
- Preserve: `pages/hd/SupplierContracts.tsx`
- Preserve: `pages/project/ContractTab.tsx`
- Preserve: `lib/projectContractAggregation.ts`
- Preserve: `lib/__tests__/projectContractAggregation.test.ts`
- Restore PO source baseline from `origin/main`: `components/ReceivePurchaseOrderModal.tsx`
- Restore PO source baseline from `origin/main`: `components/project/PurchaseDeliveryBatchEditor.tsx`
- Restore PO source baseline from `origin/main`: `components/project/PurchaseOrderCockpitDrawer.tsx`
- Restore PO source baseline from `origin/main`: `pages/Inventory.tsx`
- Restore PO source baseline from `origin/main`: `pages/Operations.tsx`
- Restore PO source baseline from `origin/main`: `pages/project/SupplyChainTab.tsx`
- Restore PO source baseline from `origin/main`: `lib/purchasePackageService.ts`
- Restore PO source baseline from `origin/main`: `lib/purchaseReceiptService.ts`
- Restore PO source baseline from `origin/main`: `lib/purchaseReceiptWorkflow.ts`
- Restore PO source baseline from `origin/main`: `lib/purchaseOrderUiPolicy.ts`
- Restore PO source baseline from `origin/main`: `types.ts`
- Keep as Cloud history: all six migrations dated `20260825014704` through `20260826063752`.

**Interfaces:**
- Consumes: dirty worktree, `origin/main`, Cloud migration history.
- Produces: recoverable branch with V2 PO source plus exact applied migration history.

- [ ] **Step 1: Record starting state**

```bash
git status --short
git log --oneline origin/main..HEAD
git diff --stat
```

Expected: eight local PO commits and known uncommitted PO/contract files.

- [ ] **Step 2: Save everything recoverably and start from the accepted baseline**

```bash
git branch backup/po-v3-v4-before-practical-cutover-20260826
git stash push --include-untracked -m "safety: worktree before practical PO cutover 2026-08-26"
git switch -c fix/practical-material-po origin/main
```

- [ ] **Step 3: Restore only unrelated contract work and applied V4 migration history**

```bash
git restore --source=stash@{0} -- pages/hd/ContractOverview.tsx pages/hd/SupplierContracts.tsx pages/project/ContractTab.tsx
git restore --source=stash@{0}^3 -- lib/projectContractAggregation.ts lib/__tests__/projectContractAggregation.test.ts
git restore --source=stash@{0}^3 -- supabase/migrations/20260826031645_mr_po_simplified_flow_v4.sql supabase/migrations/20260826063752_mr_po_v4_wms_quality_entrypoints.sql
git restore --source=backup/po-v3-v4-before-practical-cutover-20260826 -- supabase/migrations/20260825014704_po_multiple_delivery_batch_approval.sql supabase/migrations/20260825074544_mr_po_delivery_receipt_foundation_v3.sql supabase/migrations/20260825074545_mr_po_delivery_commands_v3.sql supabase/migrations/20260825095251_backfill_flow_v3_single_mr_snapshots.sql
```

- [ ] **Step 4: Verify isolation**

```bash
git status --short
npm run lint
```

Expected: PO source is V2 baseline; contract work and six historical migrations are preserved.

- [ ] **Step 5: Commit the recoverable baseline**

```bash
git add docs/superpowers/specs/2026-08-26-practical-material-po-flow-design.md docs/superpowers/plans/2026-08-26-practical-material-po-flow.md supabase/migrations/20260825014704_po_multiple_delivery_batch_approval.sql supabase/migrations/20260825074544_mr_po_delivery_receipt_foundation_v3.sql supabase/migrations/20260825074545_mr_po_delivery_commands_v3.sql supabase/migrations/20260825095251_backfill_flow_v3_single_mr_snapshots.sql supabase/migrations/20260826031645_mr_po_simplified_flow_v4.sql supabase/migrations/20260826063752_mr_po_v4_wms_quality_entrypoints.sql
git commit -m "chore(procurement): preserve applied PO migration history"
```

---

### Task 2: Define practical quantity rules in pure TypeScript

**Files:**
- Create: `lib/materialPoPracticalFlow.ts`
- Create: `lib/__tests__/materialPoPracticalFlow.test.ts`
- Modify: `types.ts`

**Interfaces:**
- Produces: `getMaterialPoVariance`, `requiresMaterialPoVarianceReason`, `assertMaterialPoPhysicalQuantities`, `deriveMaterialPoCompletion`.

- [ ] **Step 1: Write failing tests**

```ts
expect(getMaterialPoVariance({ orderedQty: 100, deliveredQty: 95, acceptedQty: 90, deliveredStockQty: 95, acceptedStockQty: 89 })).toEqual({
  deliveryVarianceQty: -5,
  rejectedPurchaseQty: 5,
  rejectedStockQty: 6,
});
expect(requiresMaterialPoVarianceReason({ orderedQty: 100, deliveredQty: 103, acceptedQty: 102, deliveredStockQty: 103, acceptedStockQty: 101 })).toBe(true);
expect(() => assertMaterialPoPhysicalQuantities({ deliveredQty: 10, acceptedQty: 11, deliveredStockQty: 10, acceptedStockQty: 10 })).toThrow('Số đạt không được lớn hơn số thực giao.');
expect(deriveMaterialPoCompletion({ purchaseMode: 'single', requestedQty: 100, receivedQty: 90, hasCompletedReceipt: true })).toBe('delivered');
expect(deriveMaterialPoCompletion({ purchaseMode: 'multiple', requestedQty: 100, receivedQty: 90, hasCompletedReceipt: true })).toBe('partial');
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run lib/__tests__/materialPoPracticalFlow.test.ts
```

- [ ] **Step 3: Implement minimal domain functions**

```ts
export interface MaterialPoVarianceInput {
  orderedQty: number;
  deliveredQty: number;
  acceptedQty: number;
  deliveredStockQty: number;
  acceptedStockQty: number;
}

export const getMaterialPoVariance = (input: MaterialPoVarianceInput) => ({
  deliveryVarianceQty: input.deliveredQty - input.orderedQty,
  rejectedPurchaseQty: input.deliveredQty - input.acceptedQty,
  rejectedStockQty: input.deliveredStockQty - input.acceptedStockQty,
});

export const requiresMaterialPoVarianceReason = (input: MaterialPoVarianceInput) =>
  Object.values(getMaterialPoVariance(input)).some(value => value !== 0);

export const assertMaterialPoPhysicalQuantities = (input: Omit<MaterialPoVarianceInput, 'orderedQty'>) => {
  if ([input.deliveredQty, input.acceptedQty, input.deliveredStockQty, input.acceptedStockQty].some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('Số lượng thực tế phải là số không âm.');
  }
  if (input.acceptedQty > input.deliveredQty) throw new Error('Số đạt không được lớn hơn số thực giao.');
  if (input.acceptedStockQty > input.deliveredStockQty) throw new Error('Số nhập kho không được lớn hơn số thực giao theo đơn vị kho.');
};
```

Add optional `deliveredQty` and `deliveredStockQty` to `PurchaseOrderDeliveryLine`; default missing legacy values to accepted values.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run lib/__tests__/materialPoPracticalFlow.test.ts
npm run lint
git add lib/materialPoPracticalFlow.ts lib/__tests__/materialPoPracticalFlow.test.ts types.ts
git commit -m "feat(procurement): define practical PO quantity rules"
```

---

### Task 3: Add neutral Cloud commands and migrate affected data safely

**Files:**
- Create via CLI: the single file matching `supabase/migrations/*_material_po_practical_flow.sql`
- Create: `supabase/tests/material_po_practical_flow_smoke.sql`

**Interfaces:**
- Produces RPCs: `submit_material_po_batch`, `decide_material_po_batch`, `approve_material_po_batch`, `approve_material_po_quality`, `finalize_material_po_receipt`, `approve_single_material_po`.

- [ ] **Step 1: Create the migration with the CLI**

```bash
npx --yes supabase@2.110.0 migration new material_po_practical_flow
```

Use the generated filename in later commands.

- [ ] **Step 2: Write a failing rollback-only smoke test**

The test must start with `begin;` and end with `rollback;`. It creates fixtures, then checks:

```sql
select public.submit_material_po_batch(v_batch_id, v_approver_id, v_actor_id);
select public.approve_material_po_batch(v_batch_id, v_approver_id);

-- Replay returns the same WMS.
if v_first_wms_id is null or v_first_wms_id <> v_replayed_wms_id then
  raise exception 'Batch approval is not idempotent';
end if;

-- 100 ordered, 103 delivered, 101 accepted is allowed with a reason.
perform public.approve_material_po_quality(
  v_batch_id, v_first_wms_id, v_keeper_id, 'partial',
  jsonb_build_array(jsonb_build_object(
    'deliveryLineId', v_delivery_line_id,
    'itemId', v_item_id,
    'deliveredPurchaseQty', 103,
    'acceptedPurchaseQty', 101,
    'deliveredStockQty', 103,
    'acceptedStockQty', 101,
    'varianceReason', 'Cân thực tế và loại 2 đơn vị không đạt'
  )), '[]'::jsonb
);
```

Assert stock is unchanged after quality approval and increases by exactly 101 after finalization; replay finalization must not change it again.

- [ ] **Step 3: Verify the test fails before the migration**

```bash
set -a
source .env
set +a
npx --yes supabase@2.110.0 db query --linked --password "$SUPABASE_DB_PASSWORD" --file supabase/tests/material_po_practical_flow_smoke.sql
```

Expected: missing neutral RPC.

- [ ] **Step 4: Add only the missing physical quantity columns**

```sql
alter table public.purchase_order_delivery_lines
  add column if not exists delivered_qty numeric not null default 0,
  add column if not exists delivered_stock_qty numeric not null default 0;

update public.purchase_order_delivery_lines
set delivered_qty = greatest(delivered_qty, accepted_qty),
    delivered_stock_qty = greatest(delivered_stock_qty, accepted_stock_qty);

alter table public.purchase_order_delivery_lines
  add constraint purchase_order_delivery_lines_practical_qty_check check (
    delivered_qty >= 0 and accepted_qty >= 0
    and delivered_stock_qty >= 0 and accepted_stock_qty >= 0
    and accepted_qty <= delivered_qty
    and accepted_stock_qty <= delivered_stock_qty
  ) not valid;
alter table public.purchase_order_delivery_lines
  validate constraint purchase_order_delivery_lines_practical_qty_check;
```

- [ ] **Step 5: Implement one idempotent WMS helper and neutral approval RPCs**

`app_private.ensure_material_po_batch_wms(batch_id, actor_id)` must lock PO/batch, return existing WMS on replay, and otherwise create one `transactions` IMPORT row with `source_type='po_delivery_batch'`. `approve_material_po_batch` accepts `pending_approval`, plus already-approved historical batches missing WMS, then calls the helper. It never caps quantity by MR.

Public signatures:

```sql
public.submit_material_po_batch(uuid, uuid, uuid) returns jsonb
public.decide_material_po_batch(uuid, text, text, uuid) returns jsonb
public.approve_material_po_batch(uuid, uuid) returns jsonb
public.approve_single_material_po(text, uuid, uuid) returns jsonb
```

All public wrappers are `security invoker`; privileged helpers remain in `app_private`, use `security definer`, and set `search_path=''`.

- [ ] **Step 6: Implement quality and stock finalization**

`approve_material_po_quality` must require WMS `PENDING`, allow delivered above/below ordered, require line reason for any variance, update delivered/accepted fields, set WMS `APPROVED` and batch `quality_approved`, and never call `apply_stock_change`.

`finalize_material_po_receipt` must require WMS `APPROVED` or return the completed result on replay, apply `accepted_stock_qty` once, set WMS `COMPLETED`, and derive batch/PO status. A single PO completes after that one receipt even if short/over; a multiple PO stays `partial` until actual accepted meets MR or the user closes it.

- [ ] **Step 7: Convert PO-211, PO-259, and PO-414 without deleting rows**

```sql
update public.purchase_orders
set procurement_flow_version = 2
where po_number in ('PO-211', 'PO-259', 'PO-414')
  and procurement_flow_version in (3, 4);
```

Preserve batch IDs, WMS IDs, QR tokens, fulfillment links, approval audit, and quality values. For approved unfinished batches missing WMS, call the private ensure helper with the recorded approver/creator. Do not create `purchase_order_receipts` rows and do not change stock during migration.

- [ ] **Step 8: Validate the migration in a rolled-back Cloud transaction**

```bash
set -a
source .env
set +a
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
PO_FLOW_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_material_po_practical_flow\.sql$')"
test -n "$PO_FLOW_MIGRATION"
psql "$(tr -d '\n' < supabase/.temp/pooler-url)" -X -v ON_ERROR_STOP=1 -v migration_file="$PO_FLOW_MIGRATION" <<'SQL'
begin;
\i :migration_file
rollback;
SQL
```

Record the resolved CLI-created filename in the task log.

- [ ] **Step 9: Commit reviewed SQL without applying it yet**

```bash
git add supabase/migrations/*_material_po_practical_flow.sql supabase/tests/material_po_practical_flow_smoke.sql
git commit -m "feat(procurement): add practical PO Cloud commands"
```

---

### Task 4: Replace versioned services with the neutral command API

**Files:**
- Modify: `lib/purchasePackageService.ts`
- Modify: `lib/purchaseReceiptService.ts`
- Modify: `lib/purchaseReceiptWorkflow.ts`
- Modify: `lib/__tests__/purchasePackageService.test.ts`
- Modify: `lib/__tests__/purchaseReceiptService.test.ts`
- Modify: `lib/__tests__/purchaseReceiptWorkflow.test.ts`

**Interfaces:**
- Produces methods: `submitBatch`, `decideBatch`, `approveBatch`, `approveSingle`, `approveQuality`, `finalizeReceipt`.

- [ ] **Step 1: Write failing RPC mapping tests**

```ts
expect(rpc).toHaveBeenCalledWith('approve_material_po_quality', {
  p_delivery_batch_id: 'batch-1',
  p_wms_transaction_id: 'tx-1',
  p_actor_user_id: 'keeper-1',
  p_quality_result: 'partial',
  p_lines: [{
    deliveryLineId: 'line-1', itemId: 'item-1',
    deliveredPurchaseQty: 103, acceptedPurchaseQty: 101,
    deliveredStockQty: 103, acceptedStockQty: 101,
    varianceReason: 'Cân thực tế',
  }],
  p_attachments: [],
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run lib/__tests__/purchasePackageService.test.ts lib/__tests__/purchaseReceiptService.test.ts lib/__tests__/purchaseReceiptWorkflow.test.ts
```

- [ ] **Step 3: Define the fixed quality input**

```ts
export interface MaterialPoQualityLineInput {
  deliveryLineId: string;
  itemId: string;
  deliveredPurchaseQty: number;
  acceptedPurchaseQty: number;
  deliveredStockQty: number;
  acceptedStockQty: number;
  varianceReason?: string | null;
}
```

- [ ] **Step 4: Implement neutral calls and remove runtime flow branching**

Use only:

```ts
supabase.rpc('submit_material_po_batch', payload)
supabase.rpc('decide_material_po_batch', payload)
supabase.rpc('approve_material_po_batch', payload)
supabase.rpc('approve_single_material_po', payload)
supabase.rpc('approve_material_po_quality', payload)
supabase.rpc('finalize_material_po_receipt', payload)
```

Detect a PO WMS by `sourceType === 'po_delivery_batch'`, not by version. Legacy rows missing delivered quantities map delivered=accepted.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run lib/__tests__/purchasePackageService.test.ts lib/__tests__/purchaseReceiptService.test.ts lib/__tests__/purchaseReceiptWorkflow.test.ts
npm run lint
git add lib/purchasePackageService.ts lib/purchaseReceiptService.ts lib/purchaseReceiptWorkflow.ts lib/__tests__/purchasePackageService.test.ts lib/__tests__/purchaseReceiptService.test.ts lib/__tests__/purchaseReceiptWorkflow.test.ts
git commit -m "refactor(procurement): use one practical PO command API"
```

---

### Task 5: Simplify PO creation and approval UI

**Files:**
- Modify: `pages/project/SupplyChainTab.tsx`
- Modify: `lib/purchaseOrderUiPolicy.ts`
- Modify: `lib/purchaseOrderDemand.ts`
- Modify: `lib/__tests__/purchaseOrderUiPolicy.test.ts`
- Modify: `lib/__tests__/purchaseOrderDemand.test.ts`
- Create: `components/project/__tests__/MaterialPoFormFlow.test.tsx`

**Interfaces:**
- Produces: single PO header approval; multiple batch approval; no parent-package approval for multiple mode.

- [ ] **Step 1: Write failing policy tests**

```ts
expect(policyFor(singleDraft).primaryAction?.id).toBe('submit_package');
expect(policyFor(singleSent).primaryAction?.id).toBe('approve_package');
expect(policyFor(multipleWithDraftBatch).primaryAction?.id).toBe('submit_delivery_batch');
expect(policyFor(multipleWithPendingBatch).primaryAction?.id).toBe('approve_delivery_batch');
```

Assert no visible label contains `Duyệt gói`, `Duyệt bổ sung`, `QR cấp PO`, `V3`, or `V4`.

- [ ] **Step 2: Verify failure**

```bash
npx vitest run lib/__tests__/purchaseOrderUiPolicy.test.ts components/project/__tests__/MaterialPoFormFlow.test.tsx
```

- [ ] **Step 3: Remove flow-version selection from save**

Every from-request PO persists only the practical fields:

```ts
{
  sourceMode: 'from_request',
  purchaseMode: pPurchaseMode,
  vendorId,
  vendorName,
  targetWarehouseId: pTargetWarehouseId,
  items: groupItems.map(buildPoBudgetSnapshot),
}
```

MR snapshot fields remain read-only. Single mode stores entered quantity/price/VAT on the PO. Multiple mode stores actual quantity/price/VAT on each batch.

- [ ] **Step 4: Implement exact paths**

Single: `Lưu nháp` saves PO, `Gửi duyệt` sends PO, `Duyệt đơn` calls `approveSingle`; the technical batch is hidden.

Multiple: save open parent, save batch draft, submit batch, approve batch; never approve the parent as a package. Allow multiple approved batches to wait for receipt concurrently.

- [ ] **Step 5: Relax nonphysical blockers**

Keep only: quantity > 0, price >= 0, VAT 0..100, item belongs to PO, supplier matches PO. Do not reject over-MR/order/receipt values. Require a batch reason only when total active approved/pending quantity exceeds MR; a partial batch needs no reason.

- [ ] **Step 6: Run and commit**

```bash
npx vitest run lib/__tests__/purchaseOrderUiPolicy.test.ts lib/__tests__/purchaseOrderDemand.test.ts components/project/__tests__/MaterialPoFormFlow.test.tsx
npm run lint
git add pages/project/SupplyChainTab.tsx lib/purchaseOrderUiPolicy.ts lib/purchaseOrderDemand.ts lib/__tests__/purchaseOrderUiPolicy.test.ts lib/__tests__/purchaseOrderDemand.test.ts components/project/__tests__/MaterialPoFormFlow.test.tsx
git commit -m "feat(procurement): simplify single and multi material PO ordering"
```

---

### Task 6: Implement the real two-step warehouse receipt

**Files:**
- Modify: `components/ReceivePurchaseOrderModal.tsx`
- Modify: `pages/Inventory.tsx`
- Modify: `pages/Operations.tsx`
- Create: `components/__tests__/ReceivePurchaseOrderModal.test.tsx`
- Modify: `lib/__tests__/purchaseReceiptWorkflow.test.ts`

**Interfaces:**
- Consumes: neutral quality/finalize services.
- Produces: actual delivered, accepted, stock quantities; separate quality and stock actions.

- [ ] **Step 1: Write failing component tests**

```ts
expect(screen.getByLabelText('SL thực giao')).toBeInTheDocument();
expect(screen.getByLabelText('SL đạt chất lượng')).toBeInTheDocument();
expect(screen.getByLabelText('SL thực nhập kho')).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Duyệt SL/CL' })).toBeInTheDocument();
expect(screen.queryByRole('button', { name: 'Nhập kho' })).not.toBeInTheDocument();
```

For an `APPROVED` WMS, assert only `Nhập kho` is actionable. Variance must block without a reason and pass with `Cân thực tế khác phiếu giao`.

- [ ] **Step 2: Verify failure**

```bash
npx vitest run components/__tests__/ReceivePurchaseOrderModal.test.tsx lib/__tests__/purchaseReceiptWorkflow.test.ts
```

- [ ] **Step 3: Build exact quality payloads**

```ts
{
  deliveryLineId: line.id,
  itemId: line.itemId,
  deliveredPurchaseQty,
  acceptedPurchaseQty,
  deliveredStockQty,
  acceptedStockQty,
  varianceReason: hasVariance ? reason.trim() : null,
}
```

Default inputs to ordered values but allow any non-negative delivered amount and accepted <= delivered. When units differ, warehouse enters real stock quantity rather than using catalog conversion automatically.

- [ ] **Step 4: Implement buttons by WMS state**

- `PENDING`: show `Duyệt SL/CL`, call `approveQuality`, reload without closing.
- `APPROVED`: lock quantities, show `Nhập kho`, call `finalizeReceipt`.
- `COMPLETED`: read-only, show `Đã nhập kho`.

- [ ] **Step 5: Route both warehouse screens to the same modal**

Inventory and Operations resolve the batch by WMS transaction ID, verify assigned warehouse, and open this modal. Non-PO WMS records continue using the standard transaction modal.

- [ ] **Step 6: Run and commit**

```bash
npx vitest run components/__tests__/ReceivePurchaseOrderModal.test.tsx lib/__tests__/purchaseReceiptService.test.ts lib/__tests__/purchaseReceiptWorkflow.test.ts
npm run lint
git add components/ReceivePurchaseOrderModal.tsx pages/Inventory.tsx pages/Operations.tsx components/__tests__/ReceivePurchaseOrderModal.test.tsx lib/__tests__/purchaseReceiptWorkflow.test.ts
git commit -m "feat(wms): separate PO quality approval from stock receipt"
```

---

### Task 7: Simplify cockpit and batch actions

**Files:**
- Modify: `components/project/PurchaseOrderCockpitDrawer.tsx`
- Modify: `components/project/PurchaseDeliveryBatchEditor.tsx`
- Modify: `components/project/__tests__/PurchaseDeliveryBatchEditor.test.ts`
- Create: `components/project/__tests__/PurchaseOrderCockpitPracticalFlow.test.tsx`

**Interfaces:**
- Produces: plain-language order/batch cards and four factual totals.

- [ ] **Step 1: Write failing presentation tests**

Single assertions: `Đơn mua hàng` exists and `Đợt 1` does not. Multiple assertions: `Các đợt mua`, `Đợt 01`, `Đợt 02` exist. No package, master estimate, supplemental approval, PO-level QR, V3, or V4 text exists.

- [ ] **Step 2: Verify failure**

```bash
npx vitest run components/project/__tests__/PurchaseDeliveryBatchEditor.test.ts components/project/__tests__/PurchaseOrderCockpitPracticalFlow.test.tsx
```

- [ ] **Step 3: Display only factual totals**

```text
Nhu cầu MR
Đã duyệt đặt
Đã thực nhập
Còn lại / Vượt
```

Approved quantity sums approved non-cancelled batches. Actual stock sums accepted stock of completed WMS batches. Negative remainder displays `Vượt X`, never clamps to zero.

- [ ] **Step 4: Map actions by status**

- draft/revision/rejected: edit, delete, submit;
- pending: approve, request revision, reject;
- approved/receiving: open batch WMS/QR;
- quality approved: open WMS for stock receipt;
- completed: view only.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run components/project/__tests__/PurchaseDeliveryBatchEditor.test.ts components/project/__tests__/PurchaseOrderCockpitPracticalFlow.test.tsx
npm run lint
git add components/project/PurchaseOrderCockpitDrawer.tsx components/project/PurchaseDeliveryBatchEditor.tsx components/project/__tests__/PurchaseDeliveryBatchEditor.test.ts components/project/__tests__/PurchaseOrderCockpitPracticalFlow.test.tsx
git commit -m "refactor(procurement): present practical PO and batch states"
```

---

### Task 8: Apply to Cloud, retire obsolete RPCs, and produce release evidence

**Files:**
- Verify: `supabase/migrations/*_material_po_practical_flow.sql`
- Verify: `supabase/tests/material_po_practical_flow_smoke.sql`
- Create via CLI after acceptance: the single file matching `supabase/migrations/*_retire_material_po_v3_v4_rpcs.sql`
- Create: `docs/runbooks/material-po-practical-flow-rollout.md`

**Interfaces:**
- Produces: verified Cloud cutover and auditable release record.

- [ ] **Step 1: Run complete local verification**

```bash
npm run lint
npm test
npm run build
git diff --check
```

- [ ] **Step 2: Dry-run Cloud migration**

```bash
set -a
source .env
set +a
npx --yes supabase@2.110.0 db push --linked --password "$SUPABASE_DB_PASSWORD" --dry-run
```

Expected: only the new practical-flow migration. Stop if an older local-only migration appears.

- [ ] **Step 3: Capture pre-cutover facts read-only**

Inside `BEGIN READ ONLY`, record PO/batch/WMS/fulfillment facts and relevant stock balances for PO-211/259/414; end with `ROLLBACK`.

- [ ] **Step 4: Apply and verify**

```bash
npx --yes supabase@2.110.0 db push --linked --password "$SUPABASE_DB_PASSWORD" --yes
npx --yes supabase@2.110.0 db query --linked --password "$SUPABASE_DB_PASSWORD" --file supabase/tests/material_po_practical_flow_smoke.sql
npx --yes supabase@2.110.0 db advisors --linked --type security --level warn --fail-on error
npx --yes supabase@2.110.0 db advisors --linked --type performance --level warn --fail-on error
```

Verify no stock changed during migration, PO-259 still has three batches, PO-414 retains its approved WMS, and every approved unfinished batch has one WMS.

- [ ] **Step 5: Exercise both acceptance scenarios against Cloud**

1. Single: draft → submit → approve → WMS PENDING → short/over quality with reason → WMS APPROVED and unchanged stock → finalize and exact one-time stock increase.
2. Multiple: two batches with different quantity/price/VAT → approve both before receipt → receive one short and one over with reasons → verify aggregate actual stock and remaining/vượt summary.

- [ ] **Step 6: Create retirement migration through CLI**

```bash
npx --yes supabase@2.110.0 migration new retire_material_po_v3_v4_rpcs
```

Revoke and drop public/private V3/V4 command overloads only after `rg` confirms no application caller. Drop the four empty master-estimate/receipt tables only if Cloud counts remain zero and no FK dependency exists. Keep batch approval columns for practical multiple delivery.

- [ ] **Step 7: Validate/apply retirement migration and re-run smoke/advisors**

Use the same rolled-back `psql`, `db push --dry-run`, `db push`, smoke, migration-list, and advisor sequence. Never edit the six historical migrations.

- [ ] **Step 8: Scan for active rejected references**

```bash
rg -n "procurementFlowVersion|recordReceiptV3|recordReceiptV4|approveDeliveryBatchV4|purchase_order_master_estimates|purchase_order_receipts" components lib pages --glob '!**/__tests__/**'
```

Expected: no active application reference.

- [ ] **Step 9: Write rollout evidence and commit**

The runbook records exact migration versions, pre/post facts for the three POs, both acceptance results, proof quality approval did not change stock, proof finalization changed stock once, and rollback by frontend redeploy without editing completed stock rows.

```bash
git add supabase/migrations/*_retire_material_po_v3_v4_rpcs.sql docs/runbooks/material-po-practical-flow-rollout.md
git commit -m "chore(procurement): retire rejected PO flows and record rollout"
```

- [ ] **Step 10: Final verification**

```bash
npm run lint
npm test
npm run build
git diff --check
git log --oneline origin/main..HEAD
```

Report branch, commits, test counts, Cloud migration versions, and PO-211/259/414 outcomes. Confirm unrelated contract changes were not altered or included in PO commits.
