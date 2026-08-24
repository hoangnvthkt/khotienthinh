# Audit handoff scope

Complete this document before granting repository access.

| Item | Value |
| --- | --- |
| Audit revision | `TAG_OR_COMMIT_TO_BE_FILLED_IN` |
| Audit period | `DATE_RANGE_TO_BE_FILLED_IN` |
| Repository owner | `OWNER_AND_PRIVATE_CONTACT_TO_BE_FILLED_IN` |
| Auditor | `AUDITOR_TO_BE_FILLED_IN` |
| Authorized test environment | `ISOLATED_SUPABASE_CLOUD_PROJECT_ONLY` |

## In scope

- React/Vite browser application
- Supabase migrations, database functions and RLS policies
- Supabase Edge Function source and authorization design
- Dependency and build configuration
- CI configuration and repository secret-handling controls

## Out of scope unless authorized separately

- Production Supabase project, deployment accounts and cloud credentials
- Production data, backups, logs and customer files
- Third-party SaaS security outside this application’s integration boundary
- Social engineering, denial-of-service testing and destructive testing

## Access rules

1. Share a clean clone or a protected audit branch/tag; do not send a zip of the active working directory or its `.git` directory.
2. Provide synthetic test users and data only. Grant the minimum required role and set an expiry date.
3. Do not provide service-role, AI-provider, VAPID private or deployment secrets. If a test secret is necessary, create an isolated, revocable value.
4. The auditor must report findings through the private channel named above and must not disclose data or findings without written approval.

## Handoff checklist

- [ ] Working tree is clean and the audit revision is tagged.
- [ ] Secret scan covers the selected revision and reachable Git history.
- [ ] `npm run lint`, `npm test` and `npm run build` pass at the shared revision.
- [ ] `npm audit --omit=dev` findings are attached and triaged.
- [ ] README, architecture and security documentation match the shared revision.
- [ ] Access, contact, timeline and rules of engagement are agreed in writing.
