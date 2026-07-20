# Manual Permission Matrix Inventory

Date: 2026-07-19
Status: corrective implementation boundary

## Boundary

The manual permission matrix keeps the existing legacy administration mental
model but changes the new grant surface to explicit action permissions.

## Legacy manage remains compatibility-only

Legacy module and submodule administration rights remain visible as effective
Legacy evidence during migration. Broad `manage` actions are not newly
grantable from the Direct Grant matrix. They exist to explain compatibility
behavior and to guide module-by-module action splitting.

## Direct Grant matrix uses explicit action permissions

The Direct Grant matrix grants concrete actions such as `view`, `create`,
`edit`, `verify`, `approve`, `return`, `reject`, `mark_paid`, `upload`,
`delete`, and `export` only when those actions exist in the permission
registry and readiness allows new grants.

## Project is one application group, not the entire matrix

Project contains the most complex workflow surface, but the permission
administration page must also render System, WMS, HRM, Expense, Workflow,
Request, Asset, Contract, and other registered applications.

## No quick templates

The primary operator workflow has no quick templates, role presets, or custom
template editor. The operator manually checks user permissions and may copy
and paste one user's new Direct Grant draft to another user before previewing
and saving through the governed backend command.

## Backend boundary

The UI is not the security boundary. Backend RPC/RLS/module guards must deny
without effective `view` plus the requested child action, deny wrong scope,
and derive the actor server-side. This corrective pass does not add Cloud
schema or mutate grants directly.
