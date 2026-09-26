# Resource usage evidence — implementation handoff

Plan: `docs/superpowers/plans/2026-09-23-daily-log-resource-evidence-supplier-payment-readiness.md`.
Approved design: `docs/superpowers/specs/2026-09-23-daily-log-wbs-progress-resources-cost-design.md`.
Plan 1 Completion Gate was reached at `63ff0b4` before this work started.

This implementation is read-only evidence for verified Daily Log WBS summaries.
The Payment Room action is `view_resource_evidence`; it does not inherit generic
Payment view, cost or mutation rights. The public read model is
`get_verified_resource_usage_evidence_v1`, guarded by exact project/site and the
action. It returns physical labor/machine quantities, provider snapshots,
summary source/contribution/WBS lineage, revision state, current-only totals,
unknown legacy count and keyset cursor. Superseded revisions are opt-in history.

The future payment feature may reference `resourceLineId` as evidence identity.
Unit prices, amounts, accruals, approval, matching and project transactions
belong exclusively to that separate feature; they must never be written back
to the Daily Log or to its evidence payload. Provider snapshots remain readable
if a BusinessPartner is later inactive. Manual providers are not implicitly
converted into catalog partners. Legacy semantics-1 rows stay unchanged and
are not backfilled from guesses.

Cloud pilot and rollback instructions are in
`docs/runbooks/erp-completion-pilot-rollout.md`; measured evidence and desktop,
tablet, mobile screenshots are in
`docs/superpowers/evidence/2026-09-25-resource-usage-evidence-pilot.md`.
The authorized test branch is back at `audit_only` with no active test grant.
Production rollout still requires its own cohort, owner, expiry process and
business-user signoff. Do not reuse the global test-branch binding as a
multi-project rollout mechanism.
