# Proactive Project Purchase Package V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Purchase Package V2 approval, delivery, WMS/QR, receipt, and close-short behavior to eligible `proactive_project` purchase orders while preserving multiple commercial lines for one inventory item at different prices.

**Architecture:** Introduce one pure eligibility module used by form, projections, policies, approval routing, and receipt routing. Persisted proactive packages are marked by non-null `referenceGrossAmount`; new/convertible forms additionally require the existing site rollout flag. Extend the database commands with the same source/marker rule and branch close-short so proactive packages never require material-request links.

**Tech Stack:** React 19, TypeScript, Vitest, Supabase/PostgreSQL PL/pgSQL, Vite.

## Global Constraints

- Apply Package V2 only to `proactive_project`; keep `proactive_stock`, `company_consolidated`, and direct purchases unchanged.
- New and convertible proactive packages require the existing site rollout flag.
- Persisted proactive V2 POs remain operable even if the client rollout flag is later disabled.
- Existing active legacy proactive POs must remain on the legacy lifecycle.
- `lineId` is the commercial-line identity; never identify a repeated SKU mutation by `itemId` alone.
- Same SKU with different normalized prices remains valid; the existing same-price duplicate rule remains unchanged.
- Proactive Package V2 must not create, query for mutation, or update material-request fulfillment links.
- Add only forward migrations; do not edit applied Supabase migration files.

---

## File map

- Create `lib/purchasePackageEligibility.ts`: pure source, persisted-runtime, and form-conversion eligibility rules.
- Create `lib/__tests__/purchasePackageEligibility.test.ts`: eligibility and grandfathering matrix.
- Modify `lib/purchasePackageDomain.ts`: recognize proactive V2 package reference amounts.
- Modify `lib/purchaseOrderAmount.ts`: use Package V2 reference/display amount rules for eligible proactive packages.
- Modify `lib/purchaseOrderSchedulePricing.ts`: resolve package reference line prices for eligible proactive packages.
- Modify `lib/purchaseOrderUiPolicy.ts`: select V2 actions for eligible proactive packages while retaining legacy actions for unmarked POs.
- Modify `components/project/PurchaseOrderCockpitDrawer.tsx`: use the shared persisted eligibility rule.
- Modify `lib/purchaseOrderDeliveryDraft.ts`: package-aware defaults and save metadata helper.
- Modify `pages/project/SupplyChainTab.tsx`: expose the V2 form, persist metadata, and retain request-only UI conditions.
- Modify `lib/projectService.ts`: route eligible proactive approvals through the Package V2 command.
- Modify `lib/materialRequestFulfillmentService.ts`: route proactive V2 receipts through the V2 batch path and retain legacy proactive receipt behavior.
- Create `supabase/migrations/20260807120000_extend_purchase_package_v2_to_proactive_project.sql`: database eligibility helper and replaced approval, planned-delivery, close-short, and anomaly-view definitions.
- Create `lib/__tests__/purchasePackageProactiveProjectMigration.test.ts`: forward-migration contract.
- Modify `supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`: transactional proactive repeated-SKU/two-price scenario.
- Modify `docs/runbooks/purchase-package-v2-rollout.md`: rollout and rollback checks for proactive packages.

---

### Task 1: Centralize Package V2 eligibility and grandfathering

**Files:**
- Create: `lib/purchasePackageEligibility.ts`
- Create: `lib/__tests__/purchasePackageEligibility.test.ts`

**Interfaces:**
- Produces: `hasPurchasePackageMode(po)`, `isPersistedPurchasePackageV2(po)`, `canUsePurchasePackageV2Form(input)`, and `shouldRoutePurchasePackageApproval(input)`.
- Consumes: `PurchaseOrder`, `PurchaseOrderSourceMode`, and `POStatus` from `types.ts`.

- [ ] **Step 1: Write the failing eligibility matrix test**

