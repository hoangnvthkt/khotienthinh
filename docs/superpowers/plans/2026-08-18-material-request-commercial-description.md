# Material Request Commercial Description Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Workspace instructions prohibit sub-agents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép nhiều dòng MR/PO cùng mã vật tư có tên và quy cách riêng, kể cả khi nhập MR từ Excel, trong khi tồn kho vẫn quản lý duy nhất theo `itemId`.

**Architecture:** Giữ `items.id`/SKU/đơn vị tồn kho làm danh tính chuẩn và dùng `lineId` làm danh tính dòng chứng từ. Chuẩn hóa cách resolve tên/quy cách bằng helper thuần, lưu snapshot trên từng dòng JSONB, rồi nối helper này vào MR thủ công, import Excel, tạo PO, bản in và màn hình giao nhận. Không tạo SKU con và không migration database.

**Tech Stack:** React 18, TypeScript 5.8, Vite 6, Vitest 4, SheetJS `xlsx`, Supabase Cloud hiện có.

**Spec:** `docs/superpowers/specs/2026-08-18-material-request-commercial-description-design.md`

## Global Constraints

- Không dùng Supabase local hoặc Docker; mọi kiểm tra Supabase chỉ dùng Cloud đã cấu hình trong `.env`.
- Không tạo bảng vật tư cha–con, SKU biến thể hoặc thay đổi `public.items`.
- `itemId` và SKU là danh tính tồn kho; `lineId` là danh tính dòng MR/PO.
- Không gộp dòng chứng từ chỉ vì trùng `itemId` hoặc SKU.
- Tên/quy cách trên MR hoặc PO không cập nhật ngược `items.name`.
- SKU và đơn vị tồn kho không được sửa tự do cùng tên/quy cách.
- PO kế thừa snapshot MR nhưng chỉnh sửa PO không được thay đổi MR gốc.
- Dữ liệu cũ thiếu snapshot phải fallback an toàn về `name` hoặc tên danh mục.
- Không thêm dependency mới.

---

## File structure

- Create `lib/materialLineDescription.ts`: chính sách thuần cho tên, quy cách và khóa dòng chứng từ.
- Create `lib/__tests__/materialLineDescription.test.ts`: kiểm thử chính sách snapshot và line identity.
- Modify `lib/materialRequestImportService.ts`: ánh xạ cột quy cách, parse Excel và dựng `RequestItem` đầy đủ snapshot.
- Create `lib/__tests__/materialRequestImportService.test.ts`: kiểm thử file Excel có cùng mã nhưng nhiều tên/quy cách.
- Modify `components/project/material/MaterialRequestTab.tsx`: dùng builder import thay vì dựng thiếu snapshot.
- Modify `components/project/material/MaterialRequestImportPreviewModal.tsx`: hiển thị tên Excel, quy cách và vật tư danh mục đã match.
- Create `components/material/MaterialCommercialDescriptionFields.tsx`: cặp input tên/quy cách dùng chung cho MR và PO.
- Modify `components/RequestModal.tsx`: cho sửa snapshot, không nhóm dòng theo SKU và ưu tiên snapshot khi hiển thị/in.
- Create `lib/__tests__/materialCommercialDescriptionUiContract.test.ts`: kiểm tra wiring MR/import/PO ở các component lớn.
- Modify `lib/purchaseOrderRequestCart.ts`: kế thừa đúng snapshot MR khi tạo PO.
- Modify `lib/__tests__/purchaseOrderRequestCart.test.ts`: kiểm thử tên/quy cách MR khác danh mục vẫn sang PO nguyên vẹn.
- Modify `lib/purchaseOrderCommercialLines.ts`: phân biệt dòng PO chủ động bằng mô tả/quy cách khi cùng mã và cùng giá.
- Modify `lib/__tests__/purchaseOrderCommercialLines.test.ts`: kiểm thử repeated SKU theo mô tả.
- Modify `lib/purchaseOrderDisplay.ts`: ưu tiên tên snapshot trong summary.
- Modify `lib/__tests__/purchaseOrderDisplay.test.ts`: kiểm thử fallback dữ liệu mới/cũ.
- Modify `pages/project/SupplyChainTab.tsx`: UI PO, normalize/save, tạo PO từ MR và bản in dùng snapshot.
- Reuse `lib/__tests__/poSpecsUtils.test.ts` in regression verification; no production change is expected in `lib/poSpecsUtils.ts` because it already renders `specification`.

---

### Task 1: Shared material-line snapshot policy

**Files:**
- Create: `lib/materialLineDescription.ts`
- Create: `lib/__tests__/materialLineDescription.test.ts`

**Interfaces:**
- Produces: `resolveMaterialLineName(line, catalogName?) => string`
- Produces: `resolveMaterialLineSpecification(line) => string`
- Produces: `getMaterialDocumentLineKey(line, index) => string`
- Produces: `buildPurchaseOrderLineDescription(requestLine, catalogItem?) => Pick<PurchaseOrderItem, 'name' | 'itemNameSnapshot' | 'specification'>`
- Consumers: Tasks 3, 4 and 5.

- [ ] **Step 1: Write the failing unit tests**

