# Direct Purchase Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mua nóng/CCDC a guarded, reversible lifecycle from draft through supplier payable and payment, using Vietnamese business copy that does not expose the term AP.

**Architecture:** Put lifecycle authorization, state transitions and downstream cancellation checks in Postgres RPCs so UI state cannot bypass them. The TypeScript service exposes those RPCs as explicit business actions; SupplyChainTab only renders actions allowed by the current state and dependency snapshot. Payment reversal remains owned by the payable workspace and updates the source purchase state through database logic.

**Tech Stack:** React/TypeScript, Supabase Postgres migrations/RPC/RLS, Vitest, existing supplier payable/payment services.

## Global Constraints

- UI must say **Xác nhận công nợ nhà cung cấp**, never `Ghi AP` for direct purchase.
- `Từ chối phiếu` is a header-level action; do not expose per-line rejection controls.
- Only a `draft` purchase that has never been submitted and has no downstream document may be deleted.
- A paid purchase cannot be edited, cancelled, rejected or unrecorded until its supplier payment batch is reversed.
- WMS completion and CCDC records must block direct cancellation until their own reversing workflow is available.
- State and permission checks must be enforced by RPC, not only React visibility.

---

### Task 1: Define guarded database lifecycle and cancellation semantics

**Files:**
- Create: `supabase/migrations/20260723100000_direct_purchase_lifecycle_v1.sql`
- Test: `supabase/tests/direct_purchase_lifecycle_v1.sql`

**Interfaces:**
- Produces `public.record_site_direct_purchase_payable_v1(uuid)` returning `supplier_payable_documents`.
- Produces `public.unrecord_site_direct_purchase_payable_v1(uuid, text)` returning `site_direct_purchases`.
- Produces `public.reject_site_direct_purchase_v1(uuid, text)` returning `site_direct_purchases`.
- Produces `public.transition_site_direct_purchase_v1(uuid, text, text default null)` returning `site_direct_purchases`.
- Updates `public.reverse_supplier_payment_batch(uuid, uuid)` so the source purchase returns from `closed` to `reconciled` when payment is reversed.

- [ ] **Step 1: Write failing SQL assertions for transitions and active-AP rejection**

  Add cases that create a draft direct purchase, submit it, approve it, record an unpaid payable, reject it, and assert the payable is `cancelled` and the purchase is `rejected`. Add cases that assert a paid payable rejects both `reject_site_direct_purchase_v1` and `unrecord_site_direct_purchase_payable_v1` with an error mentioning `Đảo thanh toán`.

  ```sql
  begin
    perform public.reject_site_direct_purchase_v1(v_paid_purchase_id, 'Sai chứng từ');
    raise exception 'expected paid purchase rejection to fail';
  exception when others then
    if position('Đảo thanh toán' in sqlerrm) = 0 then raise; end if;
  end;

  if (select status from public.supplier_payable_documents
      where source_id = v_unpaid_purchase_id::text) <> 'cancelled' then
    raise exception 'rejection must cancel its active payable';
  end if;
  ```

- [ ] **Step 2: Run the focused database test and verify it fails**

  Run: `npx supabase db query --linked --agent=no -f supabase/tests/direct_purchase_lifecycle_v1.sql`.
  Expected: failure because the four lifecycle RPCs do not exist and rejection leaves the payable open.

- [ ] **Step 3: Add the migration with one transaction-safe source-of-truth transition implementation**

  In the migration, lock the purchase and its source payable with `FOR UPDATE`; use `app_private.material_flow_has_action_or_legacy` for direct-purchase actions and `app_private.ap_scope_can_mutate` for payable actions. Enforce this transition map:

  ```sql
  -- transition_site_direct_purchase_v1 action map
  -- submit: draft -> submitted
  -- return_to_draft: submitted -> draft
  -- approve_to_buy: submitted -> approved_to_buy
  -- cancel_approval: approved_to_buy -> submitted
  -- mark_purchased: approved_to_buy -> purchased
  -- close_after_payment: reconciled -> closed
  ```

  `record_site_direct_purchase_payable_v1` must reject `draft`, `submitted`, `approved_to_buy`, `rejected`, `cancelled` and `closed`; require completed WMS for active stock lines; call the existing CCDC synchronizer only for accepted small-tool lines; call `sync_supplier_payable_from_site_direct_purchase`; then set the header to `reconciled`.

  `unrecord_site_direct_purchase_payable_v1` and `reject_site_direct_purchase_v1` must fail when: a source payment allocation belongs to a `paid` batch; a completed WMS source exists; a site-cash settlement exists; or a small-tool record has progressed beyond a reversible initial state. For an unpaid active payable, set it to `cancelled`, set `recognized_amount = 0`, preserve metadata with `cancelledAt`, `cancelledBy` and reason, then set the purchase to `finance_review` (unrecord) or `rejected` (reject). Do not delete the payable row.

  Update the existing payable synchronization function so its upsert cannot re-open a `cancelled`/`reversed` document except through `record_site_direct_purchase_payable_v1`. Update `reverse_supplier_payment_batch` to call the lifecycle transition to leave the source in `reconciled` when its balance becomes open/partial; keep the existing negative project transaction.

