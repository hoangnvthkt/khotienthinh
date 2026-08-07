# Fast inventory item picker opening

## Goal

Make the shared material-selection modal responsive when the catalogue contains more than 1,200 items, without changing database schema, API behaviour, permissions, or selection semantics.

## Scope

Change the shared `ItemSelectionModal` used by WMS Operations and RequestModal. The separate `InventoryItemCombobox` is out of scope because it already renders at most 40 options.

## Behaviour

- Do not render the complete catalogue when the modal opens.
- Render at most 50 matching materials at a time.
- When the search field is empty, show the first 50 eligible items and tell the user to enter SKU or name to narrow the list.
- Debounce search input by 250 ms before recomputing the displayed result set.
- Keep the existing case- and Vietnamese-accent-insensitive matching, warehouse availability rules, stock quantities, QR scanner flow, and item selection callback.
- When more than 50 rows match, show an explicit count and a message that only the first 50 are displayed.

## Non-goals

- No database cursor/search API, migration, index, or change to global `items` loading.
- No change to `SearchableSelect` or `InventoryItemCombobox`.

## Error handling

The change is entirely client-side and retains the existing data-loading and error paths. Clearing the search query restores the first 50 eligible results.

## Verification

- Add a focused unit test for the result-limiting/filtering helper.
- Run the focused test, TypeScript check, and production build.
- Confirm the generated modal code no longer maps every eligible item into DOM rows.
