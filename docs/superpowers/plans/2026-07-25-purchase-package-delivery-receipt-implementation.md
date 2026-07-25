# Vioo Purchase Package, Delivery, and Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyen PO tao tu MR thanh Goi mua hang duyet mot lan, quan ly tung Dot giao co WMS/QR rieng, cho Thu kho cong truong Duyet SL/CL va Xac nhan nhap lien tiep, dong thoi ghi chi phi gom VAT va cong no NCC dung mot lan khi receipt.

**Architecture:** Giu cac bang hien huu lam he thong ban ghi, bo sung projection thuan cho giao dien va cac RPC idempotent cho tung command nghiep vu. `purchase_orders` la Goi mua hang, `purchase_order_delivery_batches/lines` la Dot giao, `transactions` la phieu WMS theo Dot, con `project_transactions` va `supplier_payable_documents` duoc post cung giao dich finalize receipt. Giao dien V2 nam sau feature flag cho toi khi toan bo chuoi stock, MR, chi phi va AP vuot integration gate.

**Tech Stack:** React 18, TypeScript 5.8, Vite 6, Vitest 4, Supabase/PostgreSQL PL/pgSQL, Supabase CLI 2.95, Lucide React.

## Global Constraints

- MR la nhu cau goc; khoi luong MR/Goi la baseline tham chieu, khong la tran chan giao dich.
- Goi mua hang duoc lanh dao duyet mot lan; Dot giao khong co vong duyet bo sung.
- `single` la mac dinh va tu tao Dot `-01`, WMS va QR khi Goi duoc duyet; `multiple` khong tu tao Dot tong.
- Moi Dot giao co toi da mot WMS dang hieu luc va mot QR; QR luon mang `delivery_batch_id`, khong suy dien theo toan PO.
- Chenh lech so luong, gia va VAT chi canh bao/audit; khong khoa tao Dot, Duyet SL/CL hoac Xac nhan nhap.
- Van khoa cung so am, vat tu la, QR trung, double-post, sua chung tu da khoa va sai quy doi don vi.
- Chi vai tro Thu kho cong truong duoc Duyet SL/CL va Xac nhan nhap; hai buoc nam tren cung man hinh.
- Sau Duyet SL/CL, so luong va tep chung minh bi khoa; sai sot dung chung tu dao, khong sua nguoc.
- Hang khong dat chat luong bi loai truoc receipt, khong vao kho va khong tao de nghi tra NCC.
- Xac nhan nhap kho hoac nhan giao thang ghi chi phi vat tu gom VAT va cong no NCC trong cung transaction.
- Thanh toan NCC khong tao expense vat tu lan hai.
- Tra NCC sau receipt dao ton, chi phi gom VAT va cong no/credit dung mot lan.
- So luong dung PostgreSQL `numeric` va TypeScript `number`; khong ep integer.
- Quy doi don vi mua/ton chi dung snapshot va ham chuan trong `lib/materialUnitConversion.ts`.
- Migration du lieu cu khong tu sinh Dot, WMS, chi phi hoac cong no.
- Khong thay workflow duyet MR, khong xay lai man cong no theo NCC, va khong tu dong chuyen tien.

---

## Delivery Gates

| Gate | Pham vi | Dieu kien qua gate |
| --- | --- | --- |
| G0 | Tinh dung du lieu | QR theo Dot, receipt chi cham dung Dot, decimal/conversion dung, command idempotent |
| G1 | Goi mua hang | `single`/`multiple`, duyet Goi mot lan, auto Dot/WMS/QR, bo supplemental block |
| G2 | Kho cung man hinh | Duyet SL/CL roi Xac nhan nhap khong dong modal, khoa du lieu sau buoc 1 |
| G3 | Chi phi va AP | Receipt post gross cost/AP; payment khong post expense; return dao du |
| G4 | Chuyen doi | Legacy audit sach, trace day du, feature flag bat theo tung cong trinh |

Khong bat `VITE_ENABLE_PURCHASE_PACKAGE_V2=true` tren production truoc khi G3
vuot smoke test. Cac migration duoc deploy truoc theo thu tu, nhung giao dien
cu tiep tuc hoat dong trong thoi gian G0-G3.

## File Map

**Domain va feature flag**

- Create `lib/purchasePackageDomain.ts`: cong thuc baseline, released, received, gross, variance va projection status.
- Create `lib/purchaseReceiptWorkflow.ts`: state machine hai buoc cua modal kho.
- Modify `lib/featureFlags.ts`: flag V2, mac dinh tat.
- Modify `types.ts`: `PurchaseMode`, field Goi/Dot, status va AP source.

**Server commands**

- Create `lib/purchasePackageService.ts`: wrapper cho approve Goi, tao/huy Dot va lookup QR theo Dot.
- Create `lib/purchaseReceiptService.ts`: wrapper cho Duyet SL/CL va finalize receipt.
- Modify `lib/projectService.ts`: map field moi; khong dung replace delete/insert cho Dot V2.
- Modify `lib/materialRequestFulfillmentService.ts`: xoa duong suy dien receipt theo toan PO o V2.
- Modify `lib/supplierPayableService.ts`: AP receipt la nguon chuan.

**UI**

- Create `components/project/PurchaseModeControl.tsx`: segmented control `single`/`multiple`.
- Create `components/project/PurchasePackageSummary.tsx`: baseline, released, received va warning.
- Create `components/project/PurchaseDeliveryBatchEditor.tsx`: tao/sua Dot va clone gia Dot truoc.
- Modify `pages/project/SupplyChainTab.tsx`: form Goi va entry points cho Dot.
- Modify `components/project/PurchaseOrderCockpitDrawer.tsx`: cockpit Goi/Dot, bo nut WMS/AP thu cong.
- Modify `pages/Inventory.tsx`: scan `deliveryToken`, mo dung Dot/WMS.
- Modify `components/ReceivePurchaseOrderModal.tsx`: ghi nhan theo mot Dot, khong theo remaining cua PO.
- Modify `components/TransactionDetailModal.tsx`: hai buoc lien tiep trong cung modal.
- Modify `pages/project/ProjectFinanceWorkspace.tsx`: payment chi phan bo AP, khong fallback expense.

**Database**

- Create `supabase/migrations/20260725090000_purchase_package_domain_v2.sql`.
- Create `supabase/migrations/20260725100000_purchase_delivery_commands_v2.sql`.
- Create `supabase/migrations/20260725103000_purchase_package_approval_v2.sql`.
- Create `supabase/migrations/20260725110000_purchase_receipt_finalize_v2.sql`.
- Create `supabase/migrations/20260725120000_purchase_receipt_finance_v2.sql`.
- Create `supabase/migrations/20260725123000_purchase_receipt_return_finance_v2.sql`.
- Create `supabase/migrations/20260725124000_supplier_invoice_reconciliation_v2.sql`.
- Create `supabase/migrations/20260725125000_purchase_package_close_short_v2.sql`.
- Create `supabase/migrations/20260725130000_purchase_package_legacy_audit_v2.sql`.
- Create `supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`.

**Tests va runbook**

- Create `lib/__tests__/purchasePackageDomain.test.ts`.
- Create `lib/__tests__/purchasePackageService.test.ts`.
- Create `lib/__tests__/purchaseReceiptService.test.ts`.
- Create `lib/__tests__/purchaseReceiptWorkflow.test.ts`.
- Modify cac contract test PO/WMS/AP hien huu de khong con ky vong flow cu.
- Create `docs/runbooks/purchase-package-v2-rollout.md`.

---

### Task 1: Characterize MR-2026-9753 and Lock the New Domain Contract

**Files:**
- Create: `lib/purchasePackageDomain.ts`
- Create: `lib/__tests__/purchasePackageDomain.test.ts`
- Modify: `types.ts:2144-2765`
- Modify: `lib/featureFlags.ts:1-4`

**Interfaces:**
- Consumes: `PurchaseOrder`, `PurchaseOrderDeliveryBatch`, `PurchaseOrderItem`.
- Produces:

```ts
export type PurchaseMode = 'single' | 'multiple';
export type PurchasePackageUiStatus =
  | 'draft' | 'pending_approval' | 'approved' | 'waiting_delivery'
  | 'partially_received' | 'fulfilled' | 'over_received'
  | 'closed_short' | 'cancelled';
export type PurchaseDeliveryUiStatus =
  | 'waiting_delivery' | 'receiving' | 'quality_approved'
  | 'received' | 'received_short' | 'received_over' | 'cancelled';

export interface PurchasePackageSummary {
  referenceQty: number;
  releasedQty: number;
  acceptedQty: number;
  returnedQty: number;
  receivedNetQty: number;
  releasedVarianceQty: number;
  needVarianceQty: number;
  remainingNeedQty: number;
  referenceGross: number;
  releasedGross: number;
  receivedGross: number;
  releasedGrossVariance: number;
  uiStatus: PurchasePackageUiStatus;
}

export const getPurchasePackageSummary: (
  po: PurchaseOrder,
  batches: PurchaseOrderDeliveryBatch[],
) => PurchasePackageSummary;
```

- [ ] **Step 1: Chup read-only baseline cua MR-2026-9753**

Run:

```bash
npx supabase db query --linked --agent=no \
  "select r.id, r.code, r.status, r.requester_id, u.name as requester_name,
          r.project_id, r.construction_site_id,
          r.submitted_to_user_id, r.submitted_to_permission,
          public.project_user_has_room_action(
            r.project_id, r.construction_site_id,
            'material_request', 'submit', r.requester_id::uuid
          ) as requester_can_submit,
          case when r.submitted_to_user_id is null then null else
            public.project_user_has_room_action(
              r.project_id, r.construction_site_id,
              'material_request', 'approve', r.submitted_to_user_id::uuid
            )
          end as target_can_approve
   from public.requests r
   left join public.users u on u.id::text = r.requester_id::text
   where r.code = 'MR-2026-9753';"
```

Expected: dung mot MR cua Bui Quang Chung. Ghi lai status, submit/approve Room
booleans va loi API khi thao tac gui duyet. Day la baseline de tach loi quyen
Room khoi loi “vuot” cua Goi; buoc nay khong update du lieu.

- [ ] **Step 2: Ghi test that bai cho baseline khong bi tinh la da lap Dot**