```ts
import { describe, expect, it } from 'vitest';
import {
  canUsePurchasePackageV2Form,
  isPersistedPurchasePackageV2,
  shouldRoutePurchasePackageApproval,
} from '../purchasePackageEligibility';

describe('purchasePackageEligibility', () => {
  it('recognizes persisted request and marked proactive packages', () => {
    expect(isPersistedPurchasePackageV2({
      sourceMode: 'from_request',
      purchaseMode: 'single',
      referenceGrossAmount: undefined,
    })).toBe(true);
    expect(isPersistedPurchasePackageV2({
      sourceMode: 'proactive_project',
      purchaseMode: 'multiple',
      referenceGrossAmount: 0,
    })).toBe(true);
  });

  it('keeps unmarked proactive and all proactive-stock POs on legacy', () => {
    expect(isPersistedPurchasePackageV2({
      sourceMode: 'proactive_project',
      purchaseMode: 'single',
      referenceGrossAmount: null,
    })).toBe(false);
    expect(isPersistedPurchasePackageV2({
      sourceMode: 'proactive_stock',
      purchaseMode: 'single',
      referenceGrossAmount: 100,
    })).toBe(false);
  });

  it('allows new, draft, and returned proactive forms only at enabled sites', () => {
    expect(canUsePurchasePackageV2Form({
      sourceMode: 'proactive_project',
      status: undefined,
      referenceGrossAmount: undefined,
      siteEnabled: true,
      isNew: true,
    })).toBe(true);
    expect(canUsePurchasePackageV2Form({
      sourceMode: 'proactive_project',
      status: 'draft',
      referenceGrossAmount: null,
      siteEnabled: true,
      isNew: false,
    })).toBe(true);
    expect(canUsePurchasePackageV2Form({
      sourceMode: 'proactive_project',
      status: 'confirmed',
      referenceGrossAmount: null,
      siteEnabled: true,
      isNew: false,
    })).toBe(false);
    expect(canUsePurchasePackageV2Form({
      sourceMode: 'proactive_project',
      status: 'draft',
      referenceGrossAmount: null,
      siteEnabled: false,
      isNew: false,
    })).toBe(false);
  });

  it('keeps persisted proactive packages routable after rollout is disabled', () => {
    expect(shouldRoutePurchasePackageApproval({
      po: {
        sourceMode: 'proactive_project',
        purchaseMode: 'single',
        referenceGrossAmount: 100,
      },
      requestSiteEnabled: false,
    })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --run lib/__tests__/purchasePackageEligibility.test.ts`

Expected: FAIL because `lib/purchasePackageEligibility.ts` does not exist.

- [ ] **Step 3: Implement the pure eligibility module**

```ts
import type { POStatus, PurchaseOrder, PurchaseOrderSourceMode } from '../types';

type PackageIdentity = Pick<PurchaseOrder,
  'sourceMode' | 'purchaseMode' | 'referenceGrossAmount'>;

export const hasPurchasePackageMode = (
  po: Pick<PurchaseOrder, 'purchaseMode'>,
) => po.purchaseMode === 'single' || po.purchaseMode === 'multiple';

export const isPersistedPurchasePackageV2 = (
  po: PackageIdentity,
) => hasPurchasePackageMode(po) && (
  po.sourceMode === 'from_request'
  || (po.sourceMode === 'proactive_project'
    && po.referenceGrossAmount !== null
    && po.referenceGrossAmount !== undefined)
);

export const canUsePurchasePackageV2Form = (input: {
  sourceMode?: PurchaseOrderSourceMode | null;
  status?: POStatus;
  referenceGrossAmount?: number | null;
  siteEnabled: boolean;
  isNew: boolean;
}) => {
  if (!input.siteEnabled) return false;
  if (input.sourceMode === 'from_request') return true;
  if (input.sourceMode !== 'proactive_project') return false;
  if (input.referenceGrossAmount !== null && input.referenceGrossAmount !== undefined) return true;
  return input.isNew || input.status === 'draft' || input.status === 'returned';
};

export const shouldRoutePurchasePackageApproval = (input: {
  po: PackageIdentity;
  requestSiteEnabled: boolean;
}) => input.po.sourceMode === 'from_request'
  ? input.requestSiteEnabled && hasPurchasePackageMode(input.po)
  : isPersistedPurchasePackageV2(input.po);
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm test -- --run lib/__tests__/purchasePackageEligibility.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the eligibility seam**

```bash
git add lib/purchasePackageEligibility.ts lib/__tests__/purchasePackageEligibility.test.ts
git commit -m "feat: define proactive purchase package eligibility"
```

---

### Task 2: Extend package projections, pricing, cockpit, and action policy

**Files:**
- Modify: `lib/purchasePackageDomain.ts`
- Modify: `lib/purchaseOrderAmount.ts`
- Modify: `lib/purchaseOrderSchedulePricing.ts`
- Modify: `lib/purchaseOrderUiPolicy.ts`
- Modify: `components/project/PurchaseOrderCockpitDrawer.tsx`
- Modify: `lib/__tests__/purchasePackageDomain.test.ts`
- Modify: `lib/__tests__/purchaseOrderAmount.test.ts`
- Modify: `lib/__tests__/purchaseOrderUiPolicy.test.ts`
- Modify: `lib/__tests__/purchaseOrderDrawerRegression.test.ts`

**Interfaces:**
- Consumes: `isPersistedPurchasePackageV2(po)` from Task 1.
- Produces: one consistent runtime classification for package totals, delivery pricing, action selection, and cockpit labels.

- [ ] **Step 1: Add failing proactive-package projection and policy tests**

Add these focused cases:

```ts
it('uses package reference values for a marked proactive-project package', () => {
  const summary = getPurchasePackageSummary({
    ...makePackage({ qty: 10, unitPrice: 10_000, vatRate: 10 }),
    sourceMode: 'proactive_project',
    referenceGrossAmount: 110_000,
  }, [makeBatch({ id: 'batch-1', plannedQty: 10, acceptedQty: 0, unitPrice: 9_000, vatRate: 10 })]);

  expect(summary.referenceGross).toBe(110_000);
  expect(summary.releasedGross).toBe(110_000);
});
```

```ts
it('uses V2 actions for a marked proactive-project package', () => {
  const policy = getPurchaseOrderUiPolicy(baseInput({
    po: packagePo({
      sourceMode: 'proactive_project',
      referenceGrossAmount: 100_000,
      status: 'confirmed',
    }),
  }));
  expect(policy.primaryAction?.id).toBe('add_delivery');
  expect(policy.secondaryActions.map(action => action.id)).not.toContain('create_supplier_payable');
});