Create `lib/__tests__/materialLineDescription.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { InventoryItem, RequestItem } from '../../types';
import {
  buildPurchaseOrderLineDescription,
  getMaterialDocumentLineKey,
  resolveMaterialLineName,
  resolveMaterialLineSpecification,
} from '../materialLineDescription';

const catalogItem: InventoryItem = {
  id: 'item-valve',
  sku: 'VT0001489',
  name: 'Van PPR D32',
  category: 'Ống nước',
  unit: 'Cái',
  priceIn: 0,
  priceOut: 0,
  minStock: 0,
  stockByWarehouse: {},
};

const requestLine = (lineId: string, name: string, specification: string): RequestItem => ({
  lineId,
  itemId: catalogItem.id,
  requestQty: 1,
  approvedQty: 0,
  skuSnapshot: catalogItem.sku,
  itemNameSnapshot: name,
  unitSnapshot: catalogItem.unit,
  specification,
});

describe('materialLineDescription', () => {
  it('prefers the document snapshot over the catalog name', () => {
    expect(resolveMaterialLineName(requestLine('line-a', 'Van chặn PPR D32', 'PN20'), catalogItem.name))
      .toBe('Van chặn PPR D32');
  });

  it('falls back safely for legacy rows without a snapshot', () => {
    expect(resolveMaterialLineName({ name: 'Tên PO cũ' }, catalogItem.name)).toBe('Tên PO cũ');
    expect(resolveMaterialLineName({}, catalogItem.name)).toBe('Van PPR D32');
  });

  it('keeps same-item document lines distinct by lineId', () => {
    expect(getMaterialDocumentLineKey(requestLine('line-a', 'Van chặn PPR D32', ''), 0)).toBe('line:line-a');
    expect(getMaterialDocumentLineKey(requestLine('line-b', 'Van PPR D32', ''), 1)).toBe('line:line-b');
  });

  it('uses an index-based key only for legacy rows without lineId', () => {
    expect(getMaterialDocumentLineKey({ itemId: catalogItem.id }, 3)).toBe('legacy:3:item-valve');
  });

  it('builds an independent PO description from the MR snapshot', () => {
    expect(buildPurchaseOrderLineDescription(
      requestLine('line-a', 'Van chặn PPR D32', 'PN20'),
      catalogItem,
    )).toEqual({
      name: 'Van chặn PPR D32',
      itemNameSnapshot: 'Van chặn PPR D32',
      specification: 'PN20',
    });
    expect(resolveMaterialLineSpecification(requestLine('line-a', 'Van chặn PPR D32', ' PN20 ')))
      .toBe('PN20');
  });
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
npx vitest run lib/__tests__/materialLineDescription.test.ts
```

Expected: FAIL because `../materialLineDescription` does not exist.

- [ ] **Step 3: Implement the shared pure helpers**

Create `lib/materialLineDescription.ts`:

```ts
import type { InventoryItem, PurchaseOrderItem, RequestItem } from '../types';

type MaterialLineLike = {
  lineId?: string | null;
  itemId?: string | null;
  sku?: string | null;
  skuSnapshot?: string | null;
  name?: string | null;
  itemNameSnapshot?: string | null;
  specification?: string | null;
  materialBudgetItemName?: string | null;
};

const clean = (value?: string | null) => String(value || '').trim();

export const resolveMaterialLineName = (line: MaterialLineLike, catalogName?: string | null): string =>
  clean(line.itemNameSnapshot)
  || clean(line.name)
  || clean(line.materialBudgetItemName)
  || clean(catalogName)
  || clean(line.skuSnapshot)
  || clean(line.sku)
  || clean(line.itemId);

export const resolveMaterialLineSpecification = (line: MaterialLineLike): string =>
  clean(line.specification);

export const getMaterialDocumentLineKey = (line: MaterialLineLike, index: number): string => {
  const lineId = clean(line.lineId);
  if (lineId) return `line:${lineId}`;
  return `legacy:${index}:${clean(line.itemId) || clean(line.skuSnapshot) || clean(line.sku) || 'unknown'}`;
};

export const buildPurchaseOrderLineDescription = (
  requestLine: Pick<RequestItem, 'itemId' | 'itemNameSnapshot' | 'materialBudgetItemName' | 'specification'>,
  catalogItem?: Pick<InventoryItem, 'name'>,
): Pick<PurchaseOrderItem, 'name' | 'itemNameSnapshot' | 'specification'> => {
  const itemNameSnapshot = resolveMaterialLineName(requestLine, catalogItem?.name);
  return {
    name: itemNameSnapshot,
    itemNameSnapshot,
    specification: resolveMaterialLineSpecification(requestLine),
  };
};
```

- [ ] **Step 4: Run the focused test and typecheck**

Run:

```bash
npx vitest run lib/__tests__/materialLineDescription.test.ts
npm run lint
```

Expected: all new tests PASS; TypeScript exits 0.

- [ ] **Step 5: Commit the shared policy**

```bash
git add lib/materialLineDescription.ts lib/__tests__/materialLineDescription.test.ts
git commit -m "feat: define material line description policy"
```

---

### Task 2: Preserve same-code descriptions during MR Excel import

**Files:**
- Modify: `lib/materialRequestImportService.ts`
- Create: `lib/__tests__/materialRequestImportService.test.ts`
- Modify: `components/project/material/MaterialRequestTab.tsx`
- Modify: `components/project/material/MaterialRequestImportPreviewModal.tsx`

