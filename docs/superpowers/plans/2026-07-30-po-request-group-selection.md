# PO Request Group Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group request-material rows by their source request in the PO request picker, allowing whole-request selection while retaining per-material selection.

**Architecture:** Add pure grouping and selection helpers alongside the existing PO request-cart domain functions. `SupplyChainTab` continues to own `selectedRequestLineKeys`; it derives a group checkbox state from the rows currently shown and updates that same state when the user toggles a group or a material row.

**Tech Stack:** React 18, TypeScript, Vitest, Tailwind CSS.

## Global Constraints

- Group by the stable `MaterialRequest.id`, displaying the associated `MaterialRequest.code`.
- Use `selectedRequestLineKeys` as the only stored selection state; do not persist group selection separately.
- Preserve the existing create-PO and append-to-existing-PO eligibility filters and source-line links.
- Do not alter unrelated in-progress purchase-order changes in the working tree.

---

## File structure

- Modify `lib/purchaseOrderRequestCart.ts`: expose pure helpers to group request-cart rows and calculate/apply group selection.
- Modify `lib/__tests__/purchaseOrderRequestCart.test.ts`: cover grouping, all/partial/none selection states, and isolated group toggles.
- Modify `pages/project/SupplyChainTab.tsx`: derive request groups from `requestPickerRows`, render a selectable header for each request, and preserve individual row checkboxes.

### Task 1: Request-cart group selection domain helpers

**Files:**
- Modify: `lib/purchaseOrderRequestCart.ts`
- Test: `lib/__tests__/purchaseOrderRequestCart.test.ts`

**Interfaces:**
- Produces `PurchaseOrderRequestCartGroup<T>` with `requestId`, `requestCode`, and `rows`.
- Produces `getPurchaseOrderRequestCartGroupSelectionState(rows, selectedKeys)` returning `'none' | 'partial' | 'all'`.
- Produces `setPurchaseOrderRequestCartGroupSelection(rows, selectedKeys, isSelected)` returning the next selected-row keys with unrelated keys preserved.
- Consumes existing `PurchaseOrderRequestCartRow.key` and `PurchaseOrderRequestCartRow.request.id` fields.

- [ ] **Step 1: Write failing tests for grouping and selection state**

  Add two rows for `mr-a` and one row for `mr-b`, then add the following assertions to `describe('purchaseOrderRequestCart')`:

  ```ts
  it('groups rows by source request while retaining their material-row order', () => {
    const groups = groupPurchaseOrderRequestCartRows([
      cartRow('mr-a', 'line-a1'),
      cartRow('mr-a', 'line-a2'),
      cartRow('mr-b', 'line-b1'),
    ]);

    expect(groups.map(group => [group.requestId, group.rows.map(row => row.key)])).toEqual([
      ['mr-a', ['mr-a:line-a1', 'mr-a:line-a2']],
      ['mr-b', ['mr-b:line-b1']],
    ]);
  });

  it('reports none, partial, and all selection for one request group', () => {
    const rows = [cartRow('mr-a', 'line-a1'), cartRow('mr-a', 'line-a2')];

    expect(getPurchaseOrderRequestCartGroupSelectionState(rows, [])).toBe('none');
    expect(getPurchaseOrderRequestCartGroupSelectionState(rows, ['mr-a:line-a1'])).toBe('partial');
    expect(getPurchaseOrderRequestCartGroupSelectionState(rows, ['mr-a:line-a1', 'mr-a:line-a2'])).toBe('all');
  });

  it('returns partial after one material row is cleared from a selected group', () => {
    const rows = [cartRow('mr-a', 'line-a1'), cartRow('mr-a', 'line-a2')];
    const selected = setPurchaseOrderRequestCartGroupSelection(rows, [], true)
      .filter(key => key !== 'mr-a:line-a2');

    expect(getPurchaseOrderRequestCartGroupSelectionState(rows, selected)).toBe('partial');
  });
  ```

- [ ] **Step 2: Run the focused test and confirm it fails because the helper exports do not exist**

  Run: `npm test -- lib/__tests__/purchaseOrderRequestCart.test.ts`

  Expected: FAIL with missing exported helper errors.

- [ ] **Step 3: Write a failing test for a group toggle that preserves other requests**

  ```ts
  it('selects and clears only the toggled request group', () => {
    const groupRows = [cartRow('mr-a', 'line-a1'), cartRow('mr-a', 'line-a2')];
    const initiallySelected = ['mr-b:line-b1', 'mr-a:line-a1'];

    expect(setPurchaseOrderRequestCartGroupSelection(groupRows, initiallySelected, true))
      .toEqual(['mr-b:line-b1', 'mr-a:line-a1', 'mr-a:line-a2']);
    expect(setPurchaseOrderRequestCartGroupSelection(groupRows, initiallySelected, false))
      .toEqual(['mr-b:line-b1']);
  });
  ```