it('keeps an unmarked proactive-project PO on legacy actions', () => {
  const policy = getPurchaseOrderUiPolicy(baseInput({
    po: makePo({
      sourceMode: 'proactive_project',
      purchaseMode: 'single',
      referenceGrossAmount: null,
      status: 'confirmed',
    }),
  }));
  expect(policy.primaryAction?.id).toBe('create_delivery');
});
```

In `purchaseOrderAmount.test.ts`, add a marked proactive package with
`referenceGrossAmount = 1_100_000`, VAT 10%, and a stale delivery price; assert
the printed/display pre-tax amount is `1_000_000`. Add a paired unmarked
proactive case and assert it retains legacy delivery-based calculation.

In `purchaseOrderDrawerRegression.test.ts`, assert the cockpit imports and uses
`isPersistedPurchasePackageV2` and no longer declares its local
`po.sourceMode === 'from_request'` package predicate.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- --run \
  lib/__tests__/purchasePackageDomain.test.ts \
  lib/__tests__/purchaseOrderAmount.test.ts \
  lib/__tests__/purchaseOrderUiPolicy.test.ts \
  lib/__tests__/purchaseOrderDrawerRegression.test.ts
```

Expected: proactive package cases follow legacy calculations/actions or the
cockpit source contract lacks the shared helper.

- [ ] **Step 3: Replace local source predicates with the shared runtime rule**

Import `isPersistedPurchasePackageV2` in all five production consumers. Replace
the local checks with:

```ts
const isPackageV2 = isPersistedPurchasePackageV2(po);
```

In `purchaseOrderAmount.ts` and `purchaseOrderSchedulePricing.ts`, use the same
helper for package-reference amount and package-reference price behavior. Keep
the existing positive-amount calculation guard where division requires a
positive denominator; do not use positivity as the V2 identity marker.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the command from Step 2.

Expected: PASS, including the legacy proactive assertions.

- [ ] **Step 5: Run existing commercial-line regressions**

Run:

```bash
npm test -- --run \
  lib/__tests__/purchaseOrderCommercialLines.test.ts \
  lib/__tests__/purchaseOrderDeliveryDraft.test.ts \
  lib/__tests__/purchaseOrderDeliveryPrint.test.ts \
  lib/__tests__/purchaseOrderSupplierReturnService.test.ts
```

Expected: PASS; repeated SKU/different-price rows remain line-safe.

- [ ] **Step 6: Commit projection and policy integration**

```bash
git add \
  lib/purchasePackageDomain.ts \
  lib/purchaseOrderAmount.ts \
  lib/purchaseOrderSchedulePricing.ts \
  lib/purchaseOrderUiPolicy.ts \
  components/project/PurchaseOrderCockpitDrawer.tsx \
  lib/__tests__/purchasePackageDomain.test.ts \
  lib/__tests__/purchaseOrderAmount.test.ts \
  lib/__tests__/purchaseOrderUiPolicy.test.ts \
  lib/__tests__/purchaseOrderDrawerRegression.test.ts
git commit -m "feat: apply package policy to proactive project POs"
```

---

### Task 3: Enable and persist the proactive Package V2 form

**Files:**
- Modify: `lib/purchaseOrderDeliveryDraft.ts`
- Modify: `pages/project/SupplyChainTab.tsx`
- Modify: `lib/__tests__/purchaseOrderDeliveryDraft.test.ts`
- Modify: `lib/__tests__/materialPoCommercialLinesUiContract.test.ts`

**Interfaces:**
- Consumes: `canUsePurchasePackageV2Form(input)` from Task 1 and the existing site flag.
- Produces: `getDefaultPurchaseMode(sourceMode, isPackageV2Form)` and `buildPurchasePackageMetadataForSave(input)`.

- [ ] **Step 1: Write failing package-form metadata tests**

Add to `purchaseOrderDeliveryDraft.test.ts`:

```ts
it('defaults an eligible proactive package to single purchase mode', () => {
  expect(getDefaultPurchaseMode('proactive_project', true)).toBe('single');
  expect(getDefaultPurchaseMode('proactive_project', false)).toBe('multiple');
  expect(getDefaultPurchaseMode('proactive_stock', false)).toBe('multiple');
});

it('persists proactive package metadata including a zero reference amount', () => {
  expect(buildPurchasePackageMetadataForSave({
    enabled: true,
    purchaseMode: 'multiple',
    referenceGrossAmount: 0,
    existingFulfillmentMode: undefined,
  })).toEqual({
    purchaseMode: 'multiple',
    referenceGrossAmount: 0,
    fulfillmentMode: 'RECEIVE_TO_STOCK',
  });
});

it('does not mark a legacy proactive PO as Package V2', () => {
  expect(buildPurchasePackageMetadataForSave({
    enabled: false,
    purchaseMode: 'single',
    referenceGrossAmount: 100,
    existingFulfillmentMode: undefined,
  })).toEqual({
    purchaseMode: undefined,
    referenceGrossAmount: undefined,
    fulfillmentMode: undefined,
  });
});
```

Add a source-contract assertion that `SupplyChainTab.tsx` calls
`canUsePurchasePackageV2Form`, passes the result into
`buildPurchasePackageMetadataForSave`, and still gates `+ Đề xuất` with
`pSourceMode === 'from_request'`.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- --run \
  lib/__tests__/purchaseOrderDeliveryDraft.test.ts \
  lib/__tests__/materialPoCommercialLinesUiContract.test.ts
```

Expected: FAIL because the package-aware signatures and metadata builder do
not exist.

- [ ] **Step 3: Implement package-aware defaults and save metadata**

Add to `purchaseOrderDeliveryDraft.ts`:

```ts
export const getDefaultPurchaseMode = (
  sourceMode?: PurchaseOrderSourceMode | null,
  isPackageV2Form = sourceMode === 'from_request',
): PurchaseMode => isPackageV2Form ? 'single' : 'multiple';

export const buildPurchasePackageMetadataForSave = (input: {
  enabled: boolean;
  purchaseMode: PurchaseMode;
  referenceGrossAmount: number;
  existingPurchaseMode?: PurchaseMode;
  existingReferenceGrossAmount?: number | null;
  existingFulfillmentMode?: MaterialRequestFulfillmentMode;
}) => input.enabled ? {
  purchaseMode: input.purchaseMode,
  referenceGrossAmount: input.referenceGrossAmount,
  fulfillmentMode: input.existingFulfillmentMode
    || MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK,
} : {
  purchaseMode: input.existingPurchaseMode,
  referenceGrossAmount: input.existingReferenceGrossAmount ?? undefined,
  fulfillmentMode: input.existingFulfillmentMode,
};
```

- [ ] **Step 4: Wire the shared form eligibility into `SupplyChainTab.tsx`**

Replace the local source-only form predicate with:

```ts
const isPurchasePackageV2FormEnabled = (
  sourceMode: PurchaseOrderSourceMode = pSourceMode,
  siteId?: string | null,
  po: PurchaseOrder | null = editingPo,
) => canUsePurchasePackageV2Form({
  sourceMode,
  status: po?.status,
  referenceGrossAmount: po?.referenceGrossAmount,
  siteEnabled: isPurchasePackageV2EnabledForSite(siteId ?? constructionSiteId ?? null),
  isNew: !po,
});
```

Use this predicate when opening a new PO, changing source, loading a draft, and
building each supplier-split PO. Compute the metadata once per resulting PO:

```ts
const packageMetadata = buildPurchasePackageMetadataForSave({
  enabled: isV2Package,
  purchaseMode: pPurchaseMode,
  referenceGrossAmount: groupTotalAmount * (1 + vatRate / 100),
  existingPurchaseMode: editingPo?.purchaseMode,
  existingReferenceGrossAmount: editingPo?.referenceGrossAmount,
  existingFulfillmentMode: editingPo?.fulfillmentMode,
});
```

Spread `packageMetadata` into preview, update, and create payloads. Keep
request-only UI, warehouse fallback, request cart, and request-link building
guarded by `pSourceMode === 'from_request'`.

- [ ] **Step 5: Verify the form tests and repeated-line tests are GREEN**

Run:

```bash
npm test -- --run \
  lib/__tests__/purchaseOrderDeliveryDraft.test.ts \
  lib/__tests__/materialPoCommercialLinesUiContract.test.ts \
  lib/__tests__/purchaseOrderCommercialLines.test.ts \
  lib/__tests__/purchaseOrderExcelUiContract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Type-check before committing the large form integration**

Run: `npm run lint`

Expected: PASS with no TypeScript errors.