- [ ] **Step 4: Run focused database assertions and migration lint**

  Run: `npx supabase db query --linked --agent=no -f supabase/tests/direct_purchase_lifecycle_v1.sql` and `npx supabase db query --linked --agent=no "select pg_get_functiondef('public.record_site_direct_purchase_payable_v1(uuid)'::regprocedure);"`.
  Expected: all lifecycle cases pass, and a direct API call cannot cancel a paid or WMS-completed source.

- [ ] **Step 5: Commit the database lifecycle**

  ```bash
  git add supabase/migrations/20260723100000_direct_purchase_lifecycle_v1.sql supabase/tests/direct_purchase_lifecycle_v1.sql
  git commit -m "feat(procurement): guard direct purchase lifecycle"
  ```

### Task 2: Make the direct-purchase service explicit and remove automatic payable creation

**Files:**
- Modify: `lib/siteDirectPurchaseService.ts:105-136, 270-363`
- Modify: `lib/__tests__/siteDirectPurchaseService.test.ts:186-530`

**Interfaces:**
- Produces `siteDirectPurchaseService.recordPayable(id: string)`.
- Produces `siteDirectPurchaseService.unrecordPayable(id: string, reason: string)`.
- Produces `siteDirectPurchaseService.rejectDocument(id: string, reason: string)`.
- Produces `siteDirectPurchaseService.transition(id: string, action: DirectPurchaseLifecycleAction, reason?: string)`.
- `upsert` persists only header/lines and never calls payable synchronization.

- [ ] **Step 1: Replace the automatic-payable test with failing explicit-action tests**

  Replace `auto-syncs AP after saving an expense-only direct purchase` with a test that asserts `upsert` invokes only `upsert_site_direct_purchase_with_lines`. Add tests for each new service method and exact RPC payloads:

  ```ts
  await siteDirectPurchaseService.recordPayable('direct-1');
  expect(supabaseMocks.rpc).toHaveBeenCalledWith('record_site_direct_purchase_payable_v1', {
    p_direct_purchase_id: 'direct-1',
  });

  await siteDirectPurchaseService.rejectDocument('direct-1', 'Sai hóa đơn');
  expect(supabaseMocks.rpc).toHaveBeenCalledWith('reject_site_direct_purchase_v1', {
    p_direct_purchase_id: 'direct-1',
    p_reason: 'Sai hóa đơn',
  });
  ```

- [ ] **Step 2: Run the service test and verify it fails**

  Run: `npm test -- lib/__tests__/siteDirectPurchaseService.test.ts`.
  Expected: failure because `upsert` currently auto-syncs non-stock lines and the explicit methods do not exist.

- [ ] **Step 3: Implement service actions and remove client-side state mutation**

  Remove the `hasRecognizableNonStockLine` branch from `upsert`. Add a `DirectPurchaseLifecycleAction` union and thin RPC wrappers for the four RPCs from Task 1. Replace unrestricted `setStatus` use for state-changing UI flows with `transition`; retain `setStatus` only if it is no longer publicly used, otherwise remove it to prevent bypassing the lifecycle.

- [ ] **Step 4: Run focused service tests**

  Run: `npm test -- lib/__tests__/siteDirectPurchaseService.test.ts`.
  Expected: PASS; saved CCDC/expense drafts have no payable RPC call, and all lifecycle actions call the guarded RPC names.

- [ ] **Step 5: Commit service behavior**

  ```bash
  git add lib/siteDirectPurchaseService.ts lib/__tests__/siteDirectPurchaseService.test.ts
  git commit -m "feat(procurement): require explicit payable confirmation"
  ```

### Task 3: Align the Mua nóng UI with the lifecycle and permissions

**Files:**
- Modify: `pages/project/SupplyChainTab.tsx:351-364, 1941-2158, 6680-6800`
- Test: `pages/project/__tests__/SupplyChainTab.directPurchase.test.tsx` (create if the project uses component tests there; otherwise cover action predicates in `lib/__tests__/siteDirectPurchaseService.test.ts`)

