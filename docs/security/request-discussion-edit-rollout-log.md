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
- Focused `origin/main` integration branch: 391 files / 1,862 tests passed; TypeScript, production build and `git diff --check` passed.
- Client contract includes runtime collaboration, attachment validation, stable comment retry payloads and ordered/repeated mention tokenization.
- Cloud preview rollback suite: 5 tests passed both before and after persistent migration deployment, including real transactional submit → pending edit → revision 2 → cancelled old round → new pending assignment, mention comment create/edit, edit history and activity feed. The post-deploy run temporarily closes gates inside its transaction and restores the deployed gate state through rollback.
- Edge processor: 4 Deno tests passed; valid DOCX/XLSX accepted, renamed/macro/encrypted/zip-bomb containers and active HTML-as-text rejected. Edge entrypoint passed `deno check`.
- Persistent preview verification: both migration history records exist; revision/comment/attachment tables and public RPCs exist; comment and attachment RLS are enabled; `request-attachments` is private; all four gates are enabled.
- Edge Function `request-attachment-processor` is deployed to preview and its unauthenticated probe returns HTTP 401 at the expected boundary.
- Frontend preview: `https://khotienthinh-719en2tgu-hoangnvthkts-projects.vercel.app`. The deployed bundle contains the discussion/edit UI and preview Supabase ref, and does not contain the production Supabase ref.
- Browser automation remains blocked because the computer-use state exposes no controllable browser surface; no visual screenshot is claimed.

## Production integration

- A direct Supabase branch merge was rejected during preflight: the generated preview-to-production diff contained 107 `DROP TABLE`, one `DROP COLUMN` and eight `TRUNCATE` occurrences outside the approved Request scope.
- The safe scoped integration applied only `20260914045955` and `20260914045956` to Cloud main in one transaction and recorded both versions in `supabase_migrations.schema_migrations`.
- Post-deploy read-only verification confirms the revision, comment and attachment tables plus the update/comment RPCs exist on Cloud main.
- `request-attachment-processor` is `ACTIVE` on Cloud main; an unauthenticated production probe returns HTTP 401.
- The focused release was fast-forwarded to `main` at `f3f68c1`. The integration excludes unrelated procurement history and does not touch the existing local edits in `lib/companyProcurementService.ts` or `pages/hrm/CheckIn.tsx`.
- Frontend production is Ready at `https://khotienthinh-3c240ofvn-hoangnvthkts-projects.vercel.app` and aliased to `https://khotienthinh.vercel.app`. Bundle verification found the Cloud main ref and discussion/edit UI, and found no preview ref.
- Gates were opened after backend, function and frontend verification: `discussion_read`, `discussion_write`, `attachments`, `content_edit`. A final read-back confirms all four are enabled.
- Preview branch `baseline-vioo-git` is retained for history and was not deleted.
- Secrets were read only in memory from the workspace environment; `.env` was not printed, copied or modified.

## Deployment state and rollback

- Both migrations were persistently applied to `baseline-vioo-git` in one PostgreSQL transaction and recorded in `supabase_migrations.schema_migrations`. CLI `db push` passed dry-run but its write transport failed, so the guarded direct Cloud connection was used; any SQL failure would have rolled back the whole transaction.
- The preview branch remains data-less and no production fixture user/request was created.
- Production contains only the scoped Request migrations, Edge Function and focused frontend/source integration described above; the destructive Cloud branch diff was never applied.
- Application rollback: deploy the previous frontend and disable all four gates. Keep revisions, posted comments and attached objects; cleanup only unattached/expired reservations.

## Authenticated RPC permission hotfix

- Migration `20260914075111_request_discussion_rpc_permissions.sql` fixes missing `EXECUTE` privileges on private collaboration entrypoints used by the public `SECURITY INVOKER` wrappers.
- Root cause: the original Cloud test exercised public RPCs through the administrative database connection instead of switching to role `authenticated`, so the missing function ACL was not detected before rollout.
- The regression suite now invokes comment create/edit/list, activity, mention candidates, anchor lookup and attachment reservation with role `authenticated`.
- Cloud main preflight applied the migration in a transaction, exercised authenticated read RPCs, and rolled back. After persistent deployment, all eight required function privileges read back as enabled.
- Post-deploy probes executed authenticated read RPCs in a read-only transaction and comment/attachment write RPCs in a transaction that ended with `ROLLBACK`; no probe data was retained.