- [ ] **Step 7: Commit the form integration**

```bash
git add \
  lib/purchaseOrderDeliveryDraft.ts \
  pages/project/SupplyChainTab.tsx \
  lib/__tests__/purchaseOrderDeliveryDraft.test.ts \
  lib/__tests__/materialPoCommercialLinesUiContract.test.ts
git commit -m "feat: enable proactive project package form"
```

---

### Task 4: Route proactive approval and receipt through Package V2

**Files:**
- Modify: `lib/projectService.ts`
- Modify: `lib/materialRequestFulfillmentService.ts`
- Modify: `lib/__tests__/projectService.materialPo.phase3.test.ts`
- Modify: `lib/__tests__/materialRequestFulfillmentService.actualReceipt.test.ts`
- Modify: `lib/__tests__/materialRequestFulfillmentService.proactiveReceipt.test.ts`

**Interfaces:**
- Consumes: `isPersistedPurchasePackageV2(po)` and `shouldRoutePurchasePackageApproval(input)` from Task 1.
- Produces: V2 approval and receipt routing for marked proactive POs; legacy routing for unmarked proactive POs.

- [ ] **Step 1: Write a failing proactive approval-routing test**

Add a `projectService.materialPo.phase3.test.ts` case whose PO lookup returns:

```ts
{
  id: 'po-proactive-v2',
  source_mode: 'proactive_project',
  construction_site_id: 'site-1',
  purchase_mode: 'single',
  reference_gross_amount: 100000,
}
```

Call `poService.updateStatus(..., { status: 'confirmed', lastActionBy:
'leader-1' })` and assert the Package V2 approval RPC is called even when the
mocked site flag returns false. Add a paired row with
`reference_gross_amount: null` and assert it routes through
`transition_project_purchase_order_status`.

- [ ] **Step 2: Write a failing proactive V2 receipt-routing test**

Clone the actual-receipt fixture with:

```ts
const proactivePackagePo = {
  ...po,
  sourceMode: 'proactive_project' as const,
  purchaseMode: 'single' as const,
  referenceGrossAmount: 720000,
};
```

Use two PO lines sharing `itemId` but using `line-72k` and `line-75k`, and two
delivery lines with matching `purchaseOrderLineId` values. Assert
`approve_receipt_quality_v2` receives two distinct `deliveryLineId` entries and
that `supabase.from` is never called for legacy request/PO-wide lookup.

Add a paired test in `materialRequestFulfillmentService.proactiveReceipt.test.ts`
showing an unmarked proactive PO still creates/uses the legacy proactive WMS
receipt path.

- [ ] **Step 3: Run the routing tests and verify RED**

Run:

```bash
npm test -- --run \
  lib/__tests__/projectService.materialPo.phase3.test.ts \
  lib/__tests__/materialRequestFulfillmentService.actualReceipt.test.ts \
  lib/__tests__/materialRequestFulfillmentService.proactiveReceipt.test.ts
```

Expected: the marked proactive PO is routed through legacy transitions or
legacy proactive receipt logic.

- [ ] **Step 4: Implement approval routing**

In `poService.updateStatus`, load these fields:

```ts
.select('id,source_mode,construction_site_id,purchase_mode,reference_gross_amount')
```

Map the row to the helper input and route with:

```ts
const routePackageApproval = shouldRoutePurchasePackageApproval({
  po: {
    sourceMode: poRow?.source_mode,
    purchaseMode: poRow?.purchase_mode,
    referenceGrossAmount: poRow?.reference_gross_amount,
  },
  requestSiteEnabled: isPurchasePackageV2EnabledForSite(poRow?.construction_site_id),
});
```

Do not put the marked proactive branch behind the global/site flag; its
persisted marker is the rollback-safe runtime contract.

- [ ] **Step 5: Implement receipt routing before the legacy source split**

Change `shouldUsePurchasePackageReceiptV2` so request-backed packages retain
their current site-flag behavior while a marked proactive package uses its
persisted marker:

```ts
const shouldUsePurchasePackageReceiptV2 = (
  input: PreparePoReceiptForQualityReviewInput,
) => {
  const sourceEnabled = input.po.sourceMode === 'from_request'
    ? isPurchasePackageV2EnabledForSite(
      input.po.constructionSiteId || input.deliveryBatch?.constructionSiteId,
    )
    : isPersistedPurchasePackageV2(input.po);
  return sourceEnabled
    && !!input.deliveryBatch?.id
    && !!input.deliveryBatch.wmsTransactionId;
};
```

In `preparePoReceiptForQualityReview`, evaluate that predicate first:

```ts
if (shouldUsePurchasePackageReceiptV2(input)) {
  return approvePurchasePackageReceiptV2(input);
}
if (input.po.sourceMode !== 'from_request') {
  return prepareProactivePoReceiptForQualityReview(input);
}
```