**Interfaces:**
- Consumes: existing `RequestItem`, `InventoryItem` and SheetJS workbook parser.
- Produces: `MaterialRequestImportRow.specification: string`
- Produces: `buildImportedMaterialRequestItem(row, lineId) => RequestItem`
- Preserves: one output row per input Excel row, even when `materialCode` repeats.

- [ ] **Step 1: Write parser and builder regression tests**

Create `lib/__tests__/materialRequestImportService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { InventoryItem } from '../../types';
import {
  buildImportedMaterialRequestItem,
  parseMaterialRequestExcel,
} from '../materialRequestImportService';

const item: InventoryItem = {
  id: 'item-valve',
  sku: 'VT0001489',
  name: 'Van PPR D32',
  category: 'Ống nước',
  unit: 'Cái',
  priceIn: 0,
  priceOut: 0,
  minStock: 0,
  stockByWarehouse: {},
};

const workbookBuffer = () => {
  const rows = [
    ['Mã/Tên Phiếu đề xuất', 'Mã vật tư/SKU', 'Tên trên đề xuất', 'Quy cách/mô tả', 'Đơn vị tính', 'Số lượng đề xuất'],
    ['DX-VT-001', 'VT0001489', 'Van chặn PPR D32', 'PN20', 'Cái', 2],
    ['DX-VT-001', 'VT0001489', 'Van PPR D32', 'Loại thường', 'Cái', 10],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'De_Xuat_Vat_Tu');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
};

describe('material request Excel commercial descriptions', () => {
  it('keeps repeated material codes as separate rows with their Excel descriptions', async () => {
    const preview = await parseMaterialRequestExcel(workbookBuffer(), 'mr.xlsx', [item], [], []);

    expect(preview.rows).toHaveLength(2);
    expect(preview.rows.map(row => ({
      itemId: row.matchedInventoryItem?.id,
      name: row.materialName,
      specification: row.specification,
      qty: row.requestQty,
    }))).toEqual([
      { itemId: 'item-valve', name: 'Van chặn PPR D32', specification: 'PN20', qty: 2 },
      { itemId: 'item-valve', name: 'Van PPR D32', specification: 'Loại thường', qty: 10 },
    ]);
  });

  it('builds two traceable RequestItems without replacing Excel names by the catalog name', async () => {
    const preview = await parseMaterialRequestExcel(workbookBuffer(), 'mr.xlsx', [item], [], []);
    const requestItems = preview.rows.map((row, index) =>
      buildImportedMaterialRequestItem(row, `line-${index + 1}`));

    expect(requestItems.map(line => ({
      lineId: line.lineId,
      itemId: line.itemId,
      sku: line.skuSnapshot,
      name: line.itemNameSnapshot,
      specification: line.specification,
      unit: line.unitSnapshot,
    }))).toEqual([
      { lineId: 'line-1', itemId: 'item-valve', sku: 'VT0001489', name: 'Van chặn PPR D32', specification: 'PN20', unit: 'Cái' },
      { lineId: 'line-2', itemId: 'item-valve', sku: 'VT0001489', name: 'Van PPR D32', specification: 'Loại thường', unit: 'Cái' },
    ]);
  });

  it('warns when the Excel unit differs from the catalog stock unit', async () => {
    const rows = [
      ['Mã vật tư/SKU', 'Tên trên đề xuất', 'Đơn vị tính', 'Số lượng đề xuất'],
      ['VT0001489', 'Van chặn PPR D32', 'Hộp', 2],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'De_Xuat_Vat_Tu');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

    const preview = await parseMaterialRequestExcel(buffer, 'mr-unit.xlsx', [item], [], []);

    expect(preview.rows[0].warnings).toContain("ĐVT Excel 'Hộp' khác ĐVT tồn kho 'Cái'; MR sẽ dùng ĐVT tồn kho.");
    expect(buildImportedMaterialRequestItem(preview.rows[0], 'line-unit').unitSnapshot).toBe('Cái');
  });

  it('blocks a declared material code that does not exist even when the row has a name', async () => {
    const rows = [
      ['Mã vật tư/SKU', 'Tên trên đề xuất', 'Số lượng đề xuất'],
      ['VT-KHONG-TON-TAI', 'Tên nhập từ Excel', 1],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'De_Xuat_Vat_Tu');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

    const preview = await parseMaterialRequestExcel(buffer, 'mr-unknown.xlsx', [item], [], []);

    expect(preview.rows[0].status).toBe('error');
    expect(preview.rows[0].errors).toContain("Mã vật tư 'VT-KHONG-TON-TAI' không tồn tại trong danh mục kho hệ thống");
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail for the missing field/builder**

Run:

```bash
npx vitest run lib/__tests__/materialRequestImportService.test.ts
```

Expected: FAIL because `specification` and `buildImportedMaterialRequestItem` are absent.

- [ ] **Step 3: Extend the import field contract and template**

In `lib/materialRequestImportService.ts`:

```ts
export interface MaterialRequestImportRow {
  // existing fields...
  materialName: string;
  specification: string;
}