- [ ] **Step 4: Implement the minimal pure helpers**

  In `lib/purchaseOrderRequestCart.ts`, add:

  ```ts
  export type PurchaseOrderRequestCartGroup<T extends PurchaseOrderRequestCartRow = PurchaseOrderRequestCartRow> = {
    requestId: string;
    requestCode: string;
    rows: T[];
  };

  export const groupPurchaseOrderRequestCartRows = <T extends PurchaseOrderRequestCartRow>(rows: T[]) => {
    const groups = new Map<string, PurchaseOrderRequestCartGroup<T>>();
    rows.forEach(row => {
      const current = groups.get(row.request.id);
      if (current) current.rows.push(row);
      else groups.set(row.request.id, { requestId: row.request.id, requestCode: row.request.code, rows: [row] });
    });
    return [...groups.values()];
  };
  ```

  Implement selection state using a `Set(selectedKeys)`, and implement the toggle by either adding every group row key or removing every group row key while retaining keys not in that group.

- [ ] **Step 5: Run the focused test and confirm it passes**

  Run: `npm test -- lib/__tests__/purchaseOrderRequestCart.test.ts`

  Expected: PASS with all request-cart tests green.

- [ ] **Step 6: Commit the focused domain change**

  ```bash
  git add lib/purchaseOrderRequestCart.ts lib/__tests__/purchaseOrderRequestCart.test.ts
  git commit -m "feat: add PO request group selection helpers"
  ```

### Task 2: Render request groups in the PO picker

**Files:**
- Modify: `pages/project/SupplyChainTab.tsx:160-171`
- Modify: `pages/project/SupplyChainTab.tsx:2796-2800`
- Modify: `pages/project/SupplyChainTab.tsx:7992-8079`
- Test: `lib/__tests__/purchaseOrderRequestCart.test.ts`

**Interfaces:**
- Consumes `groupPurchaseOrderRequestCartRows`, `getPurchaseOrderRequestCartGroupSelectionState`, and `setPurchaseOrderRequestCartGroupSelection` from `lib/purchaseOrderRequestCart.ts`.
- Consumes `requestPickerRows: PurchaseOrderRequestCartRow[]` and `selectedRequestLineKeys: string[]`.
- Produces a group header checkbox that calls `setSelectedRequestLineKeys` and row checkboxes that continue to change only one key.

- [ ] **Step 1: Derive grouped picker rows and import helpers**

  Add the three domain-helper imports next to the existing `purchaseOrderRequestCart` imports. After `requestPickerRows`, derive:

  ```ts
  const requestPickerGroups = useMemo(
    () => groupPurchaseOrderRequestCartRows(requestPickerRows),
    [requestPickerRows],
  );
  ```

- [ ] **Step 2: Replace the flat row map with request-group sections**

  Keep the table columns and every existing material-row cell. Replace `requestPickerRows.map` with `requestPickerGroups.map(group => ...)`, rendering:

  ```tsx
  <React.Fragment key={group.requestId}>
    <tr className="bg-indigo-50/70 dark:bg-indigo-950/25">
      <td className="px-4 py-2 text-center">
        <input
          type="checkbox"
          checked={selectionState === 'all'}
          ref={input => { if (input) input.indeterminate = selectionState === 'partial'; }}
          onChange={event => setSelectedRequestLineKeys(prev =>
            setPurchaseOrderRequestCartGroupSelection(group.rows, prev, event.target.checked))}
          aria-label={`Chọn toàn bộ phiếu ${group.requestCode}`}
          className="accent-amber-500"
        />
      </td>
      <td colSpan={12} className="px-4 py-2 font-black text-indigo-700 dark:text-indigo-300">
        {group.requestCode} <span className="font-bold text-slate-500">• {group.rows.length} vật tư</span>
      </td>
    </tr>
  </React.Fragment>
  ```

  Compute `selectionState` at the top of the group callback with `getPurchaseOrderRequestCartGroupSelectionState(group.rows, selectedRequestLineKeys)`. Move the current line-rendering body, from `const inv = ...` through the line's closing `</tr>`, unchanged inside `group.rows.map(row => { ... })`; this preserves every material column, the single-row checkbox handler, and the `closeRequestLineNeed(row)` button. Each row checkbox therefore continues to add/remove only `row.key`, so a user can undo or add individual materials after choosing the group.

- [ ] **Step 3: Run targeted tests, TypeScript, and build**

  Run: `npm test -- lib/__tests__/purchaseOrderRequestCart.test.ts && npm run lint && npm run build`

  Expected: all commands exit `0`.

- [ ] **Step 4: Manually verify both picker modes**

  Start the app with `npm run dev` and check the request picker in both modes:

  1. In **Tạo PO từ đề xuất công trường**, choose a group checkbox and observe every material in that request selected.
  2. Clear one material and observe the group checkbox change to indeterminate; select it again and observe it return to checked.
  3. Clear the group checkbox and observe only that request's materials cleared.
  4. In **Thêm đề xuất vào PO**, repeat the group interaction and confirm only rows eligible to append are grouped and selected.

- [ ] **Step 5: Commit the UI integration**

  ```bash
  git add pages/project/SupplyChainTab.tsx lib/__tests__/purchaseOrderRequestCart.test.ts
  git commit -m "feat: group PO request picker selections"
  ```
