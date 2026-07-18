# Workflow Instance Route Access Design

## Problem

Legacy workflow permissions can grant an employee access to `/wf` while denying
the child route `/wf/instances/:id`. The workflow list then shows assigned work,
but opening a row is rejected by `SubModuleGuard` and redirects the user to `/`.
Administrators do not reproduce the issue because registered routes are open to
legacy administrators.

## Scope

- Treat the legacy `/wf` view grant as permission to open
  `/wf/instances/:id`.
- Keep workflow template and builder permissions unchanged.
- Do not modify production data, database policies, permission records, or UI.
- Do not generalize parent-route inheritance to other modules.

## Design

Add one explicit workflow-instance child-route rule to
`canOpenLegacyRoute`. The rule accepts `/wf/instances/<id>` only when the user
has `/wf` in either `allowedSubModules.WF` or `adminSubModules.WF`.

This mirrors the existing narrow exception that lets `/wf/templates` open a
workflow builder, while avoiding a broad prefix rule that could accidentally
expose workflow template administration.

## Tests

Add regression coverage to `permissionService.test.ts` for a legacy employee
whose WF submodule grant contains only `/wf`:

1. `/wf/instances/<id>` is viewable.
2. `/wf/templates` remains unavailable.
3. `/wf/builder/<id>` remains unavailable.

Run the focused permission tests, then the full test suite, TypeScript check,
and production build before committing the implementation.

## Delivery

Implement on `codex/fix-workflow-instance-route-access`, based on
`origin/refactor/module-du-an-v1`. Deliver the change as an isolated commit and
push only that branch.