export interface MaterialRequestImportFields {
  // existing fields...
  materialName?: string;
  specification?: string;
}
```

Add a `SYSTEM_IMPORT_FIELDS` definition whose key is `specification`, label is `Quy cách/mô tả`, and synonyms include `quy cách`, `thông số`, `specification`, `spec`, `mô tả kỹ thuật`. Remove `quy cách` from the `materialName` synonyms so one Excel column cannot be mapped to both meanings.

Add `tên trên đề xuất` and `tên theo chứng từ` to the `materialName` synonyms so the new template maps without manual intervention.

Insert `Quy cách/mô tả` after `Tên trên đề xuất` in `generateMaterialRequestTemplate()`, including both example values `PN20` and `Loại thường`. Add `specification: ''` to the default column mapping and parse it with:

```ts
const specification = importText({ val: getCellVal('specification') }, ['val']);
```

Store `specification` on every `MaterialRequestImportRow`. Do not create any grouping keyed by `materialCode`; retain the existing `requestCode`-only grouping.

When a coded row matches an inventory item and both units are non-empty but differ after `normalizeLookupText`, append exactly:

```ts
warnings.push(`ĐVT Excel '${unit}' khác ĐVT tồn kho '${matchedInventoryItem.unit}'; MR sẽ dùng ĐVT tồn kho.`);
```

The builder in Step 4 remains authoritative for persistence and uses `matchedInventoryItem.unit` before the Excel unit.

Change the unknown-code branch so any non-empty `materialCode` that fails code lookup is an error even when `materialName` is present:

```ts
if (materialCode && !matchedInventoryItem) {
  errors.push(`Mã vật tư '${materialCode}' không tồn tại trong danh mục kho hệ thống`);
} else if (!matchedInventoryItem && !materialName) {
  errors.push('Tên vật tư hoặc Mã vật tư không được để trống');
} else if (!matchedInventoryItem) {
  warnings.push('Vật tư chưa có trong danh mục kho (sẽ tạo vật tư tạm)');
}
```

This keeps the existing name-only uncoded flow but prevents a mistyped declared SKU from silently becoming a temporary material.

- [ ] **Step 4: Add the RequestItem builder and wire import confirmation**

In `lib/materialRequestImportService.ts`, export:

```ts
export const buildImportedMaterialRequestItem = (
  row: MaterialRequestImportRow,
  lineId: string,
): RequestItem => ({
  lineId,
  itemId: row.matchedInventoryItem?.id || row.materialCode || `custom-${lineId}`,
  requestQty: row.requestQty,
  approvedQty: row.requestQty,
  workBoqItemId: row.matchedWorkBoqItem?.id || null,
  workBoqItemName: row.matchedWorkBoqItem?.name || null,
  neededDate: row.neededDate,
  note: row.note,
  isOverBoq: row.isOverBoq,
  overQty: row.overQty,
  isManualItem: !row.matchedInventoryItem,
  skuSnapshot: row.matchedInventoryItem?.sku || row.materialCode || undefined,
  itemNameSnapshot: row.materialName || row.matchedInventoryItem?.name || undefined,
  unitSnapshot: row.matchedInventoryItem?.unit || row.unit || undefined,
  specification: row.specification || undefined,
});
```

Import `RequestItem` into the service. In `components/project/material/MaterialRequestTab.tsx`, replace the inline `group.rows.map(row => ({ ... }))` with:

```ts
const requestItems = group.rows.map(row =>
  buildImportedMaterialRequestItem(row, crypto.randomUUID()));
```

Do not use `Date.now()` as the only line identity.

- [ ] **Step 5: Make the preview expose both Excel and catalog meanings**

In `MaterialRequestImportPreviewModal.tsx`, add a `Quy cách/mô tả` column and render `row.specification || '-'`. Under `row.materialName`, render matched catalog context without replacing the Excel name:

```tsx
{row.matchedInventoryItem && (
  <div className="mt-0.5 text-[10px] font-medium text-slate-400">
    Danh mục: {row.matchedInventoryItem.sku} — {row.matchedInventoryItem.name}
  </div>
)}
```

- [ ] **Step 6: Run focused tests, typecheck and build**

Run:

```bash
npx vitest run lib/__tests__/materialRequestImportService.test.ts
npm run lint
npm run build
```

Expected: tests PASS, TypeScript exits 0, Vite build succeeds.

- [ ] **Step 7: Commit Excel import support**

```bash
git add lib/materialRequestImportService.ts lib/__tests__/materialRequestImportService.test.ts components/project/material/MaterialRequestTab.tsx components/project/material/MaterialRequestImportPreviewModal.tsx
git commit -m "feat: preserve MR Excel line descriptions"
```

---

### Task 3: Make manual MR lines editable and line-safe

**Files:**
- Create: `components/material/MaterialCommercialDescriptionFields.tsx`
- Modify: `components/RequestModal.tsx`
- Create: `lib/__tests__/materialCommercialDescriptionUiContract.test.ts`

**Interfaces:**
- Consumes: `resolveMaterialLineName()` and `getMaterialDocumentLineKey()` from Task 1.
- Produces: reusable `MaterialCommercialDescriptionFields` component.
- Guarantees: manual MR may contain repeated `itemId` values and each line remains visible/editable independently.

- [ ] **Step 1: Write the MR UI wiring contract test**

Create `lib/__tests__/materialCommercialDescriptionUiContract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const requestModal = readFileSync(join(process.cwd(), 'components/RequestModal.tsx'), 'utf8');
const poPage = readFileSync(join(process.cwd(), 'pages/project/SupplyChainTab.tsx'), 'utf8');
const importTab = readFileSync(join(process.cwd(), 'components/project/material/MaterialRequestTab.tsx'), 'utf8');
const importPreview = readFileSync(join(process.cwd(), 'components/project/material/MaterialRequestImportPreviewModal.tsx'), 'utf8');

