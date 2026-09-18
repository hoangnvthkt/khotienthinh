# Workflow Participant Continuity, Deep Link, and Notifications Design

**Status:** Approved in conversation on 2026-09-18; awaiting written-spec review before implementation planning
**Scope:** Generic Workflow instances in module `WF`
**Cloud target:** Supabase main `ftciqmqhmfvjtwoycswe`

## 1. Problem statement

Manual Production testing exposed three related gaps in generic Workflow:

1. A user who approves one step loses visibility after the instance advances to another assignee.
2. A Workflow instance has a database UUID and a human-readable code such as `WF-2026-172`, but it does not have a canonical detail route equivalent to Request's `/rq/:requestId`.
3. The generic Workflow notification schema and outbox exist, but delivery is disabled and the worker implementation is absent from the repository. The current client-side fallback reaches only selected recipients and cannot provide durable participant fan-out.

The concrete Production example is `WF-2026-172`: its creator can still see it; a prior approver can no longer see it after forwarding to the next approver. Redacted Cloud evidence showed that the prior approver has an `APPROVED` log, is not the creator or current assignee, and the generic instance has neither a `workflow_subject` nor a participant row. Its outbox contains three undelivered events and Workflow notification settings are disabled.

## 2. Goals

- Anyone who legitimately becomes part of a generic Workflow instance can continue following it through completion.
- Historical participation grants read/follow continuity, never permission to act on a step that is no longer assigned to that person.
- `WF-YYYY-NNN` remains the business-facing identifier; the UUID is used in the canonical detail URL `/wf/:instanceId`.
- Direct URLs load the requested instance independently of list pagination or cache state.
- Current assignees receive actionable notifications; creators, active watchers, and historical participants receive lifecycle updates.
- Generic Workflow notifications are produced and delivered by the server-side outbox pipeline, following the reliable pattern already used by Request.
- Existing Request-owned and Project-owned workflows retain their current subject-specific authorization and notification paths.

## 3. Non-goals

- Do not change Request cohort owner decisions, Request role templates, or Task 13 gates.
- Do not revoke `system.wf.*`, change the `WORKFLOW_USER`/`WORKFLOW_ADMIN` assignments, or reopen E36.
- Do not grant a historical participant the ability to approve, reject, reassign, cancel, reopen, edit, or administer an instance unless a separate current capability and record boundary allows it.
- Do not expose UUIDs as the primary business label.
- Do not replay the current disabled Workflow notification backlog to users.
- Do not merge generic Workflow participation into `public.workflow_participants`; that table requires a `workflow_subject_id` and is shared by Request/Project subject workflows.

## 4. Chosen approach

Create a dedicated generic-instance participant ledger and make it the shared source for generic Workflow visibility and notification eligibility.

Alternatives rejected:

- Deriving participation from `workflow_instance_logs` on every read tightly couples authorization to audit storage and adds repeated joins to every RLS evaluation.
- Checking only values still present in `step_assignees` is incomplete and makes future changes to assignment snapshots capable of removing historical access.
- Broad global visibility would solve the symptom by overgranting unrelated instances and is therefore unacceptable.

The participant ledger is materialized transactionally from authoritative lifecycle commands. Audit logs remain evidence, not the runtime authorization data model.

## 5. Data model

Add `public.workflow_instance_participants`:

| Column | Contract |
| --- | --- |
| `instance_id uuid` | FK to `workflow_instances(id)`, cascade on instance deletion |
| `user_id uuid` | FK to `users(id)`, cascade when the principal is deleted |
| `participant_role text` | `CREATOR`, `ASSIGNEE`, or `WATCHER` |
| `source_ref text` | Stable source reference such as node UUID, log UUID, or command idempotency key |
| `joined_at timestamptz` | First time this user acquired this participant role |
| `last_confirmed_at timestamptz` | Most recent lifecycle event confirming the role |
| `ended_at timestamptz` | Non-null only when a revocable role, currently `WATCHER`, is explicitly removed |
| `created_at`, `updated_at` | Operational timestamps |

Primary key: `(instance_id, user_id, participant_role)`.

Indexes:

