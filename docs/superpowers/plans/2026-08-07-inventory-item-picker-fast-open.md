# Fast Inventory Item Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the shared material-selection modal responsive with a catalogue larger than 1,200 rows by debouncing search and rendering at most 50 matching rows.

**Architecture:** Move the modal's eligibility filter and result cap into a pure helper in `lib` so it can be regression-tested without React. `ItemSelectionModal` will retain raw input state, consume a 250 ms debounced query for the helper, and show compact feedback when the matching set exceeds the rendered cap.

**Tech Stack:** React 18, TypeScript, Vitest, Vite.

## Global Constraints

- Preserve case- and Vietnamese-accent-insensitive matching over SKU and item name.
- Preserve `allowAllItems`, warehouse stock filtering, QR-scanner handoff, stock display, and `onSelect` behaviour.
- Limit rendered matches to exactly 50; do not add a database query, migration, or cursor API.
- Do not change `InventoryItemCombobox` or `SearchableSelect`.

---

## File Structure

- Create: `lib/itemSelectionSearch.ts` — pure, reusable item eligibility/filter/limit calculation.
- Create: `lib/__tests__/itemSelectionSearch.test.ts` — regression coverage for result cap and warehouse filtering.
- Modify: `components/ItemSelectionModal.tsx` — debounce raw text input, render the helper output, and display result-limit feedback.

### Task 1: Add a tested material-picker result helper

**Files:**

- Create: `lib/itemSelectionSearch.ts`
- Test: `lib/__tests__/itemSelectionSearch.test.ts`

**Interfaces:**

- Consumes: `InventoryItem` from `types.ts` and `matchesSearchQueryMultiple` from `lib/searchUtils.ts`.
- Produces: `ITEM_SELECTION_RESULT_LIMIT`, `getItemSelectionResults(items, options)`, and `{ items, totalMatches }`.

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '../../types';
import { getItemSelectionResults, ITEM_SELECTION_RESULT_LIMIT } from '../itemSelectionSearch';

const item = (id: string, name: string, stock = 1): InventoryItem => ({
  id, sku: `VT-${id}`, name, category: 'Vật tư', unit: 'Cái',
  priceIn: 0, priceOut: 0, minStock: 0, stockByWarehouse: { wh1: stock },
});

describe('getItemSelectionResults', () => {
  it('returns the first 50 eligible matches and the complete match count', () => {
    const items = Array.from({ length: 51 }, (_, index) => item(String(index + 1), `Vật tư ${index + 1}`));
    expect(getItemSelectionResults(items, { query: '', allowAllItems: true })).toEqual({
      items: items.slice(0, ITEM_SELECTION_RESULT_LIMIT), totalMatches: 51,
    });
  });

  it('keeps accent-insensitive matching and excludes zero warehouse stock', () => {
    const items = [item('1', 'Xi măng', 5), item('2', 'Xi măng dự phòng', 0), item('3', 'Cát vàng', 4)];
    expect(getItemSelectionResults(items, { query: 'xi mang', filterWarehouseId: 'wh1', allowAllItems: false })).toEqual({
      items: [items[0]], totalMatches: 1,
    });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/__tests__/itemSelectionSearch.test.ts`

Expected: FAIL because module `../itemSelectionSearch` does not exist.

- [x] **Step 3: Write minimal implementation**

```ts
import type { InventoryItem } from '../types';
import { matchesSearchQueryMultiple } from './searchUtils';

export const ITEM_SELECTION_RESULT_LIMIT = 50;

export function getItemSelectionResults(items: InventoryItem[], options: { query: string; filterWarehouseId?: string; allowAllItems: boolean }) {
  const matches = items.filter(item => {
    const matchesSearch = matchesSearchQueryMultiple([item.name, item.sku], options.query);
    if (options.allowAllItems) return matchesSearch;
    if (options.filterWarehouseId) return matchesSearch && (item.stockByWarehouse[options.filterWarehouseId] || 0) > 0;
    return matchesSearch;
  });
  return { items: matches.slice(0, ITEM_SELECTION_RESULT_LIMIT), totalMatches: matches.length };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/__tests__/itemSelectionSearch.test.ts`

Expected: PASS with 2 passing tests.

- [x] **Step 5: Commit**

```bash
git add lib/itemSelectionSearch.ts lib/__tests__/itemSelectionSearch.test.ts
git commit -m "feat: limit material picker search results"
```

### Task 2: Use the tested helper in the shared modal

**Files:**

- Modify: `components/ItemSelectionModal.tsx:1-167`
- Test: `lib/__tests__/itemSelectionSearch.test.ts`

**Interfaces:**

- Consumes: `getItemSelectionResults(items, { query, filterWarehouseId, allowAllItems })` and `ITEM_SELECTION_RESULT_LIMIT`.
- Produces: a modal that maps only the capped result, reports the complete count, and waits 250 ms after an input edit before recalculating results.

- [x] **Step 1: Update `ItemSelectionModal`**

```tsx
const [searchTerm, setSearchTerm] = useState('');
const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

useEffect(() => {
  const timer = window.setTimeout(() => setDebouncedSearchTerm(searchTerm), 250);
  return () => window.clearTimeout(timer);
}, [searchTerm]);

const { items: filteredItems, totalMatches } = useMemo(
  () => getItemSelectionResults(items, { query: debouncedSearchTerm, filterWarehouseId, allowAllItems }),
  [allowAllItems, debouncedSearchTerm, filterWarehouseId, items],
);
```

Render a status line below the toolbar when `totalMatches > ITEM_SELECTION_RESULT_LIMIT`. It must show `Đang tìm vật tư...` while the raw and debounced query differ; otherwise show the total count, the 50-row display limit, and instruct the user to enter more SKU/name text. Use `filteredItems` in the table body.

- [x] **Step 2: Run focused test to verify it passes**

Run: `npm test -- lib/__tests__/itemSelectionSearch.test.ts`

Expected: PASS with 2 passing tests.

- [x] **Step 3: Run type check and production build**

Run: `npm run lint && npm run build`

Expected: both commands exit 0; Vite emits the regular bundle report.

- [x] **Step 4: Commit**

```bash
git add components/ItemSelectionModal.tsx lib/itemSelectionSearch.ts lib/__tests__/itemSelectionSearch.test.ts
git commit -m "feat: debounce shared material picker"
```