describe('material commercial description UI wiring', () => {
  it('uses line identity and editable snapshots in the MR form', () => {
    expect(requestModal).toContain('getMaterialDocumentLineKey(row, index)');
    expect(requestModal).toContain('<MaterialCommercialDescriptionFields');
    expect(requestModal).toContain("handleUpdateItem(primary.index, 'itemNameSnapshot'");
    expect(requestModal).toContain("handleUpdateItem(primary.index, 'specification'");
    expect(requestModal).not.toContain("? `sku:${sku.toLowerCase()}`");
  });

  it('wires imported rows through the snapshot builder and preview', () => {
    expect(importTab).toContain('buildImportedMaterialRequestItem(row, crypto.randomUUID())');
    expect(importPreview).toContain('row.specification');
    expect(importPreview).toContain('Danh mục:');
  });
});
```

- [ ] **Step 2: Run the MR-specific contract and verify failure**

Run:

```bash
npx vitest run lib/__tests__/materialCommercialDescriptionUiContract.test.ts -t "uses line identity"
```

Expected: FAIL because RequestModal has no editable commercial-description component and groups by SKU.

- [ ] **Step 3: Create the shared presentation component**

Create `components/material/MaterialCommercialDescriptionFields.tsx` with this public contract:

```tsx
type MaterialCommercialDescriptionFieldsProps = {
  sku?: string;
  catalogName?: string;
  name: string;
  specification?: string;
  disabled?: boolean;
  nameLabel: string;
  onNameChange: (value: string) => void;
  onSpecificationChange: (value: string) => void;
  className?: string;
};
```

Render read-only `Mã vật tư` and `Tên danh mục` context, then two controlled inputs. The name input placeholder is `Nhập tên hiển thị trên chứng từ`; the specification input placeholder is `Nhập quy cách / mô tả kỹ thuật`. Do not expose an SKU editor.

- [ ] **Step 4: Change RequestModal display identity and name priority**

Import Task 1 helpers and replace `getLineName()` with:

```ts
const getLineName = (line: Partial<RequestLineDraft | RequestItem>) =>
  resolveMaterialLineName(line, getLineInventory(line.itemId)?.name)
  || 'Dòng chưa có mã kho';
```

Inside `materialDisplayGroups`, set:

```ts
const key = getMaterialDocumentLineKey(row, index);
```

This makes every modern line its own display group. Retain legacy fallbacks only for reading; do not reintroduce SKU-based grouping.

Remove the `!isProjectRequest && reqItems.some(i => i.itemId === item.id)` rejection in `handleSelectFromModal()`, so all MR modes can add the same material more than once.

- [ ] **Step 5: Render editable name/specification controls for each draft line**

In both desktop and mobile editable MR render paths, mount:

```tsx
<MaterialCommercialDescriptionFields
  sku={getLineSku(primaryRow)}
  catalogName={getLineInventory(primaryRow.itemId)?.name}
  name={(primaryRow as RequestLineDraft).itemNameSnapshot || ''}
  specification={(primaryRow as RequestLineDraft).specification || ''}
  disabled={!isEditable}
  nameLabel="Tên trên đề xuất"
  onNameChange={value => handleUpdateItem(primary.index, 'itemNameSnapshot', value)}
  onSpecificationChange={value => handleUpdateItem(primary.index, 'specification', value)}
/>
```

For expanded source rows, use `source.index`, not `primary.index`. Preserve existing BOQ, quantity and over-budget controls.

Update `handlePrintMaterialRequest()` and every MR fulfillment/receipt print table in `RequestModal.tsx` so the item-name cell renders the escaped snapshot first and, when non-empty, a second escaped line `Quy cách: ${line.specification}`. Continue resolving fulfillment rows through `requestLineId`; do not look up the first row by `itemId`.

- [ ] **Step 6: Run the MR contract, shared helper tests and typecheck**

Run:

```bash
npx vitest run lib/__tests__/materialCommercialDescriptionUiContract.test.ts -t "uses line identity"
npx vitest run lib/__tests__/materialLineDescription.test.ts
npm run lint
```

Expected: selected contract test and helper tests PASS; TypeScript exits 0.

- [ ] **Step 7: Commit manual MR support**

```bash
git add components/material/MaterialCommercialDescriptionFields.tsx components/RequestModal.tsx lib/__tests__/materialCommercialDescriptionUiContract.test.ts
git commit -m "feat: edit descriptions per MR line"
```

---

### Task 4: Preserve MR descriptions and permit valid repeated PO lines

**Files:**
- Modify: `lib/purchaseOrderRequestCart.ts`
- Modify: `lib/__tests__/purchaseOrderRequestCart.test.ts`
- Modify: `lib/purchaseOrderCommercialLines.ts`
- Modify: `lib/__tests__/purchaseOrderCommercialLines.test.ts`
- Modify: `pages/project/SupplyChainTab.tsx`

**Interfaces:**
- Consumes: `buildPurchaseOrderLineDescription()` from Task 1.
- Produces: PO items whose `name` and `itemNameSnapshot` mirror the line-specific PO display name.
- Preserves: request linkage by `requestId`/`requestLineId`; MR objects remain immutable.

- [ ] **Step 1: Add PO-from-MR snapshot regression tests**

In `lib/__tests__/purchaseOrderRequestCart.test.ts`, make a row with a catalog name different from the MR snapshot and add:

```ts
it('preserves the MR commercial name and specification instead of restoring the catalog name', () => {
  const row = cartRow('mr-b', 'line-b');
  row.line.itemNameSnapshot = 'Biển báo chữ A phản quang';
  row.line.specification = 'Màng phản quang loại 3M';

  const item = buildPurchaseOrderItemFromRequestCartRow({
    row,
    inventory,
    budget,
    supplierPatch: { vendorId: 'vendor-po', vendorName: 'NCC PO' },
    lineId: 'po-line-b',
  });

  expect(item).toMatchObject({
    itemId: inventory.id,
    sku: inventory.sku,
    name: 'Biển báo chữ A phản quang',
    itemNameSnapshot: 'Biển báo chữ A phản quang',
    specification: 'Màng phản quang loại 3M',
    requestLineId: 'line-b',
  });
  expect(row.line.itemNameSnapshot).toBe('Biển báo chữ A phản quang');
});
```

- [ ] **Step 2: Add repeated-description validator tests**

In `lib/__tests__/purchaseOrderCommercialLines.test.ts`, add:

```ts
it('allows proactive same SKU and price when commercial descriptions differ', () => {
  expect(findPurchaseOrderCommercialLineIssue({
    sourceMode: 'proactive_project',
    items: [
      line('line-a', 10_000, { itemNameSnapshot: 'Van chặn PPR D32', specification: 'PN20' }),
      line('line-b', 10_000, { itemNameSnapshot: 'Van PPR D32', specification: 'Loại thường' }),
    ],
  })).toBeNull();
});

