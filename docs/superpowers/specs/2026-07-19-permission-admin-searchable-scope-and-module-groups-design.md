# Permission Admin Searchable Scope And Module Groups Design

Date: 2026-07-19
Status: approved direction from operator

## Problem

Permission administration currently exposes several technical details directly
to operators:

- Principal selection is a plain dropdown, so finding an employee by name or
  email is slow.
- Scope IDs such as project, warehouse, construction site, and department IDs
  must be typed manually.
- Business Role permission editing is a long flat action list, so operators
  must scroll through dozens of low-level permission codes.

This makes the permission UI correct but hard to operate.

## Goals

- Let operators search principals by name and email.
- Let operators choose project, warehouse, construction site, and department
  scopes by human-readable name/code while preserving the backend `scopeId`.
- Keep a raw ID fallback for unavailable lookup data.
- Group Business Role permissions by application and module.
- Add search and selected-only filters to the Business Role editor.
- Keep Direct Grant and Business Role changes governed by the existing preview
  and save RPCs.

## Non-Goals

- No Supabase migration.
- No Cloud mutation during implementation.
- No change to authorization semantics, readiness, SoD, or audit contracts.
- No automatic role assignment.
- No hidden permission templates or presets.

## UX Design

The Settings authorization principal selector becomes a searchable picker that
shows the user's name and email. The selected value remains the principal's
`userId`.

The shared permission scope picker keeps the same scope types, but when a scope
requires an entity ID it shows a searchable entity picker:

- `project`: search by project code, project name, and client name.
- `warehouse`: search by warehouse name and code/type where available.
- `construction_site`: search by construction site name/code.
- `department`: search by organization unit name/code where type is
  `department`.

For `global`, `own`, and `assigned`, the picker continues to store `*` and does
not require an entity lookup.

The Business Role editor replaces the flat action list with application/module
groups. Modules are collapsed by default unless they contain selected actions or
match the search query. Each module header shows its selected count. Operators
can search by application label, module label, action label, or permission code,
and can toggle "Chỉ hiện quyền đã chọn".

When the operator checks a new action in a Business Role, the action receives
the current default scope from the scope picker. Selected actions show their
scope in readable form and can still be changed individually through the same
scope picker pattern.

## Data Flow

`permissionScopeLookupService` performs read-only lookup queries for projects,
warehouses, construction sites, and departments. It returns normalized options:

```ts
interface PermissionScopeLookupOption {
  id: string;
  label: string;
  subtitle?: string;
  searchText: string;
}
```

Containers load lookup options once and pass them to scope picker components.
If lookup loading fails, the UI keeps the existing raw ID field visible and
shows a concise fallback message.

## Components

- `PrincipalSearchSelect`: wraps the existing `SearchableSelect` for
  `AuthorizationPrincipal`.
- `PermissionScopePicker`: upgraded to support lookup options and raw fallback.
- `BusinessRoleEditor`: renders grouped permissions through a small view model
  instead of a flat action map.
- `businessRolePermissionCatalogViewModel`: builds application/module/action
  groups, search results, selected counts, and selected-only visibility.

## Testing

Tests will use TDD:

- Source/contract tests for searchable principal picker usage in
  `SettingsAuthorizationGovernance`.
- Unit tests for `PermissionScopePicker` source contract and lookup fallback.
- Unit tests for Business Role grouping/search view model.
- Source contract tests to ensure `BusinessRoleEditor` no longer renders one
  flat `editableActions.map` list.
- Focused regression for permission admin UI contracts.

## Rollout

This is a frontend UX correction only. Existing backend preview/apply commands
remain the security boundary.
