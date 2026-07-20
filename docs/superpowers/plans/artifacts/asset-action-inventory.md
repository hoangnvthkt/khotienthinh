# Asset Action Permission Inventory

Date: 2026-07-20
Branch: `refactor/module-du-an-v1`

## Branch Check

`git branch --show-current` returned:

```text
refactor/module-du-an-v1
```

## Frontend Operation Inventory

| Operation | Page/handler | Context method | Supabase path today | Required permission | Required scope |
| --- | --- | --- | --- | --- | --- |
| Create asset | `pages/ts/AssetCatalog.tsx:handleSave` when no editing asset | `addAssetWithInitialStock` | `rpc:create_asset_with_initial_stock` | `asset.catalog.create` | target warehouse, target department when present |
| Edit asset | `pages/ts/AssetCatalog.tsx:handleSave` existing asset, `pages/ts/AssetProfile.tsx` maintenance side actions | `updateAsset` | `syncToSupabase('assets', asset)` | `asset.catalog.edit` | asset warehouse, managing department, assigned user |
| Delete asset | `pages/ts/AssetCatalog.tsx:handleDelete` | `removeAsset` | direct delete from `assets` context path | `asset.catalog.delete` | asset warehouse, managing department, assigned user |
| Dispose asset | `pages/ts/AssetCatalog.tsx:handleDispose` | `updateAsset` | `syncToSupabase('assets', asset)` | `asset.catalog.dispose` | asset warehouse, managing department, assigned user |
| Import create asset | `pages/ts/AssetCatalog.tsx:handleBulkImport` create mode | `addAssetWithInitialStock` | `rpc:create_asset_with_initial_stock` | `asset.catalog.import` + `asset.catalog.create` | target warehouse, target department when present |
| Import update asset | `pages/ts/AssetCatalog.tsx:handleBulkImport` update mode | `updateAsset` | `syncToSupabase('assets', asset)` | `asset.catalog.import` + `asset.catalog.edit` | asset warehouse, managing department, assigned user |
| Transfer stock | `pages/ts/AssetCatalog.tsx:handleBatchTransfer` and legacy local transfer path | `transferAssetStock`, `addAssetTransfer` | `rpc:transfer_asset_stock`; fallback direct writes to `asset_transfers` and `asset_location_stocks` | `asset.catalog.transfer_stock` | source warehouse/user and destination warehouse/user |
| Create asset category | catalog quick category flows | `addAssetCategory` | `syncToSupabase('asset_categories', cat)` | `asset.catalog.edit` | global or catalog admin scope |
| Update asset category | catalog quick category flows | `updateAssetCategory` | `syncToSupabase('asset_categories', cat)` | `asset.catalog.edit` | global or catalog admin scope |
| Delete asset category | catalog category flows | `removeAssetCategory` | direct delete from `asset_categories` context path | `asset.catalog.edit` | global or catalog admin scope |
| Assign asset | `pages/ts/AssetAssignment.tsx:handleAssign` | `addAssetAssignment` + `updateAsset` | `syncToSupabase('asset_assignments', row)` then `syncToSupabase('assets', asset)` | `asset.assignment.assign` | asset warehouse, assigned target user |
| Return asset | `pages/ts/AssetAssignment.tsx:handleReturn` | `addAssetAssignment` + `updateAsset` | `syncToSupabase('asset_assignments', row)` then `syncToSupabase('assets', asset)` | `asset.assignment.return` | asset warehouse, current assigned user |
| Transfer assignment | `pages/ts/AssetAssignment.tsx:handleTransfer` | `addAssetAssignment` + `updateAsset` | `syncToSupabase('asset_assignments', row)` then `syncToSupabase('assets', asset)` | `asset.assignment.transfer` | source assigned user and destination assigned user |
| Create maintenance | `pages/ts/AssetMaintenance.tsx:handleSave`, `pages/ts/AssetProfile.tsx:handleAddMaintenance` | `addAssetMaintenance` | `syncToSupabase('asset_maintenances', row)` then `syncToSupabase('assets', asset)` | `asset.maintenance.create` | asset warehouse, managing department, assigned user |
| Complete maintenance | `pages/ts/AssetMaintenance.tsx:handleComplete` | `updateAssetMaintenance` | `syncToSupabase('asset_maintenances', row)` then `syncToSupabase('assets', asset)` | `asset.maintenance.complete` | asset warehouse, managing department, assigned user |
| Import maintenance | `pages/ts/AssetMaintenance.tsx:handleExcelImport` | `addAssetMaintenance` | `syncToSupabase('asset_maintenances', row)` then `syncToSupabase('assets', asset)` | `asset.maintenance.import` + `asset.maintenance.create` | asset warehouse, managing department, assigned user |
| Perform audit | `pages/ts/AssetAudit.tsx:handleSaveAudit` | local React state only | no Supabase persistence today | `asset.audit.perform` | filtered/audited asset scopes |
| Export audit | `pages/ts/AssetAudit.tsx:exportSessionToExcel`, `pages/ts/AssetReports.tsx:handleExportExcel` | none | client export | `asset.audit.export` + `asset.audit.view` | current report/audit visible scope |