- `(user_id, instance_id)` for RLS and direct-link lookup;
- `(instance_id, participant_role, ended_at)` for notification fan-out;
- partial active watcher index where `participant_role='WATCHER' and ended_at is null`.

RLS is enabled. `authenticated`, `anon`, and `PUBLIC` receive no direct select/insert/update/delete privileges. Reads and writes occur only inside private helpers called by reviewed Workflow policies and commands; this avoids exposing the ledger as a client API and avoids a recursive participant-policy/instance-policy dependency. Administrative diagnostics stay service-role/private.

### 5.1 Role lifetime

- `CREATOR` never ends while the instance exists.
- `ASSIGNEE` is historical and never ends merely because the instance advances. A prior assignee remains a participant.
- `WATCHER` is active while `ended_at is null`. Removing a watcher ends only the watcher role.
- If a removed watcher is also creator or historical assignee, those independent roles still preserve participation.
- Re-adding a watcher clears `ended_at` and updates `last_confirmed_at`; it does not create a duplicate row.

## 6. Participant lifecycle

Private helper `app_private.upsert_workflow_instance_participant(...)` validates an active application user and upserts one role. It has `security definer`, `search_path=''`, no execute grant to client roles, and rejects subject-owned instances because those keep their existing subject authorization model.

Lifecycle commands call the helper in the same transaction:

- Create draft or running instance: upsert `CREATOR`.
- Submit/create with a first step: upsert every initial assignee as `ASSIGNEE`.
- Approve, reject, request revision, reopen, or advance: preserve the acting user as `ASSIGNEE` when they acted through assignment, then upsert every newly assigned user.
- Add watchers: upsert active `WATCHER` rows.
- Remove watchers: set `ended_at` only on matching watcher rows.

No client-provided user ID is trusted as the actor. Lifecycle commands continue to derive the actor from the authenticated application principal. Assignment targets are validated as active users before participant rows are written.

### 6.1 Backfill

The migration backfills generic instances only: instances for which no `workflow_subjects` row exists.

Sources are processed idempotently:

1. `workflow_instances.created_by` → `CREATOR`;
2. current `workflow_instances.watchers` → active `WATCHER`;
3. every valid UUID found anywhere in `workflow_instances.step_assignees` → `ASSIGNEE`;
4. actors of assignment-bound lifecycle logs (`APPROVED`, `REJECTED`, `REVISION_REQUESTED`) → `ASSIGNEE`.

Invalid UUID text, inactive/missing users, system-generated logs without a user, and Request/Project-owned instances are skipped. Backfill evidence reports counts only; it does not log names, emails, UUIDs, form payloads, or comments.

For `WF-2026-172`, the prior approver is recovered from the `APPROVED` log and becomes a historical `ASSIGNEE` participant.

## 7. Authorization and visibility

Introduce a private parameterized helper:

```text
app_private.workflow_instance_user_can_select(instance_id uuid, user_id uuid) returns boolean
```

`workflow_instance_actor_can_select(instance_id)` becomes the current-user wrapper. Existing subject-owned behavior is unchanged and continues through `project_workflow_actor_can_select` or the owning subject module.

For generic instances, selection requires an active account and follows this explicit contract:

- `workflow.instance.view/global` or `workflow.instance.administer/global` provides global visibility;
- otherwise, the user must hold `workflow.instance.view` in at least one sanctioned record-bound scope (`own` or `assigned`) **and** be the creator, a current/historical `ASSIGNEE` participant, or an active `WATCHER` participant.

The participant relationship is the row boundary for non-global viewers. This deliberately preserves the approved `WORKFLOW_USER` blueprint, which currently grants `workflow.instance.view/own`, while allowing a legitimate participant to keep following an instance after assignment moves onward. It does not create or assign a new capability, and an active watcher relationship never implies action capability.

The migration does not synthesize a global capability. If a user has a participant relationship but no applicable canonical view capability, the user remains denied.

The same selector protects:

- `workflow_instances`;
- `workflow_instance_logs`;
- comments and comment attachments;
- storage objects under the instance attachment path;
- direct instance-load RPC/query;
- notification delivery eligibility.

Action authorization remains separate. `workflow_instance_actor_can_process` still requires the current assignment and `workflow.instance.act_assigned`; participant history never satisfies it.

## 8. Canonical route and business identifier

