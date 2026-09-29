# Task 3 — whole-source physical quantity save

Scope: approved [UX plan](../plans/2026-09-26-daily-log-user-centered-ux-revision.md), Task 3 only. Isolated branch `codex/daily-log-bootstrap-integration`; no Project V2/Procurement/BOQ edits, no push/merge/deploy/enforced rollout. This is command/service foundation, **not completed ERP UX or user acceptance**.

## Implemented contract

- One quantity input mode: daily, cumulative, or percentage. Existing decimal parser reused unchanged; blank/NaN never become zero. Client derivation100/40+12→52m³/52%/12m³; equivalent cumulative/percentage entries.
- Checked `save_daily_log_source_document_v2(jsonb)` saves content/issues/photos/work/resources in one transaction. Canonical Room edit, server actor, own v2 draft/returned source, optimistic rowVersion, rollout/cutover, daily/weekly locks, scoped leaf/BOQ, baseline fingerprint and forecast reason checks. Submitted/included/verified-effective sources are immutable through this command.
- Safe blank item inputs and valid resource inputs remain in `source_draft_payload`; only complete quantity rows project into normalized work/resources. Task4 submit must reject incomplete drafts. No shared legacy numeric constraint relaxation, false progress zero or guessed backfill.
- Area code remains creation identity; display name may change. Existing work-row ID is retained for an unchanged task. Metadata-only saves affect the source fingerprint. Old summary snapshots are not edited by source saves.
- Server-issued area contexts/fingerprints include scoped plans, prior/next official history and accepted snapshots actually kept in verified decisions. Global-only history, ambiguous/unallocated areas and mismatched unit/basis remain unknown. Day-one baseline0 requires a valid unit and positive plan; otherwise all quantities, including starting quantity, remain null.
- Existing canonical progress rule decides leaf over-completion; no invented database allow flag, no client authorization. `quantityBaselines.allowOver100` tells the future editor which existing rule applies. Strict baseline/next comparisons prevent a rounding tolerance from admitting negative daily usage.
- Physical provider validation occurs before replacement; server recomputes40 labor-hours/12 machine-hours. Money/accrual/transaction keys are rejected throughout the JSON structure without rejecting literal words in notes. No new price writes.

## Cloud verification

Only `baseline-vioo-git`, ref `oymkraihhqahqvzahhtx`, using the existing `.env` credentials in memory. No local/Docker or production database writes.

Four CLI-generated Task3 migrations were applied sequentially, never editing applied SQL:

1. `20260926113919_daily_log_source_quantity_entry_v2.sql` — quantity context and atomic save foundation.
2. `20260926163158_daily_log_source_save_conflict_http_v2.sql` — public v2 conflict HTTP adapter.
3. `20260926163810_daily_log_source_entry_bounds_v2.sql` — strict deltas and existing canonical leaf rule.
4. `20260926164443_daily_log_source_missing_basis_null_v2.sql` — unknown starting quantity when conversion basis is missing.

Strict temporary CLI staging included exact recorded history plus only approved pending Daily Log files. Every dry-run matched its expected pending set. Ordinary `db push`, no include-all/repair/history edits/roles/seed. Remote history33→37; each prefix unchanged. Temporary staging directories alone were removed.

- Final12/12 rollback SQL smokes pass against applied schema: new whole-source, allocated area, returned-save/verified boundary; existing selection/foundation/publication/Room/shadow/cutover/returned-summary/evidence regressions.
- New checks include100/40+12; equivalent modes; comma decimals; no-history vs global-only unknown; missing unit/plan; excluded decision snapshot; real foreign-scope leaf; stale fingerprint/version; negative/below-baseline/above-next including tiny decimals; forecast reason; missing/invalid/conflicting provider; money keys; blank draft; metadata/photo reload; failed whole-save rollback; returned save without browser bypass; other-author and verified-effective denial.
- Real anon-key + Auth EMPLOYEE session: `is_admin=false`; two concurrent saves of A give one success and one HTTP409 `ROW_VERSION_CONFLICT`; A does not change B, then B saves independently. Metadata/photos reload; A retains one labor40h and one machine12h row. Invalid money save changes neither metadata nor rows. Official log/progress/transaction counts unchanged. No service-role command persona; service role used only to obtain a test Auth login, no user/password changes.
- Reused Task2 test drafts only: A `4308aec9-8cfd-4378-af32-ee2e78e6397e` version6; B `4fd1cca2-dc16-4e04-870a-73bdb0628ed5` version4; both draft/version2 on2099-02-02. No extra source fixtures persisted. All SQL fixture writes rolled back. Latest own Auth smoke signs out only its own test session.
- Security advisors61 baseline WARNs before/after, **zero new warnings**. Final read-only check: zero active/aborted source-save backends. Dev4197 remains HTTP200; UI integration remains Tasks5–7.

## REST conflict failure and correction

The first real Auth concurrency runs exposed a genuine HTTP gate failure: SQL40001 optimistic conflict retried indefinitely in the REST server, while the successful save committed. Instrumented requests and exact backend identity isolated it. This matches [Supabase's documented PostgREST40001 retry issue](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).

The new invoker adapter maps only custom `ROW_VERSION_CONFLICT`/`SOURCE_CHANGED` into PT409, preserving other exceptions and all v1 commands. A bounded30-second test fetch prevents silent hangs. Exact test backend2342071 was terminated after checking authenticator/RPC/backend-start; another confirmed test backend2341372 was targeted only while matching those conditions and later disappeared. No project restart or unrelated backend termination. Final Auth run finishes in4.8 seconds with HTTP409; no loop remains. These failed runs were not counted as passing gates.

## Local gates and limitations

- TDD RED→GREEN: rules/service/dictionary/errors; missing server RPC; strict whole-source/area/returned/verified/provider/money/basis cases; real REST conflict timeout→HTTP409.
- Full `npm test`: **2435 passed**,507 passed files;2 pre-existing skipped tests/files. No new UX skips.
- `npm run lint`: exit0. `npm run build`: exit0; existing large-chunk warning remains.
- Migration baseline:131 active/402 archived SQL files. Query audit:0 findings/errors/unclassified/missing policies. `git diff --check`: clean.
- Static SQL tests are boundary guards only; behavioral evidence is the Cloud SQL/Auth tests, not source-string assertions.
- Single author review only; independent final review is not claimed. No completed engineer/CHT UI, responsive walkthrough, submit/resubmit command or user acceptance yet. Those remain Tasks4–8.