**Interfaces:**
- Renders `Xác nhận công nợ nhà cung cấp`, `Bỏ xác nhận công nợ`, and `Từ chối phiếu`.
- Does not render `Ghi AP`, `Duyệt dòng`, or per-line `Từ chối` for direct-purchase lines.
- Uses `canDeleteDirectPurchaseDocument` only for `draft && !everSubmitted` with no WMS, settlement, payable, or CCDC dependency reported by the lifecycle detail.

- [ ] **Step 1: Write a failing UI/action-predicate test**

  Assert a draft shows edit/delete/send; a reconciled unpaid document shows **Bỏ xác nhận công nợ** and **Từ chối phiếu**; a closed document shows no edit/delete/reject action; and direct-purchase detail contains neither `Ghi AP` nor a per-line `Từ chối` button.

  ```tsx
  expect(screen.getByRole('button', { name: 'Xác nhận công nợ nhà cung cấp' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Ghi AP$/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Từ chối$/ })).toBeNull();
  ```

- [ ] **Step 2: Run the focused UI test and verify it fails**

  Run: `npm test -- pages/project/__tests__/SupplyChainTab.directPurchase.test.tsx`.
  Expected: failure because the current UI renders `Ghi AP` and line-level rejection actions.

- [ ] **Step 3: Replace local transitions with named lifecycle actions**

  Change status copy: `submitted` to **Chờ duyệt**, `approved_to_buy` to **Đã duyệt mua**, `finance_review` to **Chờ xác nhận công nợ**, `reconciled` to **Đã xác nhận công nợ**, and `closed` to **Đã thanh toán**. Use reason confirmation dialogs for both unrecord and whole-document rejection. The rejection dialog must state the blocking condition if the RPC reports payment/WMS/CCDC dependencies. Make the delete predicate require exactly `purchase.status === 'draft'`, `!everSubmitted`, no linked WMS/settlement/PO; let the RPC remain the final authority for payable/CCDC checks.

  Use `recordPayable`, `unrecordPayable`, `rejectDocument`, and `transition` from Task 2. After every successful action call `reloadSelectedDirectPurchase` and `loadSupplyData`; never call `setStatus(..., 'reconciled')` from React.

- [ ] **Step 4: Run focused UI and service tests**

  Run the focused component test and `npm test -- lib/__tests__/siteDirectPurchaseService.test.ts`. Expected: PASS and no direct-purchase user-facing AP jargon remains.

- [ ] **Step 5: Commit the UI alignment**

  ```bash
  git add pages/project/SupplyChainTab.tsx pages/project/__tests__/SupplyChainTab.directPurchase.test.tsx lib/__tests__/siteDirectPurchaseService.test.ts
  git commit -m "feat(procurement): clarify direct purchase payable actions"
  ```

### Task 4: Verify payment reversal, regression behavior, and deployment readiness

**Files:**
- Modify: `lib/__tests__/supplierPaymentBatchService.test.ts` only if a new assertion is required for the existing reverse RPC payload.
- Modify: `docs/bao-cao-vong-doi-yeu-cau-vat-tu.md` only if it contains old direct-purchase AP button copy.

**Interfaces:**
- Confirms a paid supplier payment batch still calls `reverse_supplier_payment_batch` and restores an eligible source purchase to `reconciled`.

- [ ] **Step 1: Add a regression test for reversal availability**

  Assert the payment service sends its existing `reverse_supplier_payment_batch` payload and that the direct-purchase lifecycle test observes `closed -> reconciled` after the payment batch is reversed.

  ```ts
  await supplierPaymentBatchService.reverse('batch-1', 'user-1');
  expect(supabaseMocks.rpc).toHaveBeenCalledWith('reverse_supplier_payment_batch', {
    p_batch_id: 'batch-1',
    p_actor_id: 'user-1',
  });
  ```

- [ ] **Step 2: Run the regression test and verify it fails only if lifecycle integration is absent**

  Run: `npm test -- lib/__tests__/supplierPaymentBatchService.test.ts` and the SQL lifecycle test. Expected: direct-purchase status assertion fails before Task 1 migration is applied and passes after it.

- [ ] **Step 3: Update stale user-facing copy and execute the complete verification suite**

  Replace only direct-purchase references to `Ghi AP` with **Xác nhận công nợ nhà cung cấp**. Then run:

  ```bash
  npm run lint
  npm test
  npm run build
  git diff --check
  git status --short
  ```

  Expected: lint, tests and production build pass; diff check has no whitespace errors; status contains only intended lifecycle files.

- [ ] **Step 4: Commit final regression and documentation changes**

  ```bash
  git add lib/__tests__/supplierPaymentBatchService.test.ts docs/bao-cao-vong-doi-yeu-cau-vat-tu.md
  git commit -m "test(procurement): cover payable reversal lifecycle"
  ```