Add `lib/workflowRoutes.ts`:

```text
buildWorkflowRoute(instanceId, options?) -> /wf/:instanceId[?node=...&comment=...&event=...]
```

Register routes:

- `/wf` — list/workspace;
- `/wf/:instanceId` — canonical generic Workflow detail;
- old `/wf/instances/:id`, `/wf?instanceId=...`, `/wf?id=...`, and `/wf?wf=...` inputs redirect with `replace` to `/wf/:instanceId` while preserving supported anchors.

Static Workflow routes such as `/wf/dashboard` and `/wf/templates` remain registered ahead of the dynamic UUID route, and the detail route rejects non-UUID path values so it cannot swallow another Workflow sub-route.

The route uses UUID because it is immutable. `WorkflowInstance.code` such as `WF-2026-172` remains the visible and searchable identifier.

UI behavior:

- Show the code prominently in list rows and detail header.
- Clicking the code opens the canonical detail route.
- Provide “Sao chép liên kết” using the canonical route.
- Search continues to match code and title.
- Navigating back returns to the list state without creating a second instance selection model.

### 8.1 Direct loading

`WorkflowContext` gains a focused `loadInstanceById(instanceId)` path. When `/wf/:instanceId` is opened and the instance is absent from the bounded list cache, it loads that instance through RLS, then loads only its required template, nodes, edges, logs, and form data. A forbidden or nonexistent UUID produces the same neutral not-found/forbidden state so the UI does not leak instance existence.

The canonical route must not depend on the current list limit or on opening `/wf` first.

## 9. Notification architecture

The existing tables `workflow_notification_settings`, `workflow_notification_outbox`, and `workflow_notification_deliveries` remain. The server-side outbox becomes authoritative for generic Workflow notifications.

### 9.1 Events and recipients

| Event | Action recipient | Follow/update recipients |
| --- | --- | --- |
| Submitted/step assigned | current/new assignees | creator, active watchers, historical participants |
| Step approved/rejected/revision requested | next/revision assignees when applicable | creator, active watchers, historical participants |
| Completed/cancelled/reopened | current assignees when applicable | creator, active watchers, historical participants |
| Comment mention | mentioned users | existing participant fan-out only when the event contract requests it |
| Watcher added | newly added watcher | creator and existing eligible participants if configured by event |
| Watcher removed | removed watcher receives one removal notice | no continued watcher delivery after removal unless another role remains |

The actor is excluded from their own event. Recipients are deduplicated by user ID. Every recipient must be active and pass the parameterized instance selector, except the one-time watcher-removal notice, which contains no protected payload beyond code/title and removal fact.

Notification content includes the business code, title, event type, actor display name where applicable, and canonical detail link. It excludes form payload, private comments, tokens, email, and unrelated metadata.

### 9.2 Worker

Add `supabase/functions/process-workflow-notifications` following the Request worker pattern:

- `verify_jwt=false` at the gateway because invocation uses the Vault-held service key;
- service-role-only claim/deliver/fail RPCs remain the database authorization boundary;
- bounded claim size, `FOR UPDATE SKIP LOCKED`, retry cap, and exponential backoff;
- health endpoint that does not claim or deliver jobs;
- no secret or recipient payload in logs.

The Cron function continues calling the Edge Function once per minute. Deployment and health verification happen before notifications are enabled.

### 9.3 Client fallback removal

For generic Workflow, remove the direct React-side `notifyWorkflowUsers` lifecycle fan-out after the server worker is verified. This avoids duplicate notifications and ensures delivery does not depend on the actor keeping the browser open.

Request-owned and Material Request-owned workflow notifications keep their specialized module routes and suppression rules. Generic Workflow outbox code must continue returning zero/suppressed for those subject-owned instances.

## 10. Notification rollout

Roll out in this order:

1. Apply participant/RLS/backfill migration while Workflow notifications remain disabled.
2. Deploy frontend canonical route and direct loader.
3. Deploy the Workflow notification Edge Function and verify its health endpoint.
4. Run Cloud rollback smokes for participant visibility, action denial, outbox recipient selection, idempotency, and delivery eligibility.
5. Set `rollout_started_at` to the actual activation timestamp, then enable notifications.
6. The claim function suppresses all pre-rollout pending events, including the three existing events for `WF-2026-172`; no delayed notification burst is allowed.
7. Produce one controlled post-rollout canary event with designated test personas and verify one in-app notification per expected recipient plus the canonical deep link.
8. Verify the next Cron cycle has no stuck `PROCESSING` jobs and no duplicate delivery rows.