it('still rejects identical proactive commercial rows', () => {
  expect(findPurchaseOrderCommercialLineIssue({
    sourceMode: 'proactive_project',
    items: [
      line('line-a', 10_000, { itemNameSnapshot: 'Van PPR D32', specification: 'PN20' }),
      line('line-b', 10_000, { itemNameSnapshot: 'Van PPR D32', specification: 'PN20' }),
    ],
  })).toMatchObject({ code: 'duplicate_commercial_price' });
});

it('allows request-source rows with the same item when requestLineIds differ', () => {
  expect(findPurchaseOrderCommercialLineIssue({
    sourceMode: 'from_request',
    items: [
      line('line-a', 10_000, { requestLineId: 'mr-line-a' }),
      line('line-b', 10_000, { requestLineId: 'mr-line-b' }),
    ],
  })).toBeNull();
});
```

- [ ] **Step 3: Run focused tests and verify the snapshot/validator failures**

Run:

```bash
npx vitest run lib/__tests__/purchaseOrderRequestCart.test.ts lib/__tests__/purchaseOrderCommercialLines.test.ts
```

Expected: the new snapshot test FAILS because the catalog name wins; the proactive-description test FAILS because the current commercial key ignores description.

- [ ] **Step 4: Fix the reusable request-cart mapper**

In `lib/purchaseOrderRequestCart.ts`, import `buildPurchaseOrderLineDescription` and compute:

```ts
const descriptionPatch = buildPurchaseOrderLineDescription(row.line, inventory);
```

Spread `descriptionPatch` into both the base `conversionLine` and the returned `PurchaseOrderItem`. Remove both occurrences where `inventory?.name` currently precedes `row.line.itemNameSnapshot`.

- [ ] **Step 5: Make proactive duplicate keys description-aware**

In `lib/purchaseOrderCommercialLines.ts`, add:

```ts
const normalizeText = (value?: string | null) =>
  String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi-VN');
```

Extend `commercialKey(line)` with:

```ts
normalizeText(line.itemNameSnapshot || line.name),
normalizeText(line.specification),
```

Keep `requestKey()` keyed by `requestLineId`; do not loosen duplicate handling for the same source request line.

- [ ] **Step 6: Fix both inline PO-from-MR construction paths**

In `pages/project/SupplyChainTab.tsx`, both the selected-request flow and appended-request flow must use:

```ts
const descriptionPatch = buildPurchaseOrderLineDescription(row.line, inventory);
```

Then spread `...descriptionPatch` instead of assigning `name` or `itemNameSnapshot` from `inventory.name`. Verify with:

```bash
rg -n "inventory\?\.name \|\| row\.line\.itemNameSnapshot|itemNameSnapshot: inventory\?\.name \|\| row\.line" pages/project/SupplyChainTab.tsx lib/purchaseOrderRequestCart.ts
```

Expected: no matches.

- [ ] **Step 7: Run PO mapping/validation tests and typecheck**

Run:

```bash
npx vitest run lib/__tests__/purchaseOrderRequestCart.test.ts lib/__tests__/purchaseOrderCommercialLines.test.ts
npm run lint
```

Expected: all focused tests PASS; TypeScript exits 0.

- [ ] **Step 8: Commit PO mapping and duplicate semantics**

```bash
git add lib/purchaseOrderRequestCart.ts lib/__tests__/purchaseOrderRequestCart.test.ts lib/purchaseOrderCommercialLines.ts lib/__tests__/purchaseOrderCommercialLines.test.ts pages/project/SupplyChainTab.tsx
git commit -m "feat: preserve descriptions from MR to PO"
```

---

### Task 5: Edit, save and print PO line descriptions

**Files:**
- Modify: `pages/project/SupplyChainTab.tsx`
- Modify: `lib/purchaseOrderDisplay.ts`
- Modify: `lib/__tests__/purchaseOrderDisplay.test.ts`
- Modify: `lib/__tests__/materialCommercialDescriptionUiContract.test.ts`

**Interfaces:**
- Consumes: `MaterialCommercialDescriptionFields`, `resolveMaterialLineName()` and `resolveMaterialLineSpecification()`.
- Produces: draft PO form edits where `name` and `itemNameSnapshot` remain synchronized at save time.
- Produces: list summaries, approval print and purchase-order print that prefer line snapshots.

- [ ] **Step 1: Add display fallback tests**

In `lib/__tests__/purchaseOrderDisplay.test.ts`, add:

```ts
it('prefers PO line snapshots over legacy names in material summaries', () => {
  const po = makePo({
    items: [{
      ...makePo().items[0],
      name: 'Tên danh mục cũ',
      itemNameSnapshot: 'Tên trên PO đã sửa',
      specification: 'PN20',
    }],
  });

  expect(buildPurchaseOrderListSummary(po, []).materialSummary).toBe('Tên trên PO đã sửa');
});