```ts
import { describe, expect, it } from 'vitest';
import { getPurchasePackageSummary } from '../purchasePackageDomain';

describe('getPurchasePackageSummary', () => {
  it('keeps a first-time 7,000 Kg package at zero released quantity', () => {
    const summary = getPurchasePackageSummary({
      id: 'po-mr-2026-9753',
      poNumber: 'PO-157',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      vendorId: 'vendor-1',
      items: [{
        lineId: 'line-1',
        itemId: 'VT0000288',
        sku: 'VT0000288',
        name: 'Sika mau xam',
        unit: 'Kg',
        qty: 7000,
        unitPrice: 5600,
      }],
      totalAmount: 39_200_000,
      approvedTotalAmount: 39_200_000,
      referenceGrossAmount: 39_200_000,
      purchaseMode: 'single',
      vatRate: 0,
      orderDate: '2026-07-25',
      status: 'draft',
      sourceMode: 'from_request',
      materialRequestId: 'MR-2026-9753',
      createdAt: '2026-07-25T00:00:00.000Z',
    }, []);

    expect(summary.releasedQty).toBe(0);
    expect(summary.releasedGross).toBe(0);
    expect(summary.releasedGrossVariance).toBe(-39_200_000);
    expect(summary.uiStatus).toBe('draft');
  });

  it('allows 500 Kg plus 510 Kg against a 1,000 Kg baseline', () => {
    const summary = getPurchasePackageSummary(
      makePackage({ qty: 1000, unitPrice: 10_000, vatRate: 0 }),
      [
        makeBatch({ id: 'batch-1', plannedQty: 500, acceptedQty: 0, unitPrice: 10_000, vatRate: 0 }),
        makeBatch({ id: 'batch-2', plannedQty: 510, acceptedQty: 0, unitPrice: 10_000, vatRate: 0 }),
      ],
    );
    expect(summary.releasedQty).toBe(1010);
    expect(summary.releasedVarianceQty).toBe(10);
    expect(summary.receivedNetQty).toBe(0);
  });

  it('recognizes only 90 accepted from a 100 delivery', () => {
    const summary = getPurchasePackageSummary(
      makePackage({ qty: 100, unitPrice: 10_000, vatRate: 10 }),
      [makeBatch({ id: 'batch-1', plannedQty: 100, acceptedQty: 90, unitPrice: 10_000, vatRate: 10 })],
    );
    expect(summary.acceptedQty).toBe(90);
    expect(summary.receivedGross).toBe(990_000);
    expect(summary.remainingNeedQty).toBe(10);
  });
});
```

Trong test file, khai bao `makePackage` tra ve mot `PurchaseOrder` day du va
`makeBatch` tra ve mot `PurchaseOrderDeliveryBatch` day du theo dung cac
object o hai test tren; khong doc source file bang chuoi.

```ts
const makePackage = (input: { qty: number; unitPrice: number; vatRate: number }): PurchaseOrder => ({
  id: 'po-1',
  vendorId: 'vendor-1',
  poNumber: 'PO01',
  items: [{
    lineId: 'po-line-1',
    itemId: 'item-1',
    sku: 'VT-1',
    name: 'Vat tu test',
    unit: 'Kg',
    qty: input.qty,
    unitPrice: input.unitPrice,
  }],
  totalAmount: input.qty * input.unitPrice,
  referenceGrossAmount: input.qty * input.unitPrice * (1 + input.vatRate / 100),
  purchaseMode: 'single',
  vatRate: input.vatRate,
  orderDate: '2026-07-25',
  status: 'confirmed',
  sourceMode: 'from_request',
  createdAt: '2026-07-25T00:00:00.000Z',
});

const makeBatch = (input: {
  id: string;
  plannedQty: number;
  acceptedQty: number;
  unitPrice: number;
  vatRate: number;
}): PurchaseOrderDeliveryBatch => ({
  id: input.id,
  purchaseOrderId: 'po-1',
  deliveryNo: Number(input.id.slice(-1)),
  status: input.acceptedQty > 0 ? 'received_short' : 'receiving',
  vatRate: input.vatRate,
  lines: [{
    id: `${input.id}-line-1`,
    deliveryBatchId: input.id,
    purchaseOrderId: 'po-1',
    purchaseOrderLineId: 'po-line-1',
    itemId: 'item-1',
    plannedQty: input.plannedQty,
    acceptedQty: input.acceptedQty,
    deliveryUnitPrice: input.unitPrice,
  }],
});
```

- [ ] **Step 3: Chay test de xac nhan RED**

Run: `npx vitest run lib/__tests__/purchasePackageDomain.test.ts`

Expected: FAIL vi `purchasePackageDomain.ts` va cac type V2 chua ton tai.

- [ ] **Step 4: Bo sung type va projection thuan**

Them vao `PurchaseOrder`:

```ts
purchaseMode?: PurchaseMode;
referenceGrossAmount?: number;
closedNeedQty?: number;
fulfillmentMode?: MaterialRequestFulfillmentMode;
```

Them vao `PurchaseOrderDeliveryBatch`:

```ts
supplierId?: string | null;
supplierNameSnapshot?: string | null;
vatRate?: number;
qrToken?: string | null;
idempotencyKey?: string | null;
qualityResult?: 'passed' | 'partial' | 'rejected' | null;
varianceReason?: string | null;
qualityApprovedBy?: string | null;
qualityApprovedAt?: string | null;
receivedBy?: string | null;
receivedAt?: string | null;
acceptedGrossAmount?: number;
fulfillmentMode?: MaterialRequestFulfillmentMode;
```

Them vao `PurchaseOrderDeliveryLine`:

```ts
acceptedQty?: number;
acceptedStockQty?: number;
returnedQty?: number;
```

Mo rong stored status type:

```ts
export type PurchaseOrderDeliveryBatchStatus =
  | 'planned' | 'supplemental_pending' | 'wms_pending'
  | 'waiting_delivery' | 'receiving' | 'quality_approved'
  | 'received' | 'received_short' | 'received_over' | 'cancelled';
```

Tao `lib/purchasePackageDomain.ts` voi cac cong thuc:

```ts
const numberValue = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const gross = (qty: number, price: number, vatRate: number) =>
  Math.round(qty * price * (1 + vatRate / 100) * 100) / 100;

const activeBatch = (batch: PurchaseOrderDeliveryBatch) =>
  batch.status !== 'cancelled';

export const getPurchasePackageSummary = (
  po: PurchaseOrder,
  batches: PurchaseOrderDeliveryBatch[],
): PurchasePackageSummary => {
  const active = batches.filter(activeBatch);
  const referenceQty = po.items.reduce((sum, line) => sum + numberValue(line.qty), 0);
  const releasedQty = active.flatMap(batch => batch.lines)
    .reduce((sum, line) => sum + numberValue(line.plannedQty), 0);
  const acceptedQty = active.flatMap(batch => batch.lines)
    .reduce((sum, line) => sum + numberValue(line.acceptedQty), 0);
  const returnedQty = active.flatMap(batch => batch.lines)
    .reduce((sum, line) => sum + numberValue(line.returnedQty), 0);
  const receivedNetQty = Math.max(0, acceptedQty - returnedQty);
  const closedNeedQty = numberValue(po.closedNeedQty);
  const referenceGross = numberValue(po.referenceGrossAmount)
    || po.items.reduce(
      (sum, line) => sum + gross(numberValue(line.qty), numberValue(line.unitPrice), numberValue(po.vatRate)),
      0,
    );
  const releasedGross = active.reduce(
    (sum, batch) => sum + batch.lines.reduce(
      (batchSum, line) => batchSum + gross(
        numberValue(line.plannedQty),
        numberValue(line.deliveryUnitPrice),
        numberValue(batch.vatRate),
      ),
      0,
    ),
    0,
  );
  const receivedGross = active.reduce(
    (sum, batch) => sum + batch.lines.reduce(
      (batchSum, line) => batchSum + gross(
        numberValue(line.acceptedQty) - numberValue(line.returnedQty),
        numberValue(line.deliveryUnitPrice),
        numberValue(batch.vatRate),
      ),
      0,
    ),
    0,
  );
  return {
    referenceQty,
    releasedQty,
    acceptedQty,
    returnedQty,
    receivedNetQty,
    releasedVarianceQty: releasedQty - referenceQty,
    needVarianceQty: receivedNetQty - referenceQty,
    remainingNeedQty: Math.max(0, referenceQty - receivedNetQty - closedNeedQty),
    referenceGross,
    releasedGross,
    receivedGross,
    releasedGrossVariance: releasedGross - referenceGross,
    uiStatus: derivePurchasePackageUiStatus(po, {
      referenceQty,
      receivedNetQty,
      closedNeedQty,
    }),
  };
};
```

`derivePurchasePackageUiStatus` phai map status workflow hien huu va so nhan:
`draft -> draft`, `sent -> pending_approval`, `confirmed` chua co Dot ->
`approved`, co Dot chua nhan -> `waiting_delivery`, nhan `0 < net < need` ->
`partially_received`, bang nhu cau -> `fulfilled`, vuot -> `over_received`,
co `closedNeedQty > 0` -> `closed_short`, va `cancelled -> cancelled`.

- [ ] **Step 5: Them feature flag mac dinh tat**

```ts
const isExplicitlyEnabled = (value: string | undefined): boolean => value === 'true';

export const isPurchasePackageV2Enabled =
  isExplicitlyEnabled(import.meta.env.VITE_ENABLE_PURCHASE_PACKAGE_V2);

const purchasePackageV2SiteIds = new Set(
  String(import.meta.env.VITE_PURCHASE_PACKAGE_V2_SITE_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
);

export const isPurchasePackageV2EnabledForSite = (constructionSiteId?: string | null) =>
  isPurchasePackageV2Enabled
  && (
    purchasePackageV2SiteIds.size === 0
    || (!!constructionSiteId && purchasePackageV2SiteIds.has(constructionSiteId))
  );
```

- [ ] **Step 6: Chay test va typecheck**

Run: `npx vitest run lib/__tests__/purchasePackageDomain.test.ts && npm run lint`

Expected: PASS; TypeScript khong co loi.

- [ ] **Step 7: Commit**

```bash
git add types.ts lib/featureFlags.ts lib/purchasePackageDomain.ts lib/__tests__/purchasePackageDomain.test.ts
git commit -m "feat: add purchase package domain projections"
```

---

### Task 2: Add the Non-Destructive V2 Schema

**Files:**
- Create: `supabase/migrations/20260725090000_purchase_package_domain_v2.sql`
- Modify: `supabase/tests/po_actual_receipt_wms_smoke.sql`

**Interfaces:**
- Consumes: cac bang `purchase_orders`, `purchase_order_delivery_batches`,
  `purchase_order_delivery_lines`, `transactions`.
- Produces: cot Goi/Dot V2, unique guards va status constraint tuong thich legacy.

- [ ] **Step 1: Mo rong smoke test truoc migration**

Them cac assertion:

```sql
if not exists (
  select 1 from information_schema.columns
  where table_schema = 'public'
    and table_name = 'purchase_orders'
    and column_name = 'purchase_mode'
) then
  raise exception 'Missing purchase_orders.purchase_mode';
end if;

if not exists (
  select 1 from pg_indexes
  where schemaname = 'public'
    and indexname = 'uq_po_delivery_batch_idempotency'
) then
  raise exception 'Missing delivery idempotency guard';
end if;

if not exists (
  select 1 from pg_indexes
  where schemaname = 'public'
    and indexname = 'uq_po_delivery_batch_qr_token'
) then
  raise exception 'Missing delivery QR guard';
end if;
```