If health, recipient set, deep link, or delivery deduplication fails, disable settings immediately. Participant visibility and canonical routes remain independently useful and do not need rollback solely because notification delivery is paused.

## 11. Error handling

- Unknown/malformed route UUID: render neutral not-found/forbidden state and do not query related data.
- RLS denial: same neutral state; never reveal code/title.
- Missing or inactive participant user during backfill: skip and include only aggregate skipped count in evidence.
- Participant upsert failure inside a lifecycle command: fail the whole transaction so the step cannot advance without continuity data.
- Outbox enqueue occurs in the same database transaction as the lifecycle mutation. An enqueue failure rolls back the lifecycle mutation so an instance cannot advance without its durable notification event; recipient delivery remains asynchronous and may retry independently after commit.
- Worker delivery failure: return job to pending with capped backoff; after retry exhaustion mark `FAILED` without duplicating successful recipient deliveries.
- A notification pointing to an instance the recipient can no longer select is marked ineligible, not delivered.

## 12. Testing strategy

Implementation follows test-first development.

### 12.1 Static and unit contracts

- Participant migration/table/RLS/ACL contract.
- Selector distinguishes creator, historical assignee, active watcher, removed watcher, outsider, and global administrator.
- Historical participant can read but cannot act on the current step.
- Backfill recognizes an earlier approver even when no longer present in current-node assignment.
- `buildWorkflowRoute` and notification route resolution produce `/wf/:instanceId` with anchors.
- Legacy query links redirect to the canonical path.
- Direct route loads a target missing from list cache.
- Notification recipient calculation includes new assignee and eligible followers, excludes actor/outsider, and deduplicates multi-role users.
- Generic client lifecycle notifications are absent after server delivery becomes authoritative.

### 12.2 Cloud rollback smoke

Use authenticated JWT personas, not service-role bypass, to prove:

- creator reads;
- current assignee reads and acts;
- prior assignee reads after transition but cannot act;
- watcher reads while active;
- removed watcher without another role is denied;
- outsider is denied;
- global administrator reads;
- logs/comments/attachments follow the same boundary;
- backfill is idempotent;
- subject-owned Request/Project behavior is unchanged;
- outbox fan-out and delivery eligibility match participant state;
- duplicate event keys and delivery rows are idempotent.

### 12.3 Production acceptance

On the deployed SHA:

- Hương can open `WF-2026-172` using its canonical URL.
- The prior approver can still find/open/follow it after the step is assigned onward.
- The current assignee alone can perform the current approval action.
- An unrelated Workflow user cannot open it.
- A new controlled transition sends the correct notification to the next assignee and lifecycle updates to eligible followers.
- Clicking each notification opens `/wf/:instanceId` and selects the right instance.
- No old disabled-backlog event is delivered.

## 13. Security invariants

- No authorization decision uses JWT `user_metadata`.
- Private `security definer` functions use `search_path=''` and are not executable by `PUBLIC`, `anon`, or `authenticated` unless a reviewed wrapper requires it.
- New public/exposed tables have RLS enabled before grants.
- No direct client mutation of participant rows or notification outbox.
- No service-role key enters the React bundle.
- Notification metadata contains no form data, private comment body, email, or token.
- Historical participation supplies only a record relationship; capabilities remain mandatory.
- No `DROP ... CASCADE`, legacy-schema removal, Task 13 mutation, role assignment, or compatibility-shell revoke.

## 14. Delivery artifacts

Implementation will produce:

- one participant/RLS/backfill migration and Cloud smoke;
- one canonical Workflow route helper and deep-link regression suite;
- direct instance-loading support in Workflow context/workspace;
- one Workflow notification Edge Function and config entry;
- notification recipient/delivery contract tests;
- updated rollout log and handoff evidence with redacted counts;
- a Production acceptance checkpoint for the reported visibility case and a controlled notification canary.
