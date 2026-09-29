# Interactive Daily Log admin preview — 2026-09-26

User requested a running dev instance and an admin login for direct experience.
Cloud target is authorized `baseline-vioo-git` (`oymkraihhqahqvzahhtx`), never
production. Candidate branch is `codex/daily-log-bootstrap-integration`.

- Dev: http://127.0.0.1:4197/ ; running `tests/daily-log/cloud-vite.mjs` with
  Cloud credentials resolved from the root `.env` and guarded branch config.
- Dedicated account: `dailylog-admin-preview-20260926@example.invalid`.
  App profile `74000000-0000-4000-8000-000000000001`, role ADMIN.
  Password generated randomly, supplied only to the user, never stored in Git.
  Existing users/passwords were not changed.
- Signed-in `is_admin()` returned true; actual login form entered the ERP shell.
- Canonical project-scoped Daily Log grants have seven-day expiry. Admin staff
  and Daily Log/Payment evidence Room membership are limited to the test project.
  Deprecated permission-array/JSON fields remain null; no legacy write bypass.
- Test project `DL-WBS-PILOT-20260925` switched from paused to pilot using the
  audited operator command, retaining its existing release/cutover/owner.
  Publication stays shadow-only, not a new official-progress activation.
- Payment resource-evidence binding activated in pilot using its checked
  operator command and the explicit admin test Room grant. No payment/accrual/
  project transaction was created. Production configuration remains untouched.

Desktop browser verified an existing summary through the real ERP route:
`/#/da?projectId=DL-WBS-PILOT-20260925&tab=dailylog&dailyLogId=DL-WBS-E2E-2026-10-18`.
WBS “Bê tông móng” and manual provider “Chủ máy anh Bình” are visible.
Signed-in evidence RPC returns two sources, 40 labor hours and 12 machine hours.

## Explicit integration limitation

The full ERP Finance parent still requires an HRM construction site, while this
approved pilot project has null site scope. The real Finance/evidence route test
therefore failed with the existing HRM-link requirement. No site was fabricated,
no legacy rows were moved to a guessed site, and no application code was changed
to hide this limitation. It remains a release integration finding.

For direct Plan 2 experience, the existing acceptance page at
`/tests/daily-log/resource-evidence-fixture.html` uses the production component,
real authenticated Cloud RPC, and the same browser login storage. It is explicitly
an acceptance page, not the full ERP Finance route or a mocked data view.
The user must log in on the main dev page first. Provider drill-down, visible
40/12-hour metrics and generated source-link href were verified. End-to-end
source-link navigation from this acceptance wrapper was not verified here.

Other shell preload diagnostics included auxiliary XP RPC 404, legacy request
query 400 and governed HRM employee-directory 403. These were not repaired or
silently classified as passing outside the Daily Log task scope.

Only test-account/grant/rollout setup changed persistently. The root parallel
Project/Procurement workspace, production data, migration ledger and source
application code were not edited. The dev process is intentionally left running
for user testing. Pause/revoke this explicit preview setup after user acceptance;
no automatic cleanup or production release is inferred.