- [ ] **Step 2: Chay smoke test de xac nhan RED**

Run: `npx supabase db query --linked --agent=no -f supabase/tests/po_actual_receipt_wms_smoke.sql`

Expected: FAIL voi `Missing purchase_orders.purchase_mode`.

- [ ] **Step 3: Viet migration chi bo sung schema, khong tao du lieu nghiep vu**

Migration phai co day du cac lenh sau:

```sql
alter table public.purchase_orders
  add column if not exists purchase_mode text not null default 'single',
  add column if not exists fulfillment_mode text not null default 'RECEIVE_TO_STOCK',
  add column if not exists reference_gross_amount numeric,
  add column if not exists closed_need_qty numeric not null default 0;

alter table public.purchase_orders
  drop constraint if exists purchase_orders_purchase_mode_check;
alter table public.purchase_orders
  add constraint purchase_orders_purchase_mode_check
  check (purchase_mode in ('single', 'multiple'));
alter table public.purchase_orders
  add constraint purchase_orders_fulfillment_mode_check
  check (fulfillment_mode in ('RECEIVE_TO_STOCK', 'DIRECT_CONSUMPTION'));
alter table public.purchase_orders
  add constraint purchase_orders_closed_need_qty_check
  check (closed_need_qty >= 0) not valid;

alter table public.purchase_order_delivery_batches
  add column if not exists supplier_id text,
  add column if not exists supplier_name_snapshot text,
  add column if not exists fulfillment_mode text not null default 'RECEIVE_TO_STOCK',
  add column if not exists vat_rate numeric not null default 0,
  add column if not exists qr_token text,
  add column if not exists idempotency_key uuid,
  add column if not exists quality_result text,
  add column if not exists variance_reason text,
  add column if not exists quality_approved_by uuid references public.users(id) on delete set null,
  add column if not exists quality_approved_at timestamptz,
  add column if not exists received_by uuid references public.users(id) on delete set null,
  add column if not exists received_at timestamptz,
  add column if not exists accepted_gross_amount numeric not null default 0;

alter table public.purchase_order_delivery_lines
  add column if not exists accepted_qty numeric not null default 0,
  add column if not exists accepted_stock_qty numeric not null default 0,
  add column if not exists returned_qty numeric not null default 0;

create unique index if not exists uq_po_delivery_batch_idempotency
  on public.purchase_order_delivery_batches(purchase_order_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists uq_po_delivery_batch_qr_token
  on public.purchase_order_delivery_batches(qr_token)
  where qr_token is not null;
```

Drop/recreate constraint status de chap nhan ca legacy va V2:

```sql
check (status in (
  'planned', 'supplemental_pending', 'wms_pending',
  'waiting_delivery', 'receiving', 'quality_approved',
  'received', 'received_short', 'received_over', 'cancelled'
))
```

Them check `fulfillment_mode in ('RECEIVE_TO_STOCK',
'DIRECT_CONSUMPTION')`, `vat_rate >= 0`, `accepted_gross_amount >= 0`,
`accepted_qty >= 0`, `accepted_stock_qty >= 0`, `returned_qty >= 0`,
va `returned_qty <= accepted_qty` duoi dang `not valid`, sau do `validate
constraint`. Khong update status, khong insert Dot, WMS, cost hoac AP trong
migration nay.

- [ ] **Step 4: Chay migration tren local database va smoke test**

Run: `npx supabase db reset`

Expected: migration chain hoan tat, khong co constraint error.

Run: `npx supabase db query --local -f supabase/tests/po_actual_receipt_wms_smoke.sql`

Expected: PASS va transaction test rollback.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260725090000_purchase_package_domain_v2.sql supabase/tests/po_actual_receipt_wms_smoke.sql
git commit -m "feat: add purchase package v2 schema"
```

---

### Task 3: Create Delivery, WMS, and QR Atomically

**Files:**
- Create: `supabase/migrations/20260725100000_purchase_delivery_commands_v2.sql`
- Create: `lib/purchasePackageService.ts`
- Create: `lib/__tests__/purchasePackageService.test.ts`
- Modify: `lib/projectService.ts:719-780,1237-1360`
- Create: `supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

**Interfaces:**
- Produces:

```ts
export interface CreatePurchaseDeliveryInput {
  purchaseOrderId: string;
  idempotencyKey: string;
  supplierId: string;
  supplierNameSnapshot: string;
  fulfillmentMode: MaterialRequestFulfillmentMode;
  vatRate: number;
  targetWarehouseId: string;
  plannedDeliveryDate?: string | null;
  note?: string | null;
  actorUserId: string;
  lines: Array<{
    purchaseOrderLineId: string;
    itemId: string;
    purchaseQty: number;
    purchaseUnit: string;
    stockQty: number;
    stockUnit: string;
    purchaseUnitPrice: number;
    stockUnitPrice: number;
  }>;
}

export interface PurchaseDeliveryCommandResult {
  deliveryBatchId: string;
  deliveryNo: number;
  deliveryCode: string;
  wmsTransactionId: string;
  qrToken: string;
}

export const purchasePackageService: {
  createDelivery(input: CreatePurchaseDeliveryInput): Promise<PurchaseDeliveryCommandResult>;
  updateUnreceivedDelivery(input: CreatePurchaseDeliveryInput & {
    deliveryBatchId: string;
    wmsTransactionId: string;
  }): Promise<PurchaseDeliveryCommandResult>;
  cancelUnreceivedDelivery(input: {
    deliveryBatchId: string;
    actorUserId: string;
    reason: string;
  }): Promise<void>;
};
```

- [ ] **Step 1: Viet test service RED cho payload va idempotency**

Mock `supabase.rpc` va assert:

```ts
it('sends one command containing delivery, WMS and QR data', async () => {
  rpc.mockResolvedValue({
    data: {
      deliveryBatchId: 'batch-1',
      deliveryNo: 1,
      deliveryCode: 'PO01-01',
      wmsTransactionId: 'tx-1',
      qrToken: 'pod_batch_1',
    },
    error: null,
  });
  const result = await purchasePackageService.createDelivery(input);
  expect(rpc).toHaveBeenCalledWith('create_delivery_batch_with_wms_qr_v2', {
    p_purchase_order_id: 'po-1',
    p_idempotency_key: input.idempotencyKey,
    p_supplier_id: 'vendor-1',
    p_supplier_name: 'NCC 1',
    p_fulfillment_mode: 'RECEIVE_TO_STOCK',
    p_vat_rate: 10,
    p_target_warehouse_id: 'warehouse-1',
    p_planned_delivery_date: null,
    p_note: null,
    p_actor_user_id: 'user-1',
    p_lines: input.lines,
  });
  expect(result.deliveryBatchId).toBe('batch-1');
  expect(result.wmsTransactionId).toBe('tx-1');
});

it('updates the same unreceived delivery and WMS', async () => {
  rpc.mockResolvedValue({
    data: {
      deliveryBatchId: 'batch-1',
      deliveryNo: 1,
      deliveryCode: 'PO01-01',
      wmsTransactionId: 'tx-1',
      qrToken: 'pod_batch_1',
    },
    error: null,
  });
  await purchasePackageService.updateUnreceivedDelivery({
    purchaseOrderId: 'po-1',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    supplierId: 'vendor-1',
    supplierNameSnapshot: 'NCC 1',
    fulfillmentMode: MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK,
    targetWarehouseId: 'warehouse-1',
    plannedDeliveryDate: null,
    note: null,
    actorUserId: 'user-1',
    lines: input.lines,
    deliveryBatchId: 'batch-1',
    wmsTransactionId: 'tx-1',
    vatRate: 8,
  });
  expect(rpc).toHaveBeenCalledWith(
    'update_unreceived_delivery_batch_v2',
    expect.objectContaining({
      p_delivery_batch_id: 'batch-1',
      p_wms_transaction_id: 'tx-1',
      p_vat_rate: 8,
    }),
  );
});
```

- [ ] **Step 2: Chay test de xac nhan RED**

Run: `npx vitest run lib/__tests__/purchasePackageService.test.ts`

Expected: FAIL vi service chua ton tai.

- [ ] **Step 3: Tao private SQL helper va public command**

Migration tao:

```sql
app_private.create_delivery_batch_with_wms_qr_v2(
  p_purchase_order_id text,
  p_idempotency_key uuid,
  p_supplier_id text,
  p_supplier_name text,
  p_fulfillment_mode text,
  p_vat_rate numeric,
  p_target_warehouse_id text,
  p_planned_delivery_date date,
  p_note text,
  p_actor_user_id uuid,
  p_lines jsonb
) returns jsonb
```

va wrapper:

```sql
public.create_delivery_batch_with_wms_qr_v2(
  p_purchase_order_id text,
  p_idempotency_key uuid,
  p_supplier_id text,
  p_supplier_name text,
  p_fulfillment_mode text,
  p_vat_rate numeric,
  p_target_warehouse_id text,
  p_planned_delivery_date date default null,
  p_note text default null,
  p_actor_user_id uuid default null,
  p_lines jsonb default '[]'::jsonb
) returns jsonb
```

Than ham phai khoa `purchase_orders for update`, xac nhan Goi o
`confirmed|in_transit|partial`, kiem tra quyen
`project.material_po.create`, va return ngay record cu neu trung
`(purchase_order_id,idempotency_key)`. Trong mot transaction:

1. Lay `delivery_no = max(delivery_no) + 1`.
2. Validate moi JSON line co qty/price khong am, item va PO line trung khop.
3. Insert Dot status `waiting_delivery`, supplier/VAT/kho, fulfillment mode
   snapshot va token `pod_` + UUID bo dau gach.
4. Insert delivery lines voi purchase/stock snapshot.
5. Insert mot `transactions` IMPORT status PENDING, source
   `po_delivery_batch`, source id Dot, item metadata co `orderedQty`,
   `accountingQty`, `accountingUnit`, `accountingPrice`,
   `purchaseOrderDeliveryBatchId`, `purchaseOrderDeliveryLineId` va
   `fulfillmentMode`. Ca hai mode van co receipt/QR de Thu kho kiem nhan;
   `DIRECT_CONSUMPTION` chi khac o finalize khong post inventory.
6. Update Dot `wms_transaction_id`, status `receiving`.
7. Return JSON theo `PurchaseDeliveryCommandResult`.

Public wrapper chi cho actor hien tai hoac `p_actor_user_id` trung actor hien
tai; revoke `public, anon`, grant `authenticated`. Unique violation phai
re-read va return cung ket qua, khong tao Dot thu hai.

- [ ] **Step 4: Tao atomic update va cancel commands**

`update_unreceived_delivery_batch_v2` khoa Dot/WMS, chi chap nhan Dot
`receiving` va WMS PENDING, giu nguyen delivery/WMS/QR IDs, cam doi item va PO
line, nhung cho sua NCC, qty, price, VAT, kho/diem nhan, ngay va note. Trong
cung transaction no update delivery lines va rebuild WMS item snapshots. Neu
da quality approve, command raise `Dot da Duyet SL/CL va khong con duoc sua.`

