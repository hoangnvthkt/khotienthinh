# Daily Log UX — Task 5 checkpoint

Date: 2026-09-27. Worktree: `daily-log-clean-integration`; branch: `codex/daily-log-bootstrap-integration`.

## Scope and result

The marker-2 engineer slip is now an explicit person/area document, not a legacy log or a summary form. It restores the complete raw draft, saves quantities/resources/content/issues/photos atomically, then submits using the returned version. An uncertain submit freezes edits and retries the same command without saving again. Submitted slips render saved snapshots as a report; returned slips display the real reason, actor and time. Legacy rendering and saving remain separate.

Daily quantity is the primary input only with a qualified unit, allocation and baseline. The other quantity columns are derived, not competing inputs. Unknown history and missing conversion bases are not displayed as zero. Resources and detail fields remain attached to the selected WBS. Source selection and area creation are explicit; A/B drafts cannot bleed into each other. Duplicate-area errors offer opening the existing slip.

Flat, scoped ERP styling uses existing Inter, teal and theme tokens. Desktop quantity columns retain their own scroll container; tablet and phone retain readable controls and clear actions. The source/date selector collapses after selection. No global design-system or Project V2/Procurement edits were made.

## Verification observed

- TDD: raw-draft restoration, quantity modes, unknown bases, return/resubmit, snapshot report and resource report failures were observed before implementation. Existing legacy behavior still passes.
- Full suite: 510 files / 2,456 tests passed; two pre-existing skips (final run 01:25 local).
- Browser interaction: five tests passed, including exact-command retry after transport failure, no second save, source isolation, duplicate-area recovery and readonly submission. These use real components with controlled HTTP responses, not Cloud acceptance.
- Real ERP / Supabase Cloud: one non-admin author test passed on `baseline-vioo-git` (`oymkraihhqahqvzahhtx`). It created A/B through the ERP, saved/reloaded `12,5`, content/issues and a long manual provider, and submitted A via the marker-2 RPC. B remained draft. Two whole-source saves, one submit, no direct status PATCH and no official progress row were observed.
- Real ERP light screenshots at 1440×900, 768×1024 and 390×844 were inspected. No whole-page horizontal overflow; preliminary engineer walkthrough only. Full light/dark and human acceptance remain Task 8.
- Typecheck passed after widening the editor bundle type to include the document contract. Build passed in 7.42s; existing large-chunk warnings remain.
- Migration inventory: 133 active / 402 archived. Query audit: no findings. No schema migration in this task.
- Final Cloud read-only cleanup check: zero Task-5 sources on the isolated test date, zero Task-5 task fixtures, zero source command receipts. CLI cache changes are excluded from the commit.

## Test harness corrections / bounded cleanup

Early ERP attempts exposed permission loading and a dismissed draft-switch confirmation. The create button now waits for permission loading; tests accept the actual discard confirmation and await asynchronous selection. Numeric SQL results are compared as numbers. Each interrupted test fixture was inspected and deleted by exact owned identity in the authorized test project; later runs completed normal scoped cleanup. No unrelated Cloud data was removed. The old static integration-source assertion was replaced by legacy render coverage plus an actual ERP routing test.

This is the Task-5 gate, not completion of the UX plan or authorization to merge/deploy. Next: Task 6, source-slip-driven consolidation.
