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

All four gates are inserted as disabled by migration. On the approved preview branch they were enabled in order: `discussion_read` → `discussion_write` → `attachments` → `content_edit`.

## Verification evidence

- Baseline before changes: TypeScript, production build and 24 targeted Request tests passed.
- Current: TypeScript passed; production build passed with the pre-existing large-chunk warning.
- Full Vitest regression with the parent `.env` loaded in memory: 397 files / 2,001 tests passed.
- Client contract includes runtime collaboration, attachment validation, stable comment retry payloads and ordered/repeated mention tokenization.
- Cloud preview rollback suite: 5 tests passed both before and after persistent migration deployment, including real transactional submit → pending edit → revision 2 → cancelled old round → new pending assignment, mention comment create/edit, edit history and activity feed. The post-deploy run temporarily closes gates inside its transaction and restores the deployed gate state through rollback.
- Edge processor: 4 Deno tests passed; valid DOCX/XLSX accepted, renamed/macro/encrypted/zip-bomb containers and active HTML-as-text rejected. Edge entrypoint passed `deno check`.
- Persistent preview verification: both migration history records exist; revision/comment/attachment tables and public RPCs exist; comment and attachment RLS are enabled; `request-attachments` is private; all four gates are enabled.
- Edge Function `request-attachment-processor` is deployed to preview and its unauthenticated probe returns HTTP 401 at the expected boundary.
- Frontend preview: `https://khotienthinh-719en2tgu-hoangnvthkts-projects.vercel.app`. The deployed bundle contains the discussion/edit UI and preview Supabase ref, and does not contain the production Supabase ref.
- Browser automation remains blocked because the computer-use state exposes no controllable browser surface; no visual screenshot is claimed.

## Deployment state and rollback

- Both migrations were persistently applied to `baseline-vioo-git` in one PostgreSQL transaction and recorded in `supabase_migrations.schema_migrations`. CLI `db push` passed dry-run but its write transport failed, so the guarded direct Cloud connection was used; any SQL failure would have rolled back the whole transaction.
- Edge Function and frontend were deployed only to preview. No persistent fixture user/request was created; the preview branch remains data-less.
- Production was not changed and the feature branch was not merged to `main`.
- Application rollback: deploy the previous frontend and disable all four gates. Keep revisions, posted comments and attached objects; cleanup only unattached/expired reservations.