`cancel_unreceived_delivery_batch_v2` chi chap nhan cung trang thai, bat buoc
reason, set Dot va WMS `cancelled`, giu row de trace va khong tao stock/cost/AP.

- [ ] **Step 5: Tao wrapper TypeScript**

```ts
const assertCommandResult = (data: unknown): PurchaseDeliveryCommandResult => {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('Command tao Dot khong tra ve ket qua.');
  const value = row as Record<string, unknown>;
  const result = {
    deliveryBatchId: String(value.deliveryBatchId || ''),
    deliveryNo: Number(value.deliveryNo || 0),
    deliveryCode: String(value.deliveryCode || ''),
    wmsTransactionId: String(value.wmsTransactionId || ''),
    qrToken: String(value.qrToken || ''),
  };
  if (!result.deliveryBatchId || !result.wmsTransactionId || !result.qrToken) {
    throw new Error('Dot giao, WMS hoac QR chua duoc tao day du.');
  }
  return result;
};
```

`createDelivery`, `updateUnreceivedDelivery` va `cancelUnreceivedDelivery`
goi dung RPC/payload trong test va cung dung `assertCommandResult`.

- [ ] **Step 6: Viet SQL smoke cho atomicity va idempotency**

Trong `supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`, tao
fixture trong transaction va goi command hai lan cung key. Assert:

```sql
select count(*) = 1
from public.purchase_order_delivery_batches
where purchase_order_id = v_po_id
  and idempotency_key = v_key;

select count(*) = 1
from public.transactions
where source_type = 'po_delivery_batch'
  and source_id = v_batch_id::text;
```

Them case qty am phai raise va sau exception khong co batch/WMS moi. Cuoi file
luon `rollback`.

- [ ] **Step 7: Chay test**

Run: `npx vitest run lib/__tests__/purchasePackageService.test.ts`

Expected: PASS.

Run: `npx supabase db query --local -f supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

Expected: PASS; idempotent retry van chi co mot Dot va mot WMS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260725100000_purchase_delivery_commands_v2.sql supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql lib/purchasePackageService.ts lib/__tests__/purchasePackageService.test.ts lib/projectService.ts
git commit -m "feat: create delivery WMS and QR atomically"
```

---

### Task 4: Approve a Package and Prepare the Default Single Delivery

**Files:**
- Create: `supabase/migrations/20260725103000_purchase_package_approval_v2.sql`
- Modify: `lib/purchasePackageService.ts`
- Modify: `lib/__tests__/purchasePackageService.test.ts`
- Modify: `lib/projectService.ts:1010-1055`
- Modify: `supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

**Interfaces:**
- Produces:

```ts
export interface ApprovePurchasePackageResult {
  purchaseOrderId: string;
  status: 'confirmed';
  purchaseMode: PurchaseMode;
  delivery?: PurchaseDeliveryCommandResult;
}

approvePackage(input: {
  purchaseOrderId: string;
  actorUserId: string;
  idempotencyKey: string;
}): Promise<ApprovePurchasePackageResult>;
```

- [ ] **Step 1: Them test RED cho `single` va `multiple`**

```ts
it('returns the auto-created first delivery for a single package', async () => {
  rpc.mockResolvedValue({
    data: {
      purchaseOrderId: 'po-1',
      status: 'confirmed',
      purchaseMode: 'single',
      delivery: {
        deliveryBatchId: 'batch-1',
        deliveryNo: 1,
        deliveryCode: 'PO01-01',
        wmsTransactionId: 'tx-1',
        qrToken: 'pod_batch_1',
      },
    },
    error: null,
  });
  const result = await purchasePackageService.approvePackage({
    purchaseOrderId: 'po-1',
    actorUserId: 'leader-1',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  });
  expect(result.delivery?.deliveryCode).toBe('PO01-01');
});

it('does not expect a delivery for a multiple package', async () => {
  rpc.mockResolvedValue({
    data: {
      purchaseOrderId: 'po-2',
      status: 'confirmed',
      purchaseMode: 'multiple',
    },
    error: null,
  });
  const result = await purchasePackageService.approvePackage(inputMultiple);
  expect(result.delivery).toBeUndefined();
});
```

- [ ] **Step 2: Chay test RED**

Run: `npx vitest run lib/__tests__/purchasePackageService.test.ts`

Expected: FAIL vi `approvePackage` chua ton tai.

- [ ] **Step 3: Tao `approve_purchase_package_and_prepare_single_batch_v2`**

RPC phai:

1. Khoa Goi, kiem tra quyen Room `material_po/approve`.
2. Cho phep retry neu Goi da `confirmed` va idempotency key da co Dot.
3. Chuyen `sent -> confirmed` trong transition guard hien huu.
4. Neu `purchase_mode='single'`, chuyen toan bo PO item snapshot thanh
   `p_lines`, lay `fulfillment_mode` tu MR lien ket va goi private helper
   Task 3 trong cung SQL transaction.
5. Neu `multiple`, khong tao Dot/WMS/QR.
6. Khong tao supplemental approval du Goi/Dot vuot baseline.
7. Return `ApprovePurchasePackageResult`.

So stock qty va stock unit cua line phai lay tu snapshot da luu tren PO item.
Neu snapshot thieu, RPC raise loi du lieu ro rang thay vi ngam dung factor 1.

- [ ] **Step 4: Chuyen duong approve V2 sang service moi**

Trong `poService.updateStatus`, neu flag V2 bat, `sourceMode ===
'from_request'` va patch status la `confirmed`, caller phai dung
`purchasePackageService.approvePackage`; giu `updateStatus` cho document cu va
nguon PO khac. Khong goi approval RPC roi tao Dot bang hai request frontend.

- [ ] **Step 5: Mo rong SQL smoke**

Assert:

- Goi `single` 1,000 Kg duyet xong co dung mot Dot 1,000, mot WMS va mot QR.
- Retry approval cung key khong nhan doi.
- Goi `multiple` duyet xong co zero Dot.
- Tong Dot 1,010 tren baseline 1,000 luu thanh cong.
- Khong co row moi trong `purchase_order_supplemental_approvals`.

- [ ] **Step 6: Chay tests**

Run: `npx vitest run lib/__tests__/purchasePackageService.test.ts`

Expected: PASS.

Run: `npx supabase db query --local -f supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260725103000_purchase_package_approval_v2.sql supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql lib/purchasePackageService.ts lib/__tests__/purchasePackageService.test.ts lib/projectService.ts
git commit -m "feat: approve purchase packages with default delivery"
```

---

### Task 5: Make Receipt Commands Batch-Scoped and Unit-Safe

**Files:**
- Create: `lib/purchaseReceiptService.ts`
- Create: `lib/__tests__/purchaseReceiptService.test.ts`
- Modify: `lib/materialRequestFulfillmentService.ts:518-690,1238-1270,1631-1715`
- Modify: `lib/__tests__/materialRequestFulfillmentService.proactiveReceipt.test.ts`
- Modify: `lib/__tests__/materialRequestFulfillmentService.actualReceipt.test.ts`
- Modify: `lib/materialUnitConversion.ts`

**Interfaces:**
- Produces:

```ts
export interface ReceiptQualityLineInput {
  deliveryLineId: string;
  itemId: string;
  acceptedPurchaseQty: number;
  acceptedStockQty: number;
  varianceReason?: string | null;
}

export interface ApproveReceiptQualityInput {
  deliveryBatchId: string;
  wmsTransactionId: string;
  actorUserId: string;
  qualityResult: 'passed' | 'partial' | 'rejected';
  lines: ReceiptQualityLineInput[];
  attachments: WmsTransactionAttachment[];
}

export interface ReceiptCommandResult {
  deliveryBatchId: string;
  wmsTransactionId: string;
  deliveryStatus: PurchaseDeliveryUiStatus;
  transactionStatus: TransactionStatus;
  acceptedGrossAmount: number;
}

export const purchaseReceiptService: {
  approveQuality(input: ApproveReceiptQualityInput): Promise<ReceiptCommandResult>;
  finalize(input: {
    deliveryBatchId: string;
    wmsTransactionId: string;
    actorUserId: string;
  }): Promise<ReceiptCommandResult>;
};
```

- [ ] **Step 1: Thay source-string test bang behavior test**

Test `approveQuality` phai assert RPC nhan ca `deliveryBatchId` va
`wmsTransactionId`. Them pure test cho 10 Cay x 7.2 Kg/Cay:

```ts
expect(buildReceiptQuantitySnapshot({
  acceptedPurchaseQty: 9.5,
  purchaseUnit: 'Cay',
  stockUnit: 'Kg',
  conversionFactor: 7.2,
})).toEqual({
  acceptedPurchaseQty: 9.5,
  acceptedStockQty: 68.4,
  purchaseUnit: 'Cay',
  stockUnit: 'Kg',
  conversionFactor: 7.2,
});
```

- [ ] **Step 2: Chay RED**

Run: `npx vitest run lib/__tests__/purchaseReceiptService.test.ts lib/__tests__/materialRequestFulfillmentService.proactiveReceipt.test.ts`

Expected: FAIL vi service va behavior moi chua co.

- [ ] **Step 3: Tao service V2 va dung ham quy doi chuan**

`approveQuality` goi:

```ts
const { data, error } = await supabase.rpc('approve_receipt_quality_v2', {
  p_delivery_batch_id: input.deliveryBatchId,
  p_wms_transaction_id: input.wmsTransactionId,
  p_actor_user_id: input.actorUserId,
  p_quality_result: input.qualityResult,
  p_lines: input.lines,
  p_attachments: input.attachments,
});
```

`finalize` goi `finalize_purchase_receipt_v2` voi ba ID tuong ung. Ca hai
validate result co cung `deliveryBatchId/wmsTransactionId`; mismatch phai
throw.

- [ ] **Step 4: Loai bo truy van tat ca Dot dang cho cua mot PO**

Nhanh V2 trong `materialRequestFulfillmentService` khong duoc:

```ts
.eq('purchase_order_id', input.po.id)
.in('id', transactionIds)
```

Thay bang service Task 5 va key truc tiep:

```ts
await purchaseReceiptService.approveQuality({
  deliveryBatchId: input.deliveryBatch.id,
  wmsTransactionId: input.deliveryBatch.wmsTransactionId,
  actorUserId: input.actorUserId,
  qualityResult: input.qualityResult,
  lines: input.lines,
  attachments: input.attachments,
});
```

Giu legacy branch sau flag cho phieu cu; comment phai ghi ro nhanh nay duoc
go bo sau Gate G4 va neu dieu kien go bo la khong con anomaly legacy.

- [ ] **Step 5: Chay tests**

Run: `npx vitest run lib/__tests__/purchaseReceiptService.test.ts lib/__tests__/materialRequestFulfillmentService.proactiveReceipt.test.ts lib/__tests__/materialRequestFulfillmentService.actualReceipt.test.ts`

Expected: PASS; test phai fail neu code quay lai query theo `purchase_order_id`.

- [ ] **Step 6: Commit**

```bash
git add lib/purchaseReceiptService.ts lib/__tests__/purchaseReceiptService.test.ts lib/materialRequestFulfillmentService.ts lib/__tests__/materialRequestFulfillmentService.proactiveReceipt.test.ts lib/__tests__/materialRequestFulfillmentService.actualReceipt.test.ts lib/materialUnitConversion.ts
git commit -m "fix: scope purchase receipts to one delivery batch"
```

---

### Task 6: Approve Quality and Finalize Stock/MR/Package Atomically

**Files:**
- Create: `supabase/migrations/20260725110000_purchase_receipt_finalize_v2.sql`
- Modify: `supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`
- Modify: `context/AppContext.tsx:1690-2020`
- Modify: `lib/purchaseReceiptService.ts`

**Interfaces:**
- Consumes: interfaces Task 5.
- Produces RPC `approve_receipt_quality_v2` va
  `finalize_purchase_receipt_v2`.

- [ ] **Step 1: Them SQL test RED cho hai moc kho**

Fixture Dot 100, WMS PENDING. Assert:

1. `approve_receipt_quality_v2` voi accepted 90 chuyen WMS APPROVED va Dot
   `quality_approved`.
2. Delivery line co `accepted_qty=90`, stock qty dung snapshot.
3. Goi/WMS/tinh ton chua post tai buoc 1.
4. Goi lai approve voi payload khac bi reject vi chung tu da khoa.
5. `finalize_purchase_receipt_v2` chuyen WMS COMPLETED va Dot
   `received_short`.
6. Retry finalize return `alreadyFinalized=true`, khong tang ton lan hai.

- [ ] **Step 2: Chay SQL test RED**

Run: `npx supabase db query --local -f supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