In `createPoDeliveryReceiptBatch`, preserve the existing request site gate and
prevent legacy WMS creation for a marked proactive package:

```ts
const isV2Delivery = po.sourceMode === 'from_request'
  ? isPurchasePackageV2EnabledForSite(
    po.constructionSiteId || deliveryBatch.constructionSiteId,
  )
  : isPersistedPurchasePackageV2(po);
if (isV2Delivery) {
  if (deliveryBatch.wmsTransactionId) return [];
  throw new Error('Đợt giao V2 phải tạo WMS/QR bằng command tạo Đợt.');
}
if (po.sourceMode !== 'from_request') {
  return createProactivePoDeliveryReceiptBatch(input);
}
```

- [ ] **Step 6: Run the routing tests and verify GREEN**

Run the command from Step 3.

Expected: PASS; repeated proactive package lines reach the V2 receipt command,
while unmarked proactive POs remain legacy.

- [ ] **Step 7: Commit service routing**

```bash
git add \
  lib/projectService.ts \
  lib/materialRequestFulfillmentService.ts \
  lib/__tests__/projectService.materialPo.phase3.test.ts \
  lib/__tests__/materialRequestFulfillmentService.actualReceipt.test.ts \
  lib/__tests__/materialRequestFulfillmentService.proactiveReceipt.test.ts
git commit -m "feat: route proactive packages through v2 commands"
```

---

### Task 5: Extend Supabase Package V2 commands and proactive close-short

**Files:**
- Create: `supabase/migrations/20260807120000_extend_purchase_package_v2_to_proactive_project.sql`
- Create: `lib/__tests__/purchasePackageProactiveProjectMigration.test.ts`

**Interfaces:**
- Produces: `app_private.is_purchase_package_v2_eligible(text,text,numeric)` and forward replacements for the current planned-delivery preparation, approval, close-short, public wrapper grants, and anomaly view.
- Consumes: the existing signatures used by `purchasePackageService.ts`; no client RPC name changes.

- [ ] **Step 1: Write the failing migration contract test**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const path = join(process.cwd(), 'supabase', 'migrations',
  '20260807120000_extend_purchase_package_v2_to_proactive_project.sql');
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const normalized = sql.replace(/\s+/g, ' ').trim();