## Linked Database Tables

Tables discovered by linked schema query:

- `assets`
- `asset_categories`
- `asset_assignments`
- `asset_location_stocks`
- `asset_maintenances`
- `asset_transfers`
- `users`
- `warehouses`

No linked tables named `asset_audit_sessions` or `asset_audit_items` were returned. Current audit history is frontend-local.

## Important Column Types

- `users.id`: `uuid`
- `assets.id`: `text`
- `assets.warehouse_id`: `text`
- `assets.assigned_to_user_id`: `text`
- `assets.status`: enum `asset_status`
- `asset_location_stocks.assigned_to_user_id`: `text`
- `asset_location_stocks.warehouse_id`: `text`
- `asset_location_stocks.dept_id`: `text`
- `asset_assignments.type`: enum `asset_assignment_type`
- `asset_assignments.user_id`: `text`
- `asset_maintenances.status`: enum `maintenance_status`

## Enum Values

`asset_assignment_type`:

- `assign`
- `return`
- `transfer`

`asset_status`:

- `AVAILABLE`
- `IN_USE`
- `MAINTENANCE`
- `BROKEN`
- `DISPOSED`

`asset_category_type`:

- `machinery`
- `equipment`
- `vehicle`
- `it`
- `furniture`
- `other`

## Existing Asset RPCs

- `app_private.asset_has_action(p_permission_code text, p_warehouse_id text, p_department_id text, p_assigned_user_id uuid, p_user_id uuid)`
- `public.create_asset_with_initial_stock(p_asset jsonb)`
- `public.transfer_asset_stock(p_asset_id text, p_from_stock_id text, p_qty integer, p_to_warehouse_id text, p_to_user_id text, p_reason text, p_date text)`
- `public.next_asset_code()`
- `public.next_asset_transfer_code()`

Current `create_asset_with_initial_stock` and `transfer_asset_stock` still use `public.is_module_admin('TS')` in the historical migration.

## Existing Asset Policies

The linked DB has broad active actor policies:

- `assets_active_actor_gate`: `ALL` to `authenticated`, allows any non-null `current_app_user_id()`
- `asset_categories_active_actor_gate`: `ALL` to `authenticated`, allows any non-null `current_app_user_id()`
- `asset_assignments_active_actor_gate`: `ALL` to `authenticated`, allows any non-null `current_app_user_id()`
- `asset_maintenances_active_actor_gate`: `ALL` to `authenticated`, allows any non-null `current_app_user_id()`
- `asset_location_stocks_active_actor_gate`: `ALL` to `authenticated`, allows any non-null `current_app_user_id()`
- `asset_transfers_active_actor_gate`: `ALL` to `authenticated`, allows any non-null `current_app_user_id()`

The linked DB also has older admin policies:

- `assets_select`: public select true
- `assets_write/update/delete`: public `is_admin()`
- `asset_categories_select`: public select true
- `asset_categories_write/update/delete`: public `is_admin()`
- `asset_assignments_select`: public select true
- `asset_assignments_write/update/delete`: public `is_admin()`
- `asset_maintenances_select`: public select true
- `asset_maintenances_write/update/delete`: public `is_admin()`
- `asset_location_stocks_select`: authenticated select true
- `asset_location_stocks_insert/update/delete`: authenticated `is_module_admin('TS')`
- `asset_transfers_select`: authenticated select true
- `asset_transfers_insert/update/delete`: authenticated `is_module_admin('TS')`

Security implication: the `*_active_actor_gate` policies currently make direct authenticated writes possible on Asset tables whenever `current_app_user_id()` resolves, even if UI denies the action. The backend plan must drop or replace these policies before claiming enforcement.

## Migration Notes From Inventory

- Because `asset_location_stocks.assigned_to_user_id` and `assets.assigned_to_user_id` are `text`, SQL guards must cast safely when comparing to `uuid` users: use `nullif(value, '')::uuid` only after validating uuid shape, or compare through `users.id::text`.
- `asset_location_stocks` uses `dept_id`; `assets` uses `managing_dept_id` in code/migration history but the linked schema output did not show `managing_dept_id`. Re-check linked DB before using `managing_dept_id` in policies/RPCs.
- Since audit has no persistence table today, `asset.audit.perform` can only be UI/handler enforced until a real audit persistence migration is added.
- Transfer enforcement must check both source stock (`asset_location_stocks.warehouse_id`, `dept_id`, `assigned_to_user_id`) and destination target (`p_to_warehouse_id`, `p_to_user_id`).
