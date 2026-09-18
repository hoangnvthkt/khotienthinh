# Request cohort — owner decision record

**Captured at:** `2026-09-18T07:06:13Z`  
**Cloud:** Supabase main `ftciqmqhmfvjtwoycswe`  
**Status:** `AWAITING_OWNER_DECISION`

This is a PII-free decision gate. It is not authorization approval, does not create a template or assignment, and does not authorize a transition manifest or a compatibility-shell revoke.

## Preconditions captured

- Cloud migration dry-run returned `upToDate=true`; no migration, seed or role is pending.
- Migration baseline passed: `91` active SQL files and `402` archived SQL files.
- The readiness checker reports only `wms_manage` and `workflow` as owner-approved. Request remains one of `13` `owner_pending` cohorts.
- `WORKFLOW_USER`, `WORKFLOW_ADMIN`, `WAREHOUSE_OPERATOR` and `WAREHOUSE_MANAGER` remain technically pilot-ready; this evidence does not approve Request.

## Candidate templates from the current blueprint

| Template | Candidate actions | Scope decision required from Request owner |
| --- | --- | --- |
| `REQUEST_USER` | `request.instance.view_own`, `request.instance.create`, `request.instance.edit_own_content`, `request.instance.resubmit_own`, `request.instance.cancel`, `request.category.view`, `request.template.view` | Own for requester-owned lifecycle; explicit decision for shared category/template viewing and assignment scope. |
| `REQUEST_PROCESSOR` | `request.instance.view_all`, `request.instance.approve_assigned`, `request.instance.reject_assigned`, `request.instance.return_assigned`, `request.category.view`, `request.template.view` | Assigned for step actions; explicit decision whether request-list visibility is `assigned` or `global`, plus category/template viewing and assignment scope. |
| `REQUEST_TEMPLATE_ADMIN` | `request.instance.view_all`, `request.instance.cancel`, `request.instance.reassign`, `request.category.view`, `request.category.manage`, `request.template.view`, `request.template.manage` | Explicit global-only administration decision and assignment scope. |

The candidate set excludes `request.instance.create_draft`, `request.instance.save_draft`, and `request.instance.delete_own_draft`: no supported Request Draft command exists, so none may be approved or represented as a completed capability.

## Cloud catalog baseline

| Permission code | Readiness | Supported item scopes |
| --- | --- | --- |
| `request.instance.approve_assigned` | `enforced` | `assigned` |
| `request.instance.cancel` | `enforced` | `own`, `global` |
| `request.instance.edit_own_content` | `enforced` | `own` |
| `request.instance.reassign` | `enforced` | `global` |
| `request.instance.reject_assigned` | `enforced` | `assigned` |
| `request.instance.resubmit_own` | `enforced` | `own` |
| `request.instance.return_assigned` | `enforced` | `assigned` |
| `request.category.view` | `declared` | `global`, `own`, `assigned` |
| `request.instance.create` | `declared` | `global`, `own`, `assigned` |
| `request.instance.view_all` | `declared` | `global`, `own`, `assigned` |
| `request.instance.view_own` | `declared` | `global`, `own`, `assigned` |
| `request.template.view` | `declared` | `global`, `own`, `assigned` |
| `request.category.manage` | `legacy` | `global`, `own`, `assigned` |
| `request.template.manage` | `legacy` | `global`, `own`, `assigned` |

The seven `declared` or `legacy` rows are technical blockers. They require tested UI, route, RPC and RLS enforcement; changing metadata alone is not an acceptable resolution.

## Required Request owner attestation

The Request workflow owner must provide a dated approval that, for each of the three candidate templates:

1. identifies the intended business actor class;
2. accepts or removes every candidate capability;
3. chooses one supported item scope for every retained capability;
4. chooses a concrete assignment scope;
5. states that `system.rq.*` remains `retain_until_pilot_verified`, or provides a longer explicit retention decision;
6. names bounded pilot personas through the approved operational channel, not this Git record; and
7. sets a bounded pilot expiry policy.

The attestation must not add Draft actions, treat `system.rq.manage` as a direct grant, request legacy revocation, or substitute a broad role label for the action/scope decision.

## Decision outcome

No Request owner approval has been recorded at this checkpoint. The decision register remains `owner_pending`; no Request business role, assignment, direct grant, executable manifest, shell revoke, observation `T0`, or Task 13 action is authorized.