Expected: FAIL vi hai RPC chua ton tai.

- [ ] **Step 3: Implement `approve_receipt_quality_v2`**

RPC security definer phai khoa Dot va WMS; xac nhan WMS source
`po_delivery_batch/source_id=delivery_batch_id`, actor la Thu kho cua
`target_warehouse_id`, WMS PENDING va Dot `receiving`. Validate JSON line map
1-1 voi delivery line, accepted khong am, stock qty khop conversion snapshot,
va bat buoc reason khi accepted khac planned.

Trong transaction:

```sql
update public.purchase_order_delivery_lines
set accepted_qty = v_accepted_purchase_qty,
    accepted_stock_qty = v_accepted_stock_qty
where id = v_delivery_line_id;

update public.transactions
set items = v_locked_transaction_items,
    attachments = p_attachments,
    status = 'APPROVED'::public.transaction_status,
    approver_id = v_actor_id,
    approved_at = now()
where id = p_wms_transaction_id;

update public.purchase_order_delivery_batches
set status = 'quality_approved',
    quality_result = p_quality_result,
    variance_reason = v_combined_reason,
    quality_approved_by = v_actor_id,
    quality_approved_at = now(),
    accepted_gross_amount = v_gross
where id = p_delivery_batch_id;
```

WMS item luu dong thoi `orderedQty`, `quantity` stock accepted,
`accountingQty` purchase accepted, `accountingPrice`, `varianceQty` va
`varianceReason`.

- [ ] **Step 4: Implement stock/MR/Package trong `finalize_purchase_receipt_v2`**

RPC khoa Dot, WMS, PO va cac MR line lien quan theo thu tu co dinh. No chi
chap nhan `quality_approved` + WMS APPROVED. Neu fulfillment mode la
`RECEIVE_TO_STOCK`, goi private inventory posting logic cua
`process_transaction_status` de tang ton theo `quantity` stock. Neu mode la
`DIRECT_CONSUMPTION`, chuyen WMS sang COMPLETED nhung khong insert inventory
ledger/stock movement. Sau do ca hai mode deu:

- update delivery status bang so accepted so planned;
- update PO `items[].receivedQty` bang `accountingQty`, khong bang stock qty;
- append WMS ID mot lan vao `received_transaction_ids`;
- derive PO status `partial|delivered` tu tong net received;
- update fulfillment/MR received bang don vi nhu cau snapshot;
- set `received_by/received_at`;
- return `ReceiptCommandResult`.

Neu Dot da received va WMS COMPLETED, return ket qua cu. Neu chi mot trong hai
da post, raise `P0001` voi thong diep anomaly va khong tiep tuc.

- [ ] **Step 5: Dung V2 finalize thay cho sync phan tan trong AppContext**

Trong `updateTransactionStatus`, neu transaction source la
`po_delivery_batch` va next status COMPLETED, goi
`purchaseReceiptService.finalize`. Khong condition theo
`relatedRequestId && fulfillmentBatchId`; legacy fulfillment van dung
`sync_fulfillment_receipt_for_transaction`.

- [ ] **Step 6: Chay smoke va regression**

Run: `npx supabase db query --local -f supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

Expected: PASS cac case 100/90, retry va rollback.

Run: `npx vitest run lib/__tests__/purchaseReceiptService.test.ts lib/__tests__/materialRequestFulfillmentService.actualReceipt.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260725110000_purchase_receipt_finalize_v2.sql supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql context/AppContext.tsx lib/purchaseReceiptService.ts
git commit -m "feat: finalize purchase receipts atomically"
```

---

### Task 7: Post Gross Cost and Supplier AP in the Receipt Transaction

**Files:**
- Create: `supabase/migrations/20260725120000_purchase_receipt_finance_v2.sql`
- Modify: `types.ts:2153-2205`
- Modify: `lib/supplierPayableService.ts`
- Modify: `lib/__tests__/supplierPayableService.test.ts`
- Modify: `lib/projectFinanceWorkspaceService.ts:384-410`
- Modify: `pages/project/ProjectFinanceWorkspace.tsx:2770-2830,3110-3220`
- Modify: `supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

**Interfaces:**
- Them `purchase_delivery_receipt` vao `SupplierPayableSourceType`.
- Moi receipt dung:
  - cost `source_ref = purchase_receipt:{delivery_batch_id}`
  - AP `source_type = purchase_delivery_receipt`
  - AP `source_id = delivery_batch_id`

- [ ] **Step 1: Them test RED cho gross receipt va AP aggregation**

Vitest:

```ts
expect(calculateDeliveryReceiptGross({
  vatRate: 10,
  lines: [{ acceptedQty: 90, deliveryUnitPrice: 10_000 }],
})).toBe(990_000);
```

SQL smoke assert sau finalize:

```sql
select amount = 990000
from public.project_transactions
where source_ref = 'purchase_receipt:' || v_batch_id::text;

select recognized_amount = 990000
from public.supplier_payable_documents
where source_type = 'purchase_delivery_receipt'
  and source_id = v_batch_id::text;
```

Retry finalize phai van co count 1 cho ca hai.

Them mot Dot `DIRECT_CONSUMPTION` 90 x 10,000 + VAT 10%. Sau finalize, assert
cost/AP deu 990,000, WMS COMPLETED va khong co inventory ledger entry cua Dot.

- [ ] **Step 2: Chay RED**

Run: `npx vitest run lib/__tests__/supplierPayableService.test.ts`

Expected: FAIL vi gross helper/source moi chua co.

- [ ] **Step 3: Mo rong AP source type**

Migration chay:

```sql
alter table public.supplier_payable_documents
  drop constraint if exists supplier_payable_documents_source_type_check;
alter table public.supplier_payable_documents
  add constraint supplier_payable_documents_source_type_check
  check (source_type in (
    'purchase_order', 'purchase_delivery_receipt', 'site_direct_purchase',
    'supplier_delivery_statement', 'supplier_return_credit',
    'opening_balance', 'manual_adjustment'
  ));
```

Khong tao unique invoice tren AP document vi mot hoa don co the doi soat
nhieu receipt; Task 12 tao invoice header va bang link many-to-many.

- [ ] **Step 4: Post cost va AP o cuoi `finalize_purchase_receipt_v2`**

Migration `20260725120000_purchase_receipt_finance_v2.sql` tao lai
`finalize_purchase_receipt_v2` tu Task 6, giu nguyen stock/MR/package logic va
them finance posting truoc khi return. Trong cung SQL transaction sau
inventory/MR updates:

```sql
insert into public.project_transactions (
  id, "projectFinanceId", "constructionSiteId",
  project_id, project_finance_id, construction_site_id,
  type, category, amount, description, date, source,
  "sourceRef", source_ref, contract_cost_item_id,
  cost_classification_status, counterparty_partner_id,
  counterparty_name, attachments, "createdBy", "createdAt"
)
values (
  'purchase-receipt-' || p_delivery_batch_id::text,
  coalesce(v_project_finance_id, ''),
  coalesce(v_po.construction_site_id, ''),
  v_po.project_id, nullif(v_project_finance_id, ''),
  v_po.construction_site_id, 'expense', 'materials',
  v_received_gross, v_description, current_date::text, 'workflow',
  'purchase_receipt:' || p_delivery_batch_id::text,
  'purchase_receipt:' || p_delivery_batch_id::text,
  v_contract_cost_item_id, v_cost_classification_status,
  v_supplier_partner_id, v_batch.supplier_name_snapshot,
  v_tx.attachments, v_actor_id::text, now()
)
on conflict (source_ref) do nothing;
```

Upsert AP theo `(source_type, source_id)` voi committed = planned gross,
recognized = accepted gross, supplier snapshot tu Dot, QR rieng cua AP va
metadata chua PO/MR/WMS IDs. Neu insert conflict, chi cho phep return row co
cung recognized amount; mismatch raise anomaly, khong silently overwrite
chung tu da thanh toan.

Ca `RECEIVE_TO_STOCK` va `DIRECT_CONSUMPTION` dung cung finance posting; mode
chi quyet dinh co inventory movement hay khong.

Neu accepted gross bang 0 do toan bo hang bi reject tai Duyet SL/CL, khong
insert cost/AP; finalize van dong Dot thieu va giu remaining need.

Neu MR line co nhieu `contract_cost_item_id`, tao mot cost transaction moi
cost item voi source ref suffix line ID; AP van la mot document tong Dot.

- [ ] **Step 5: Bo payment-as-expense va PO fallback**

Tao lai `post_supplier_payment_batch` va `reverse_supplier_payment_batch` de
cap nhat batch/allocation/AP status nhung khong insert
`project_transactions` expense. Set `project_transaction_id = null`; dong
tien/chi tien duoc truy vet bang payment batch va cash voucher hien huu.

Trong `projectFinanceWorkspaceService.buildPayables`, luon dung
`supplierPayableBalances`; khong fallback tu `purchase_orders` khi AP list
rong. Trong `ProjectFinanceWorkspace`, bo
`syncPurchaseOrderById` va nhanh tao `nextTransaction` expense; payment form
chi tai AP documents cua NCC va post `supplierPaymentBatchService`.

