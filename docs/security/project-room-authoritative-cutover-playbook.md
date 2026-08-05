# Project Room authoritative cutover playbook

This is the reusable release contract proven by Daily Log, Material PO and
Material Request. Module/submodule permission opens a product shell; a Room in
the exact project/site scope grants business data and workflow actions.

## 1. Define the Room contract

1. Map every UI operation to one Room action. Do not let `manage`, tab admin,
   ownership or workflow-template administration imply another action.
2. Record PBAC mappings in the Room binding registry and add
   `prerequisite_action_codes` (normally mutations require `view`).
3. Keep unverified actions `audit_only`; move only end-to-end verified actions
   to `pilot`, then `enforced` after acceptance.
4. Separate actor override from recipient eligibility. System Admin may act but
   is never an implicit recipient.

## 2. Migrate safely

1. Create migrations with `supabase migration new`.
2. Backfill by safe union only for an active user and one unambiguous active
   `project_staff` row in the matching scope.
3. Add prerequisites during backfill. Preserve `manual_room`; label only newly
   converted actions `pbac_backfill`.
4. Keep PBAC for audit, disable per-action fallback, reject new PBAC grants and
   preserve old cutover grants when unrelated permissions are saved.
5. Allow an empty Room. Validate required recipients when a workflow runs.

## 3. Enforce every path

1. Frontend derives independent capabilities from
   `get_my_project_room_actions`, never PBAC/module/tab grants.
2. Parent RLS requires Room `view`; mutations require the exact action plus
   owner, state, assignment and scope constraints.
3. Recipient checks use the pure Room helper, not admin or fallback.
4. A trigger protects workflow/status/assignment columns from direct REST.
5. Child tables authorize through the parent. System sync paths stay separate,
   narrow and audited.
6. Other Rooms use minimal projections, not full business documents.

## 4. Verify and release

1. Test Room-only allow and PBAC/module/owner/participant-only deny, including
   wrong project/site, inactive staff, empty Room and missing prerequisites.
2. Run branch Vitest, lint, build, SQL smoke, audit matrix and advisors.
3. Snapshot bindings, Room sources, PBAC, policies and function definitions.
4. Dry-run Cloud in a transaction and roll it back before the real apply.
5. Keep actions `pilot` during acceptance. Roll back by enabling per-action
   fallback and restoring policy/function snapshots while retaining audit data.
