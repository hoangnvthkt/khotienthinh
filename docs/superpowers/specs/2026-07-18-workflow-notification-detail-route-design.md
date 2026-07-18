# Workflow Notification Detail Route Design

## Problem

Workflow notifications store `/wf` as their link and put the workflow instance
identifier in metadata. The notification resolver converts that metadata into
`/wf?instanceId=<id>`. `WorkflowInstances` treats this legacy query as a request
to expand the workflow inside the list, so notification clicks display the old
inline interface instead of the dedicated instance detail page.

## Scope

- Route ordinary workflow notifications with an instance identifier to
  `/wf/instances/:id`.
- Make newly created ordinary workflow notifications persist the same detail
  route so web-push clicks behave consistently.
- Make workflow shortcuts on the Home page use the dedicated detail route.
- Preserve material-request workflow routing to the project material request.
- Preserve `/wf` as the fallback for workflow notifications without an
  instance identifier.
- Do not modify production data or add a database migration.

## Design

Add a small `buildWorkflowInstancePath(instanceId)` helper in
`notificationRoutes.ts`. It URL-encodes the identifier and returns the canonical
detail route.

`resolveNotificationPath` will use the helper whenever an ordinary workflow
notification contains an instance identifier. This immediately fixes existing
in-app notifications because their metadata already contains `instanceId`.
Material-request workflow detection remains before this rule and continues to
return the project material request route.

`WorkflowContext` will use the same helper as the default link for new ordinary
workflow notifications created on submission, transitions, and watcher tags.
Material-request contexts continue to override that default. Because
`notificationService` copies `link` into `action_url`, future web pushes will
also open the dedicated detail page.

The Home page's workflow action and tracking items will use the helper instead
of the legacy query route.

## Verification

- Unit-test old notification metadata resolving to the detail route.
- Unit-test URL encoding and workflow fallback behavior.
- Unit-test that material-request workflow notifications retain their existing
  project route.
- Add source-contract coverage for notification creation and Home shortcuts.
- Run the full test suite, TypeScript check, production build, and diff check.

## Delivery

Deliver one isolated commit based on `origin/main` and push it to `main` using
a normal fast-forward update. Do not merge the parallel refactor branch.