it('keeps legacy PO rows readable when itemNameSnapshot is absent', () => {
  const po = makePo({ items: [{ ...makePo().items[0], itemNameSnapshot: undefined }] });
  expect(buildPurchaseOrderListSummary(po, []).materialSummary).toBe('Bien bao chu A');
});
```

Append this test to `lib/__tests__/materialCommercialDescriptionUiContract.test.ts`:

```ts
it('exposes editable PO name and specification fields', () => {
  expect(poPage).toContain('<MaterialCommercialDescriptionFields');
  expect(poPage).toContain('name: value, itemNameSnapshot: value');
  expect(poPage).toContain('specification: value');
});
```

- [ ] **Step 2: Run PO display and PO UI contract tests to verify failure**

Run:

```bash
npx vitest run lib/__tests__/purchaseOrderDisplay.test.ts
npx vitest run lib/__tests__/materialCommercialDescriptionUiContract.test.ts -t "exposes editable PO"
```

Expected: snapshot-priority test FAILS because `item.name` currently wins; UI contract FAILS because the PO form has no shared fields.

- [ ] **Step 3: Synchronize PO form normalization**

In `normalizePoItem()` inside `SupplyChainTab.tsx`, compute:

```ts
const lineName = resolveMaterialLineName(item, matched?.name);
```

Then persist:

```ts
name: lineName,
itemNameSnapshot: lineName,
specification: resolveMaterialLineSpecification(item),
```

This is the compatibility boundary: new saves keep legacy `name` and current `itemNameSnapshot` equal. Do not update `matched.name` or call any item-update service.

- [ ] **Step 4: Render editable PO fields**

Below each PO line's main selector/quantity row, mount:

```tsx
<MaterialCommercialDescriptionFields
  sku={item.sku}
  catalogName={inventory?.name}
  name={item.itemNameSnapshot || item.name || ''}
  specification={item.specification || ''}
  nameLabel="Tên trên PO"
  onNameChange={value => updatePoItem(i, { name: value, itemNameSnapshot: value })}
  onSpecificationChange={value => updatePoItem(i, { specification: value })}
/>
```

The PO draft form is already opened only after `ensureCanEditPo()` succeeds, so omit the optional `disabled` prop here. Selecting a different inventory item resets the name to the new catalog name as today; subsequent typing edits only the PO form line.

- [ ] **Step 5: Fix summary and print name priority**

In `lib/purchaseOrderDisplay.ts`, change material-name resolution to:

```ts
cleanText(item.itemNameSnapshot || item.name || item.materialBudgetItemName || item.sku)
```

In both `buildItemRow()` and the main printable PO item loop in `SupplyChainTab.tsx`, derive:

```ts
const displayName = resolveMaterialLineName(item);
const specification = resolveMaterialLineSpecification(item);
```

Render `displayName` instead of raw `item.name`. Ensure free-text `specification` is present in the main purchase-order print, either via `formatPoApprovalLineDetails(item)` or an escaped `Quy cách: ...` line. Keep existing structured `specs`, price formulas and notes.

- [ ] **Step 6: Preserve names in delivery print projections**

Where `SupplyChainTab.tsx` projects a source PO item into a delivery-print `PurchaseOrderItem`, set:

```ts
const sourceName = resolveMaterialLineName(sourceItem || {}, inventory?.name || line.itemId);
// ...
name: sourceName,
itemNameSnapshot: sourceName,
specification: sourceItem?.specification || '',
```

Continue resolving the operational line by `purchaseOrderLineId`; do not fall back to the first matching `itemId` when repeated rows exist.

- [ ] **Step 7: Run UI, display, print-detail and type checks**

Run:

```bash
npx vitest run lib/__tests__/materialCommercialDescriptionUiContract.test.ts lib/__tests__/purchaseOrderDisplay.test.ts lib/__tests__/poSpecsUtils.test.ts
npm run lint
npm run build
```

Expected: all focused tests PASS; TypeScript exits 0; Vite build succeeds.

- [ ] **Step 8: Commit PO UI and output behavior**

```bash
git add pages/project/SupplyChainTab.tsx lib/purchaseOrderDisplay.ts lib/__tests__/purchaseOrderDisplay.test.ts lib/__tests__/materialCommercialDescriptionUiContract.test.ts lib/__tests__/poSpecsUtils.test.ts
git commit -m "feat: edit and print PO line descriptions"
```

---

### Task 6: End-to-end regression and acceptance verification

**Files:**
- Modify only files required to fix failures revealed by this task.
- No database migration file should be created.

**Interfaces:**
- Consumes: all deliverables from Tasks 1–5.
- Produces: verified MR → Excel → PO → delivery/stock behavior without changing catalog identity.

- [ ] **Step 1: Run the complete focused regression set**

Run:

```bash
npx vitest run \
  lib/__tests__/materialLineDescription.test.ts \
  lib/__tests__/materialRequestImportService.test.ts \
  lib/__tests__/materialCommercialDescriptionUiContract.test.ts \
  lib/__tests__/purchaseOrderRequestCart.test.ts \
  lib/__tests__/purchaseOrderCommercialLines.test.ts \
  lib/__tests__/purchaseOrderDisplay.test.ts \
  lib/__tests__/purchaseOrderAmount.test.ts \
  lib/__tests__/purchaseOrderDeliveryDraft.test.ts \
  lib/__tests__/materialRequestFulfillmentService.actualReceipt.test.ts \
  lib/__tests__/materialRequestFulfillmentService.proactiveReceipt.test.ts \
  lib/__tests__/purchaseOrderSupplierReturnService.test.ts \
  lib/__tests__/poSpecsUtils.test.ts