- [ ] **Step 6: Chay test**

Run: `npx vitest run lib/__tests__/supplierPayableService.test.ts lib/__tests__/supplierPaymentBatchService.test.ts`

Expected: PASS; payment allocation van dung, khong ky vong expense payment.

Run: `npx supabase db query --local -f supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

Expected: PASS; receipt co mot cost/AP, payment khong tang tong expense.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260725120000_purchase_receipt_finance_v2.sql supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql types.ts lib/supplierPayableService.ts lib/__tests__/supplierPayableService.test.ts lib/projectFinanceWorkspaceService.ts pages/project/ProjectFinanceWorkspace.tsx
git commit -m "feat: recognize receipt cost and supplier payable"
```

---

### Task 8: Reverse Stock, Gross Cost, and AP on Post-Receipt Returns

**Files:**
- Create: `supabase/migrations/20260725123000_purchase_receipt_return_finance_v2.sql`
- Modify: `supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`
- Modify: `lib/supplierReturnService.ts`
- Modify: `lib/__tests__/supplierReturnService.test.ts`

**Interfaces:**
- Consumes: supplier return flow hien huu va receipt AP source Task 7.
- Produces: idempotent reversal refs:
  - `purchase_receipt_return:{supplier_return_id}`
  - AP/credit source `supplier_return_credit`.

- [ ] **Step 1: Them test RED**

SQL fixture finalize 90, sau do return 10. Assert:

- stock net +80;
- cost co +990,000 va reversal -110,000;
- AP recognized 990,000 va credit 110,000;
- PO/Goi net received 80;
- retry return khong tao reversal thu hai.

- [ ] **Step 2: Chay RED**

Run: `npx supabase db query --local -f supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

Expected: FAIL o cost/AP reversal.

- [ ] **Step 3: Mo rong completion command cua supplier return**

Trong transaction hoan NCC hien huu, sau inventory reversal:

```sql
insert into public.project_transactions (
  id, "projectFinanceId", "constructionSiteId",
  project_id, project_finance_id, construction_site_id,
  type, category, amount, description, date, source,
  "sourceRef", source_ref, attachments, "createdBy", "createdAt"
)
values (
  'purchase-return-cost-' || v_return.id::text,
  coalesce(v_project_finance_id, ''),
  coalesce(v_po.construction_site_id, ''),
  v_po.project_id, nullif(v_project_finance_id, ''),
  v_po.construction_site_id, 'expense', 'materials',
  -v_return_gross, v_description, current_date::text, 'workflow',
  'purchase_receipt_return:' || v_return.id::text,
  'purchase_receipt_return:' || v_return.id::text,
  '[]'::jsonb, v_actor_id::text, now()
)
on conflict (source_ref) do nothing;
```

Upsert `supplier_return_credit` document hoac tang `credit_amount` tren AP
receipt bang mot source idempotent. Khong cho total returned cua delivery line
vuot accepted qty.

- [ ] **Step 4: Chay tests**

Run: `npx vitest run lib/__tests__/supplierReturnService.test.ts`

Expected: PASS.

Run: `npx supabase db query --local -f supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

Expected: PASS tat ca receipt/return cases.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260725123000_purchase_receipt_return_finance_v2.sql supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql lib/supplierReturnService.ts lib/__tests__/supplierReturnService.test.ts
git commit -m "feat: reverse receipt cost and payable on returns"
```

---

### Task 9: Replace the PO Form with the Default Package Flow

**Files:**
- Create: `components/project/PurchaseModeControl.tsx`
- Create: `components/project/PurchasePackageSummary.tsx`
- Create: `components/project/PurchaseDeliveryBatchEditor.tsx`
- Modify: `pages/project/SupplyChainTab.tsx:825-1035,2868-3655,8473-8805`
- Modify: `lib/purchaseOrderDeliveryDraft.ts`
- Modify: `lib/purchaseOrderReleaseApproval.ts`
- Modify: `lib/__tests__/purchaseOrderDeliveryDraft.test.ts`
- Modify: `lib/__tests__/purchaseOrderReleaseApproval.test.ts`

**Interfaces:**
- `PurchaseModeControl`:

```ts
interface PurchaseModeControlProps {
  value: PurchaseMode;
  disabled?: boolean;
  onChange(value: PurchaseMode): void;
}
```

- `PurchaseDeliveryBatchEditor` submit dung
  `purchasePackageService.createDelivery`.

- [ ] **Step 1: Viet failing unit tests cho form policy**

```ts
expect(getDefaultPurchaseMode('from_request')).toBe('single');
expect(shouldCreateBatchDuringDraftSave('single')).toBe(false);
expect(shouldCreateBatchDuringDraftSave('multiple')).toBe(false);
expect(shouldAutoCreateBatchOnApproval('single')).toBe(true);
expect(shouldAutoCreateBatchOnApproval('multiple')).toBe(false);
expect(getVarianceSeverity(10)).toBe('warning');
```

Them regression MR-2026-9753: Goi draft 7,000 Kg, zero batches, gia 39.2 trieu
khong co supplemental request va nut Gui duyet duoc phep khi workflow target
hop le.

- [ ] **Step 2: Chay RED**

Run: `npx vitest run lib/__tests__/purchaseOrderDeliveryDraft.test.ts lib/__tests__/purchaseOrderReleaseApproval.test.ts`

Expected: FAIL o policy flow cu.

- [ ] **Step 3: Tao controls va cap nhat form Goi**

`PurchaseModeControl` dung segmented buttons:

```tsx
<div role="group" aria-label="Cach dat hang" className="inline-flex rounded-md border border-slate-200 p-1">
  <button type="button" aria-pressed={value === 'single'} onClick={() => onChange('single')}>
    Mua va giao mot lan
  </button>
  <button type="button" aria-pressed={value === 'multiple'} onClick={() => onChange('multiple')}>
    Chia nhieu dot
  </button>
</div>
```

Form Goi tu MR:

- giu qty/price/VAT baseline trong PO items va `referenceGrossAmount`;
- snapshot `fulfillmentMode` tu MR; hien read-only `Nhap kho cong truong`
  hoac `Giao thang su dung`;
- mac dinh `purchaseMode='single'`;
- khong tao schedule trong draft;
- khong sync qty PO tu schedule;
- khong hien schedule editor trong form Goi;
- copy label tren UI thanh `Goi mua hang` voi PO number giu nguyen;
- chenh released/reference hien banner canh bao, khong disable Save/Submit.

Chi ap dung semantic V2 khi
`isPurchasePackageV2EnabledForSite(po.constructionSiteId)` va
`sourceMode='from_request'`; cac PO proactive/company giu UI cu trong gate
nay.

- [ ] **Step 4: Tao editor Dot rieng**

Editor hien sau khi Goi confirmed. `single` co Dot auto tao; `multiple` co nut
`Them dot giao`. Fields: NCC, qty tung line, don gia, VAT, kho/diem nhan,
ngay tuy chon, ghi chu. Fulfillment mode ke thua Goi va khong doi sau khi tao
Dot. Nut luu tao mot UUID idempotency key va giu nguyen key khi retry.

Nut `Sao chep dot truoc` chi copy NCC, price, VAT, warehouse va note; quantity
mac dinh la `remainingNeedQty` nhung cho sua vuot. Save success mo QR/trace cua
Dot ma khong co nut Tao WMS. Sua Dot truoc Duyet SL/CL goi
`updateUnreceivedDelivery`, khong replace/delete cac row.

- [ ] **Step 5: Bo supplemental blocking trong V2**

`purchaseOrderReleaseApproval` van tinh `releasedGrossVariance` de hien
warning, nhung V2 khong tao `PurchaseOrderSupplementalDraft`, khong mo modal
chon nguoi duyet va khong set `supplemental_pending`.

- [ ] **Step 6: Chay tests va build**

Run: `npx vitest run lib/__tests__/purchaseOrderDeliveryDraft.test.ts lib/__tests__/purchaseOrderReleaseApproval.test.ts lib/__tests__/purchasePackageDomain.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: Vite build thanh cong.

- [ ] **Step 7: Commit**

```bash
git add components/project/PurchaseModeControl.tsx components/project/PurchasePackageSummary.tsx components/project/PurchaseDeliveryBatchEditor.tsx pages/project/SupplyChainTab.tsx lib/purchaseOrderDeliveryDraft.ts lib/purchaseOrderReleaseApproval.ts lib/__tests__/purchaseOrderDeliveryDraft.test.ts lib/__tests__/purchaseOrderReleaseApproval.test.ts
git commit -m "feat: add streamlined purchase package form"
```

---

### Task 10: Simplify the Package Cockpit and Action Policy

**Files:**
- Create: `supabase/migrations/20260725125000_purchase_package_close_short_v2.sql`
- Modify: `components/project/PurchaseOrderCockpitDrawer.tsx:130-180,300-350,630-760`
- Modify: `components/RequestModal.tsx`
- Modify: `lib/purchaseOrderUiPolicy.ts`
- Modify: `lib/purchasePackageService.ts`
- Modify: `lib/__tests__/purchaseOrderUiPolicy.test.ts`
- Modify: `pages/project/SupplyChainTab.tsx:5240-5370,6450-6680`

**Interfaces:**
- Produces action IDs V2:
  `submit_package`, `approve_package`, `add_delivery`,
  `clone_delivery`, `cancel_delivery`, `open_delivery_qr`,
  `close_short`.
- Produces:

```ts
closePackageShort(input: {
  purchaseOrderId: string;
  actorUserId: string;
  reason: string;
  lines: Array<{ purchaseOrderLineId: string; closeQty: number }>;
}): Promise<void>;
```

- [ ] **Step 1: Viet action policy test RED**

```ts
expect(getPurchasePackageActions(singleApprovedWithBatch).map(item => item.id))
  .toEqual(['open_delivery_qr']);
expect(getPurchasePackageActions(multipleApprovedNoBatch).map(item => item.id))
  .toContain('add_delivery');
expect(getPurchasePackageActions(overReleasedPackage).map(item => item.id))
  .not.toContain('approve_supplemental');
expect(getPurchasePackageActions(receivedPackage).map(item => item.id))
  .not.toContain('create_payable');
expect(getPurchasePackageActions(shortPackageWithoutOpenDelivery).map(item => item.id))
  .toContain('close_short');
```

- [ ] **Step 2: Chay RED**

Run: `npx vitest run lib/__tests__/purchaseOrderUiPolicy.test.ts`

Expected: FAIL vi actions cu van co supplemental/WMS/AP.

- [ ] **Step 3: Cap nhat cockpit**

Header hien:

- Gia tri chu truong gom VAT;
- Tong cac Dot;
- Da nhan gom VAT;
- Nhu cau goc / da nhan rong / con thieu hoac du.

