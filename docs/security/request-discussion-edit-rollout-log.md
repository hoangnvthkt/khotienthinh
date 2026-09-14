# Request discussion/edit rollout log

## Target and safety

- Date: 2026-09-14 (Asia/Ho_Chi_Minh)
- Worktree: `procurement-workbench-spec`
- Production ref (identity check only): `ftciqmqhmfvjtwoycswe`
- Approved Cloud preview branch: `baseline-vioo-git` / `oymkraihhqahqvzahhtx`
- Supabase local/Docker: not used
- Cloud schema tests: every migration and fixture ran inside one transaction and ended with `ROLLBACK`

## Forward artifacts

- `20260914045955_request_content_revisions.sql`: feature gates, immutable revisions, revision-stamped assignments, creator edit/restart command and detail capabilities.
- `20260914045956_request_discussion_storage.sql`: comments/replies/edit audit, mention derivation, cursor APIs, private attachment reservations, cleanup fencing, notification delivery and private bucket.
- `request-attachment-processor`: image normalization/EXIF removal reused from Work, Office/PDF/TXT validation, finalize/read/cleanup and 300-second signed URLs.

All four gates are inserted as disabled. Planned enable order remains `discussion_read` → `discussion_write` → `attachments` → `content_edit`.

## Verification evidence

- Baseline before changes: TypeScript, production build and 24 targeted Request tests passed.
- Current: TypeScript passed; production build passed with the pre-existing large-chunk warning.
- Full Vitest regression with the parent `.env` loaded in memory: 397 files / 2,001 tests passed.
- Client contract includes runtime collaboration, attachment validation, stable comment retry payloads and ordered/repeated mention tokenization.
- Cloud preview rollback suite: 5 tests passed, including real transactional submit → pending edit → revision 2 → cancelled old round → new pending assignment, mention comment create/edit, edit history and activity feed.
- Edge processor: 4 Deno tests passed; valid DOCX/XLSX accepted, renamed/macro/encrypted/zip-bomb containers and active HTML-as-text rejected. Edge entrypoint passed `deno check`.
- Browser automation: blocked because the computer-use environment reported `No browser is available`; no visual screenshot is claimed.

## Deployment state and rollback

- Persistent Cloud migration was not applied. A redacted Supabase CLI dry-run against the approved preview branch failed authentication before any write.
- Edge Function was not deployed because its required schema is not persistently present on the preview branch.
- Production was not changed.
- Application rollback: deploy the previous frontend and disable all four gates. Keep revisions, posted comments and attached objects; cleanup only unattached/expired reservations.