```

Expected: all selected files PASS. Any failure involving repeated SKU identity must be fixed by using `lineId`, never by reverting to `itemId` grouping.

- [ ] **Step 2: Run the entire test suite**

Run:

```bash
npm test
```

Expected: Vitest exits 0 with no failed files or tests.

- [ ] **Step 3: Run static and production-build verification**

Run:

```bash
npm run lint
npm run build
```

Expected: TypeScript exits 0 and Vite produces a successful production build.

- [ ] **Step 4: Verify no schema or catalog mutation was introduced**

Run:

```bash
git diff --name-only HEAD~5..HEAD | rg '^supabase/migrations/' && exit 1 || true
rg -n "updateItem\(|from\('items'\)\.update|from\(\"items\"\)\.update" components/RequestModal.tsx components/project/material/MaterialRequestTab.tsx pages/project/SupplyChainTab.tsx
```

Expected: no migration file in the feature commits; no new item-catalog update call in the three feature entry points.

- [ ] **Step 5: Perform local-browser acceptance without writing Cloud data**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Use the existing configured Cloud data only for reads. In the UI:

1. Open a new MR draft form but do not save it.
2. Add `VT0001489` twice.
3. Enter `Van chặn PPR D32` / `PN20` and `Van PPR D32` / `Loại thường`.
4. Confirm both rows remain visible and independently editable.
5. Open the MR Excel preview with a two-row workbook and confirm both matched rows, names and specifications appear independently; cancel before import.
6. Open a new PO draft form but do not save it, add the same item twice, and confirm names/specifications can differ.

Expected: no writes are made to Supabase Cloud during this verification.

- [ ] **Step 6: Review final diff against the approved spec**

Run:

```bash
git diff HEAD~5..HEAD --check
git status --short
```

Check explicitly:

- Same-code MR lines survive manual entry and Excel parsing.
- MR display/print uses snapshots before catalog name.
- PO copies snapshots from MR and saves its own independent snapshots.
- PO summary/print/delivery print uses line-specific names/specifications.
- Stock identity remains `itemId`; all repeated-line operational lookups remain `lineId`-first.
- Legacy rows without snapshots still display.

Expected: `git diff --check` exits 0; worktree contains only intentional changes.

- [ ] **Step 7: Commit any final regression-only corrections**

If Task 6 required code changes, stage only the feature files:

```bash
git add \
  lib/materialLineDescription.ts \
  lib/materialRequestImportService.ts \
  lib/purchaseOrderRequestCart.ts \
  lib/purchaseOrderCommercialLines.ts \
  lib/purchaseOrderDisplay.ts \
  components/material/MaterialCommercialDescriptionFields.tsx \
  components/RequestModal.tsx \
  components/project/material/MaterialRequestTab.tsx \
  components/project/material/MaterialRequestImportPreviewModal.tsx \
  pages/project/SupplyChainTab.tsx \
  lib/__tests__/materialLineDescription.test.ts \
  lib/__tests__/materialRequestImportService.test.ts \
  lib/__tests__/materialCommercialDescriptionUiContract.test.ts \
  lib/__tests__/purchaseOrderRequestCart.test.ts \
  lib/__tests__/purchaseOrderCommercialLines.test.ts \
  lib/__tests__/purchaseOrderDisplay.test.ts
git commit -m "fix: complete MR PO description regression coverage"
```

If no corrections were needed, do not create an empty commit.

---

## Execution checkpoints

- After Task 2: Excel parser and MR creation preserve repeated-code names/specifications.
- After Task 3: manual MR entry and display are line-safe.
- After Task 4: PO creation from MR preserves snapshots and validator accepts genuinely distinct commercial lines.
- After Task 5: PO editing, summary and printed outputs show line-specific content.
- After Task 6: full regressions prove stock/receipt/return behavior remains line-safe and no schema change was introduced.