Moi Dot la mot row phang, khong card long card. Row co ma `POxx-01`, NCC,
qty/value, receipt variance, status, QR action. Bo `Tao WMS`, `Tao QR`, `Tao
cong no NCC`, `Duyet bo sung`, `Tu choi bo sung`.

Warnings dung tone amber va copy `Vuot moc tham chieu`, khong dung copy loi
`Gia tri cac dot dang vuot tong da duyet`.

- [ ] **Step 4: Cap nhat dispatcher**

Moi action goi service Task 3/4; `open_delivery_qr` dung token Dot;
`cancel_delivery` bat buoc reason va goi atomic cancel. Legacy action dispatcher
chi giu khi flag tat.

- [ ] **Step 5: Implement ket thuc thieu va man theo doi cua cong truong**

Migration tao `close_purchase_package_short_v2`. RPC khoa Goi/MR, chi cho Bo
phan mua hang, bat buoc reason, close qty duong va khong vuot remaining need
tung line. No insert `material_request_line_need_closures` theo PO/MR line,
cap nhat `purchase_orders.closed_need_qty`, audit actor/reason va derive Goi
`closed_short`; khong sua baseline MR/Goi va khong tao cost/AP.

`close_short` mo modal reason + line quantities va goi
`purchasePackageService.closePackageShort`.

Trong `RequestModal`, phan mac dinh cho cong truong chi hien Nhu cau goc, Da
thuc nhan rong, Con thieu/Du va Lan nhan gan nhat. Doi nhan thao tac cu thanh
`Cho mua/cap hang`; an gia, lich Dot va AP khoi view mac dinh. Chi tiet
procurement van nam trong Supply Chain cho nguoi co quyen.

- [ ] **Step 6: Chay test va build**

Run: `npx vitest run lib/__tests__/purchaseOrderUiPolicy.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260725125000_purchase_package_close_short_v2.sql components/project/PurchaseOrderCockpitDrawer.tsx components/RequestModal.tsx lib/purchaseOrderUiPolicy.ts lib/purchasePackageService.ts lib/__tests__/purchaseOrderUiPolicy.test.ts pages/project/SupplyChainTab.tsx
git commit -m "feat: simplify purchase package cockpit"
```

---

### Task 11: Route QR to One Delivery and Keep Both Warehouse Steps Open

**Files:**
- Create: `lib/purchaseDeliveryQr.ts`
- Create: `lib/purchaseReceiptWorkflow.ts`
- Create: `lib/__tests__/purchaseReceiptWorkflow.test.ts`
- Modify: `pages/Inventory.tsx:90-225,630-685`
- Modify: `components/ReceivePurchaseOrderModal.tsx`
- Modify: `components/TransactionDetailModal.tsx:25-220`
- Modify: `lib/wmsPermissions.ts`

**Interfaces:**
- QR:

```ts
export const PURCHASE_DELIVERY_QR_PARAM = 'deliveryToken';
export const buildPurchaseDeliveryReceiveUrl: (token: string) => string;
export const extractPurchaseDeliveryToken: (raw: string) => string | null;
```

- Workflow:

```ts
export type PurchaseReceiptStep = 'quality' | 'confirm' | 'completed';
export const getPurchaseReceiptStep: (
  status: TransactionStatus,
  sourceType?: string | null,
) => PurchaseReceiptStep;
```

- [ ] **Step 1: Viet state-machine va QR tests RED**

```ts
expect(getPurchaseReceiptStep(TransactionStatus.PENDING, 'po_delivery_batch'))
  .toBe('quality');
expect(getPurchaseReceiptStep(TransactionStatus.APPROVED, 'po_delivery_batch'))
  .toBe('confirm');
expect(getPurchaseReceiptStep(TransactionStatus.COMPLETED, 'po_delivery_batch'))
  .toBe('completed');
expect(extractPurchaseDeliveryToken(
  'https://vioo.vn/#/inventory?deliveryToken=pod_123',
)).toBe('pod_123');
```

- [ ] **Step 2: Chay RED**

Run: `npx vitest run lib/__tests__/purchaseReceiptWorkflow.test.ts`

Expected: FAIL vi files chua ton tai.

- [ ] **Step 3: Scan QR theo Dot**

`Inventory.loadDocumentFromQr` uu tien `deliveryToken`, goi
`purchasePackageService.getDeliveryByQrToken`, validate kho va status, sau do
mo WMS transaction cua dung Dot. Khong lookup `poService.getByQrToken` cho V2.
Giu `poToken` legacy khi flag tat hoac QR cu.

State modal phai la:

```ts
const [receivingDelivery, setReceivingDelivery] =
  useState<PurchaseOrderDeliveryBatch | null>(null);
const [receivingTransaction, setReceivingTransaction] =
  useState<Transaction | null>(null);
```

- [ ] **Step 4: Chuyen modal nhan tu PO sang Dot**

`ReceivePurchaseOrderModal` nhan `po`, `deliveryBatch`, `transaction`; defaults
lay tu `deliveryBatch.lines[].plannedQty`, khong lay
`po.items[].qty - receivedQty`. Submit goi `approveQuality` cho dung Dot. Voi
100 giao, 90 dat, user nhap accepted 90 va reason; khong tao return.
Cho accepted 0 khi `qualityResult='rejected'`; finalize dong Dot
`received_short`, khong tao inventory/cost/AP va de remaining need mo cho Dot
tiep theo.

- [ ] **Step 5: Giu `TransactionDetailModal` mo sau Duyet SL/CL**

Sau `approveQuality`:

```ts
const refreshed = await refreshTransaction(latestTransaction.id);
onUpdated?.(refreshed);
setQuantityDrafts(buildLockedQuantityDrafts(refreshed));
toast.success('Da duyet SL/CL', 'So lieu da khoa. Xac nhan nhap kho de hoan tat.');
return;
```

Khong goi `onClose()` o quality step. Render tom tat read-only va nut `Xac
nhan nhap kho` ngay trong modal. Chi cho edit quantity/attachments khi
PENDING; khi APPROVED, `canAdjustQuantities=false`. Confirm goi
`purchaseReceiptService.finalize`, refresh va dong modal sau success.

`wmsPermissions` cho cung Thu kho duoc ca approve va receive neu assigned
warehouse trung target. Bo yeu cau actor khac giua hai buoc.

- [ ] **Step 6: Chay unit test, build va visual check**

Run: `npx vitest run lib/__tests__/purchaseReceiptWorkflow.test.ts lib/__tests__/purchaseReceiptService.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Khoi dong: `npm run dev -- --host 127.0.0.1`

Kiem tra desktop 1440x900 va mobile 390x844:

- QR Dot mo dung `POxx-yy`;
- quantity/reason khong tran container;
- sau Duyet SL/CL modal khong dong;
- summary khoa va nut Xac nhan nhap hien cung viewport;
- confirm chi post mot lan khi double click.

- [ ] **Step 7: Commit**

```bash
git add lib/purchaseDeliveryQr.ts lib/purchaseReceiptWorkflow.ts lib/__tests__/purchaseReceiptWorkflow.test.ts pages/Inventory.tsx components/ReceivePurchaseOrderModal.tsx components/TransactionDetailModal.tsx lib/wmsPermissions.ts
git commit -m "feat: keep purchase receipt steps in one screen"
```

---

### Task 12: Complete Invoice Reconciliation and Document Trace

**Files:**
- Create: `supabase/migrations/20260725124000_supplier_invoice_reconciliation_v2.sql`
- Modify: `types.ts`
- Modify: `lib/documentTraceService.ts`
- Modify: `pages/DocumentTracePage.tsx`
- Modify: `lib/supplierPayableService.ts`
- Modify: `pages/project/ProjectFinanceWorkspace.tsx`
- Modify: `lib/__tests__/supplierPayableService.test.ts`
- Modify: `supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

**Interfaces:**
- Produces:

```ts
export interface SupplierInvoice {
  id: string;
  supplierId: string;
  supplierNameSnapshot: string;
  invoiceNumber: string;
  invoiceDate: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  varianceReason?: string | null;
  attachments: Attachment[];
}

export interface SupplierInvoicePayableLink {
  invoiceId: string;
  payableDocumentId: string;
  allocatedGrossAmount: number;
}
```

- [ ] **Step 1: Viet failing tests cho invoice many-to-many va variance**

```ts
expect(buildInvoiceReconciliation({
  linkedPayablesGross: 990_000,
  invoiceGross: 1_000_000,
})).toEqual({
  varianceAmount: 10_000,
  hasVariance: true,
});

expect(validateSupplierInvoiceLinks({
  supplierId: 'vendor-1',
  grossAmount: 1_000_000,
  links: [
    { payableSupplierId: 'vendor-1', allocatedGrossAmount: 600_000 },
    { payableSupplierId: 'vendor-1', allocatedGrossAmount: 400_000 },
  ],
})).toEqual({ allocatedGrossAmount: 1_000_000 });
```

Service phai map duplicate index `uq_supplier_invoice_header_number` thanh loi
`So hoa don da ton tai cho NCC nay.`

- [ ] **Step 2: Chay RED**

Run: `npx vitest run lib/__tests__/supplierPayableService.test.ts`

Expected: FAIL o reconciliation helper.

- [ ] **Step 3: Tao invoice header va link table**

Migration tao:

```sql
create table public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id text not null,
  supplier_name_snapshot text not null,
  invoice_number text not null,
  invoice_date date not null,
  net_amount numeric not null check (net_amount >= 0),
  vat_amount numeric not null check (vat_amount >= 0),
  gross_amount numeric not null check (gross_amount >= 0),
  variance_reason text,
  attachments jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_supplier_invoice_header_number
  on public.supplier_invoices(supplier_id, lower(trim(invoice_number)));

create table public.supplier_invoice_payable_links (
  invoice_id uuid not null references public.supplier_invoices(id) on delete cascade,
  payable_document_id uuid not null references public.supplier_payable_documents(id) on delete restrict,
  allocated_gross_amount numeric not null check (allocated_gross_amount > 0),
  created_at timestamptz not null default now(),
  primary key (invoice_id, payable_document_id)
);
```

Them RLS cung scope AP, audit trigger va trace hooks. Khong backfill
`invoice_number` legacy tu AP neu trung; anomaly view Task 13 bao cao de ke
toan doi soat.

- [ ] **Step 4: Tao atomic invoice reconciliation command**

`record_supplier_invoice_reconciliation_v2(p_invoice jsonb, p_links jsonb,
p_actor_user_id uuid)` phai khoa tat ca AP link, xac nhan cung supplier, tong
allocation bang invoice gross va moi allocation duong. Allocation co the lech
recognized hien tai; phan lech chinh la adjustment duoc post trong command.
Ke toan nhap invoice number/date, net, VAT, gross, attachments va links toi
mot hoac nhieu receipt AP.