describe('proactive project Purchase Package V2 migration', () => {
  it('defines one source and marker eligibility contract', () => {
    expect(normalized).toContain(
      'create or replace function app_private.is_purchase_package_v2_eligible');
    expect(normalized).toContain("p_source_mode = 'from_request'");
    expect(normalized).toContain(
      "p_source_mode = 'proactive_project' and p_reference_gross_amount is not null");
    expect(normalized).not.toContain("p_source_mode = 'proactive_stock'");
  });

  it('applies eligibility to approval, planned WMS/QR, and close-short', () => {
    expect(normalized).toContain(
      'create or replace function app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2');
    expect(normalized).toContain(
      'create or replace function app_private.approve_purchase_package_and_prepare_single_batch_v2');
    expect(normalized).toContain(
      'create or replace function app_private.close_purchase_package_short_v2');
    expect(normalized.match(/app_private\.is_purchase_package_v2_eligible/g)?.length)
      .toBeGreaterThanOrEqual(4);
  });

  it('keeps proactive close-short independent from MR closure rows', () => {
    expect(normalized).toContain("v_po.source_mode = 'from_request'");
    expect(normalized).toContain('from public.purchase_order_delivery_lines delivery_line');
    expect(normalized).toContain('closed_need_qty = coalesce(closed_need_qty, 0) + v_total_closed_qty');
  });

  it('includes marked proactive packages in the anomaly view', () => {
    expect(normalized).toContain('create or replace view public.purchase_package_v2_anomalies');
    expect(normalized).toContain("po.source_mode = 'proactive_project'");
    expect(normalized).toContain('po.reference_gross_amount is not null');
  });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm test -- --run lib/__tests__/purchasePackageProactiveProjectMigration.test.ts`

Expected: FAIL because the forward migration does not exist.

- [ ] **Step 3: Add the SQL eligibility helper**

Start the new migration with:

```sql
create schema if not exists app_private;

create or replace function app_private.is_purchase_package_v2_eligible(
  p_source_mode text,
  p_purchase_mode text,
  p_reference_gross_amount numeric
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_purchase_mode, '') in ('single', 'multiple')
    and (
      p_source_mode = 'from_request'
      or (
        p_source_mode = 'proactive_project'
        and p_reference_gross_amount is not null
      )
    );
$$;

revoke all on function app_private.is_purchase_package_v2_eligible(text,text,numeric)
  from public, anon, authenticated;
```

- [ ] **Step 4: Replace the latest approval and planned-delivery private functions**

Carry forward the complete current definitions from
`20260726233500_purchase_package_planned_schedule_approval_v2.sql`, preserving
their signatures, permission checks, idempotency, planned-batch reuse, WMS
payload, public wrapper, revokes, and grants. Replace each source-only rejection
with this exact guard:

```sql
if not app_private.is_purchase_package_v2_eligible(
  v_po.source_mode,
  v_po.purchase_mode,
  v_po.reference_gross_amount
) then
  raise exception 'PO khong thuoc luong Goi mua hang V2.' using errcode = '22023';
end if;
```

The auto-created single batch must continue iterating every JSONB item and
passing `coalesce(v_item ->> 'lineId', v_item ->> 'itemId')` to the core command.
Do not group by `itemId`, SKU, or price.

- [ ] **Step 5: Replace close-short with explicit request and proactive branches**

Carry forward the existing permission, status, open-delivery, transition guard,
and public wrapper behavior. After locating each PO item, calculate received
quantity for a proactive line from delivery rows:

```sql
select coalesce(sum(greatest(
  coalesce(delivery_line.accepted_qty, 0)
  - coalesce(delivery_line.returned_qty, 0),
  0
)), 0)
into v_received_qty
from public.purchase_order_delivery_lines delivery_line
join public.purchase_order_delivery_batches batch
  on batch.id = delivery_line.delivery_batch_id
where delivery_line.purchase_order_id = p_purchase_order_id
  and delivery_line.purchase_order_line_id = v_purchase_order_line_id
  and batch.status <> 'cancelled';
```

For `from_request`, retain the existing request-link validation and
`material_request_line_need_closures` insert. For `proactive_project`, require
only the PO line and item identity, validate
`closeQty <= max(0, orderedQty - receivedQty)`, add it to
`v_total_closed_qty`, and do not insert an MR closure row. Both branches update
the PO aggregate and close status atomically.

- [ ] **Step 6: Replace the anomaly view filter**

Carry forward the full current view projection from
`20260726074602_purchase_package_legacy_audit_v2.sql` and replace its final
source restriction with:

```sql
and (
  po.source_mode = 'from_request'
  or (
    po.source_mode = 'proactive_project'
    and po.reference_gross_amount is not null
  )
)
```

Finish the migration with `notify pgrst, 'reload schema';`.

- [ ] **Step 7: Run the migration contract and existing migration regressions**

Run:

```bash
npm test -- --run \
  lib/__tests__/purchasePackageProactiveProjectMigration.test.ts \
  lib/__tests__/purchasePackagePlannedScheduleApprovalMigration.test.ts \
  lib/__tests__/purchasePackageV2RepairMigration.test.ts \
  lib/__tests__/purchasePackageBusinessPartnerWmsMigration.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the forward migration and contract**

```bash
git add \
  supabase/migrations/20260807120000_extend_purchase_package_v2_to_proactive_project.sql \
  lib/__tests__/purchasePackageProactiveProjectMigration.test.ts
git commit -m "feat: extend purchase package commands to proactive POs"
```

---

### Task 6: Add end-to-end database smoke for repeated proactive commercial lines

**Files:**
- Modify: `supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

**Interfaces:**
- Consumes: unchanged public Package V2 RPC signatures.
- Produces: rollback-safe database evidence for a proactive single package containing one item on two prices.

- [ ] **Step 1: Extend the smoke fixture with proactive package identities**

Add columns for `proactive_po_id`, `proactive_po_number`,
`proactive_line_low_id`, `proactive_line_high_id`, and
`proactive_approval_key`. Register the PO number and insert a `sent`
`proactive_project` PO with non-null `reference_gross_amount` and these items:

```sql
jsonb_build_array(
  jsonb_build_object(
    'lineId', proactive_line_low_id,
    'itemId', item_id,
    'sku', 'PP-V2-SMOKE',
    'name', 'Purchase Package V2 Item',
    'unit', 'Kg',
    'unitSnapshot', 'Kg',
    'purchaseUnitSnapshot', 'Kg',
    'stockUnitSnapshot', 'Kg',
    'purchaseConversionFactor', 1,
    'qty', 4,
    'unitPrice', 10000
  ),
  jsonb_build_object(
    'lineId', proactive_line_high_id,
    'itemId', item_id,
    'sku', 'PP-V2-SMOKE',
    'name', 'Purchase Package V2 Item',
    'unit', 'Kg',
    'unitSnapshot', 'Kg',
    'purchaseUnitSnapshot', 'Kg',
    'stockUnitSnapshot', 'Kg',
    'purchaseConversionFactor', 1,
    'qty', 6,
    'unitPrice', 12000
  )
)
```

Use `purchase_mode = 'single'`, `fulfillment_mode = 'RECEIVE_TO_STOCK'`, and
the exact gross reference derived from both lines and fixture VAT.

- [ ] **Step 2: Approve the proactive package and assert line preservation**

Invoke `public.approve_purchase_package_and_prepare_single_batch_v2` as the
authorized approver. Assert:

```sql
select count(*) = 2,
       count(distinct delivery_line.purchase_order_line_id) = 2,
       count(distinct delivery_line.item_id) = 1,
       array_agg(delivery_line.delivery_unit_price order by delivery_line.delivery_unit_price)
         = array[10000::numeric, 12000::numeric]
from public.purchase_order_delivery_lines delivery_line
where delivery_line.purchase_order_id = v_ids.proactive_po_id;
```

Raise a descriptive exception unless all four predicates are true. Load the
linked WMS transaction and assert its two JSONB items retain the two line IDs
and two accounting prices.

- [ ] **Step 3: Exercise V2 quality approval without MR links**

Approve receipt quality for both delivery lines and assert the command
succeeds while this query remains zero:

```sql
select count(*)
from public.purchase_order_request_lines link
where link.purchase_order_id = v_ids.proactive_po_id;
```

The smoke file already starts with `begin` and ends with `rollback`; retain
that transaction boundary.

- [ ] **Step 4: Run static SQL and TypeScript checks**

Run:

```bash
git diff --check
npm test -- --run lib/__tests__/purchasePackageProactiveProjectMigration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run linked database smoke when the environment is configured**

Run:

```bash
npx --yes supabase@2.110.0 db query --linked --file \
  supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql
```

Expected: the script completes and rolls back without an exception. If no
linked Supabase project is configured, record that environmental limitation in
the final handoff; do not claim the smoke passed.

- [ ] **Step 6: Commit the smoke extension**

```bash
git add supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql
git commit -m "test: smoke proactive project purchase packages"
```

---

### Task 7: Update rollout guidance and run complete verification

**Files:**
- Modify: `docs/runbooks/purchase-package-v2-rollout.md`

**Interfaces:**
- Consumes: all implemented behavior from Tasks 1–6.
- Produces: deploy, pilot, rollback, and acceptance instructions for proactive packages.

- [ ] **Step 1: Update the runbook**

Add these checks:

- rollout enables creation/conversion only for `proactive_project` at selected sites;
- only new, draft, returned, or already-marked proactive POs use V2;
- `reference_gross_amount IS NOT NULL` is the persisted proactive marker;
- disabling the flag stops new conversion but must not strand marked POs;
- pilot acceptance creates one SKU on two price lines and verifies distinct PO line IDs through delivery, WMS, receipt, payable, and return;
- `proactive_stock` remains legacy.

Add this audit query:

```sql
select id, po_number, status, source_mode, purchase_mode,
       reference_gross_amount, construction_site_id
from public.purchase_orders
where source_mode = 'proactive_project'
  and reference_gross_amount is not null
order by created_at desc;
```

- [ ] **Step 2: Run the focused Purchase Package and repeated-line suite**

Run:

```bash
npm test -- --run \
  lib/__tests__/purchasePackageEligibility.test.ts \
  lib/__tests__/purchasePackageDomain.test.ts \
  lib/__tests__/purchasePackageService.test.ts \
  lib/__tests__/purchaseOrderUiPolicy.test.ts \
  lib/__tests__/purchaseOrderAmount.test.ts \
  lib/__tests__/purchaseOrderDeliveryDraft.test.ts \
  lib/__tests__/purchaseOrderCommercialLines.test.ts \
  lib/__tests__/materialRequestFulfillmentService.actualReceipt.test.ts \
  lib/__tests__/materialRequestFulfillmentService.proactiveReceipt.test.ts \
  lib/__tests__/projectService.materialPo.phase3.test.ts \
  lib/__tests__/purchasePackageProactiveProjectMigration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full repository verification**

Run in order:

```bash
npm run lint
npm test
npm run build
git diff --check
```

Expected: all commands exit zero with no TypeScript, test, build, or whitespace
errors.

- [ ] **Step 4: Inspect the final change scope**

Run:

```bash
git status --short
git diff --stat HEAD~6..HEAD
git log --oneline -n 8
```

Confirm only the files named in this plan and any formatter-generated changes
inside those files are included. Preserve unrelated user work.

- [ ] **Step 5: Commit the runbook**

```bash
git add docs/runbooks/purchase-package-v2-rollout.md
git commit -m "docs: extend purchase package v2 rollout checks"
```

- [ ] **Step 6: Request final code review before integration**

Use `superpowers:requesting-code-review` against the implementation range. The
review must explicitly inspect:

- legacy grandfathering;
- feature-flag versus persisted-runtime behavior;
- repeated SKU/two-price line identity;
- absence of proactive MR mutations;
- SQL permission, idempotency, and transaction safety;
- test and smoke evidence.