Neu invoice gross chenh tong estimated gross cua cac AP, bat buoc reason. Save
khong sua WMS/accepted qty; no tao mot adjustment cost va AP source:

```text
supplier_invoice_adjustment:{invoice_id}
```

Adjustment duong/am cap nhat cost va recognized AP idempotently, phan bo theo
ty le `allocated_gross_amount`. Invoice number duoc normalize `trim/lower`
cho uniqueness theo NCC.

- [ ] **Step 5: Mo rong trace**

Trace chain phai truy duoc:

```text
MR -> Goi -> Dot -> WMS -> Cost/AP -> Payment
                         -> Supplier invoice
```

va return:

```text
WMS receipt -> Supplier return -> Cost reversal/AP credit
```

`DocumentTracePage` hien QR Dot thay QR PO cho V2 va link nguoc ve cockpit Goi.

- [ ] **Step 6: Chay tests va build**

Run: `npx vitest run lib/__tests__/supplierPayableService.test.ts && npm run build`

Expected: PASS.

Run: `npx supabase db query --local -f supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

Expected: mot invoice link duoc hai receipt AP cung NCC; duplicate invoice
number cung NCC bi reject; invoice number giong nhau khac NCC luu duoc.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260725124000_supplier_invoice_reconciliation_v2.sql supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql types.ts lib/documentTraceService.ts pages/DocumentTracePage.tsx lib/supplierPayableService.ts pages/project/ProjectFinanceWorkspace.tsx lib/__tests__/supplierPayableService.test.ts
git commit -m "feat: reconcile receipt invoices and extend trace"
```

---

### Task 13: Audit Legacy Data Without Creating Business Documents

**Files:**
- Create: `supabase/migrations/20260725130000_purchase_package_legacy_audit_v2.sql`
- Create: `docs/runbooks/purchase-package-v2-rollout.md`
- Modify: `supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

**Interfaces:**
- Produces read-only view `purchase_package_v2_anomalies` voi columns:

```text
anomaly_type, purchase_order_id, delivery_batch_id, wms_transaction_id,
project_id, construction_site_id, details, detected_at
```

- [ ] **Step 1: Viet schema smoke RED**

```sql
if to_regclass('public.purchase_package_v2_anomalies') is null then
  raise exception 'Missing purchase package anomaly view';
end if;
```

- [ ] **Step 2: Chay RED**

Run: `npx supabase db query --local -f supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

Expected: FAIL vi view chua ton tai.

- [ ] **Step 3: Tao read-only anomaly view**

View union cac loai:

- `completed_wms_batch_not_received`;
- `received_batch_wms_not_completed`;
- `multiple_active_wms_for_batch`;
- `po_received_without_payable`;
- `po_received_without_cost`;
- `payment_expense_duplicate_risk`;
- `purchase_stock_unit_mismatch`;
- `legacy_delivery_group_only`.

Migration chi create view/index/helper read-only. Khong update/insert Goi, Dot,
WMS, cost hoac AP.

- [ ] **Step 4: Viet rollout runbook**

Runbook co lenh:

```bash
npm run lint
npm test
npm run build
npx supabase db query --linked --agent=no -f supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql
```

Va SQL preflight cho MR-2026-9753/Bui Quang Chung:

```sql
select r.id, r.code, r.status, r.requester_id,
       u.name as requester_name,
       r.submitted_to_user_id, r.submitted_to_permission
from public.requests r
left join public.users u on u.id = r.requester_id
where r.code = 'MR-2026-9753';

select po.id, po.po_number, po.status, po.purchase_mode,
       po.reference_gross_amount,
       count(batch.id) as delivery_count
from public.purchase_orders po
left join public.purchase_order_delivery_batches batch
  on batch.purchase_order_id = po.id
where po.material_request_id = (
  select id from public.requests where code = 'MR-2026-9753'
)
group by po.id;

select * from public.purchase_package_v2_anomalies
where purchase_order_id in (
  select id from public.purchase_orders
  where material_request_id = (
    select id from public.requests where code = 'MR-2026-9753'
  )
);

select supplier_id, lower(trim(invoice_number)) as normalized_invoice_number,
       count(*) as duplicate_count
from public.supplier_payable_documents
where nullif(trim(invoice_number), '') is not null
  and status not in ('cancelled', 'reversed')
group by supplier_id, lower(trim(invoice_number))
having count(*) > 1;
```

Runbook quy dinh: neu Room approver mapping sai thi sua mapping workflow rieng;
khong sua qty/Goi de “het vuot”. Sau deploy, nguoi tao MR gui duyet theo
workflow hien huu; Goi lan dau phai hien released = 0.

- [ ] **Step 5: Chay smoke**

Run: `npx supabase db query --local -f supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`

Expected: PASS va view khong co side effect.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260725130000_purchase_package_legacy_audit_v2.sql supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql docs/runbooks/purchase-package-v2-rollout.md
git commit -m "chore: add purchase package rollout audit"
```

---

### Task 14: Run the Full Acceptance Matrix and Enable the Pilot

**Files:**
- Modify: `supabase/tests/company_procurement_flow_smoke.sql`
- Modify: `supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql`
- Modify: `docs/runbooks/purchase-package-v2-rollout.md`
- Modify: deployment environment only after all checks pass:
  `VITE_ENABLE_PURCHASE_PACKAGE_V2=true`
  and `VITE_PURCHASE_PACKAGE_V2_SITE_IDS=<pilot-construction-site-id>`

**Interfaces:**
- No new runtime interface.
- Produces signed-off evidence for all 15 acceptance criteria in the design.

- [ ] **Step 1: Mo rong end-to-end smoke matrix**

Them fixtures/assertions doc lap:

1. MR 1,000 -> Goi 1,000 -> one approval.
2. `single` auto `-01` + WMS + QR.
3. `multiple` zero auto batch.
4. Dot co price/VAT khac baseline, zero supplemental approval.
5. 500 + 510 luu thanh cong, warning projection +10.
6. QR batch 1 khong cham batch 2.
7. PENDING -> APPROVED -> COMPLETED boi cung warehouse keeper.
8. 100/90 chi stock/cost/AP 90, zero return request; 100/0 rejected co zero
   stock/cost/AP.
9. Giao thang post cost/AP gom VAT nhung zero inventory movement; finalize
   retry khong duplicate stock/cost/AP.
10. Nhieu receipt cung NCC aggregate va allocate mot/nhieu payment.
11. Payment khong tang material expense.
12. Post-receipt return dao stock/cost/AP.
13. Cay/Cuon -> Kg va decimal dung snapshot.
14. Concurrent create/finalize chi mot ket qua.
15. Legacy migration khong tao business row.

- [ ] **Step 2: Chay targeted tests**

Run:

```bash
npx vitest run \
  lib/__tests__/purchasePackageDomain.test.ts \
  lib/__tests__/purchasePackageService.test.ts \
  lib/__tests__/purchaseReceiptService.test.ts \
  lib/__tests__/purchaseReceiptWorkflow.test.ts \
  lib/__tests__/purchaseOrderDeliveryDraft.test.ts \
  lib/__tests__/purchaseOrderReleaseApproval.test.ts \
  lib/__tests__/purchaseOrderUiPolicy.test.ts \
  lib/__tests__/supplierPayableService.test.ts \
  lib/__tests__/supplierPaymentBatchService.test.ts \
  lib/__tests__/supplierReturnService.test.ts
```

Expected: tat ca PASS, zero skipped test trong nhom V2.

- [ ] **Step 3: Chay database tests**

Run:

```bash
npx supabase db reset
npx supabase db query --local -f supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql
npx supabase db query --local -f supabase/tests/company_procurement_flow_smoke.sql
```

Expected: migration chain va ca hai smoke file PASS.

- [ ] **Step 4: Chay full verification**

Run:

```bash
npm run lint
npm test
npm run build
git diff --check
```

Expected: TypeScript, toan bo Vitest, Vite build va whitespace check deu PASS.

- [ ] **Step 5: UAT tren staging**

Dung user procurement, leader va warehouse keeper that:

- tao Goi tu MR test;
- duyet `single` va quet QR vua sinh;
- Duyet SL/CL 90/100, modal van mo;
- Xac nhan nhap, doi chieu stock/cost/AP;
- tao Goi `multiple`, hai Dot 500 va 510 voi gia khac nhau;
- thanh toan chung hai AP receipt cua cung NCC;
- return sau receipt va doi chieu ba reversal.

Chup evidence ma chung tu va so tien vao release record, khong dung du lieu
production.

- [ ] **Step 6: Pilot theo mot cong trinh**

Deploy migrations truoc. Deploy frontend voi flag tat de kiem tra khong
regression. Sau khi anomaly query cua cong trinh pilot khong co blocker, set
`VITE_ENABLE_PURCHASE_PACKAGE_V2=true` va
`VITE_PURCHASE_PACKAGE_V2_SITE_IDS=<pilot-construction-site-id>` cho build
pilot, sau do theo doi 24 gio:

- command error rate;
- duplicate key attempts;
- anomaly view;
- receipt count so voi cost/AP count;
- support feedback cua mua hang va Thu kho.

Neu rollback UI, set flag ve false va redeploy frontend; khong rollback
migration va khong xoa chung tu da post.

- [ ] **Step 7: Mo rong rollout**

Sau pilot, them tung construction site ID vao allowlist. Khi tat ca Goi dang
mo da dung Dot V2, xoa allowlist de flag ap dung toan bo, ngung ghi legacy
delivery groups nhung giu read/trace. Ghi ngay bat va nguoi phe duyet rollout
trong runbook.

- [ ] **Step 8: Commit verification updates**

```bash
git add supabase/tests/company_procurement_flow_smoke.sql supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql docs/runbooks/purchase-package-v2-rollout.md
git commit -m "test: cover purchase package receipt lifecycle"
```

---

## Review Checkpoints

1. Sau Task 4: demo Goi `single`/`multiple`, chua bat production flag.
2. Sau Task 6: review database atomicity, lock order, conversion va
   idempotency voi mot reviewer backend.
3. Sau Task 8: doi chieu ke toan bang bang mau receipt/payment/return.
4. Sau Task 11: demo cung Thu kho thao tac hai buoc tren desktop va mobile.
5. Sau Task 14: anh duyet pilot truoc khi mo rong.

## Completion Definition

Ke hoach chi duoc coi la hoan tat khi:

- 15 tieu chi nghiem thu trong design deu co automated evidence hoac UAT
  evidence duoc ghi ro;
- MR-2026-9753 khong con hien “da lap lich 7,000, con 0” khi chua co Dot va
  nguoi tao gui duyet duoc neu Room approver mapping hop le;
- moi Dot co dung mot WMS/QR va receipt chi tac dong Dot do;
- stock, MR, Goi, cost gom VAT va AP commit/rollback cung nhau;
- payment khong tao expense vat tu;
- anomaly view cua pham vi pilot khong co blocker;
- rollback frontend khong lam mat du lieu da post.
