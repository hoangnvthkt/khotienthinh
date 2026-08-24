# Contributing

## Required checks

Use the Node version in `.nvmrc`, then run:

```bash
npm ci
npm run lint
npm test
npm run build
```

Run `npm run qa:pwa` when changing service-worker, PWA or build configuration.

## Database and Edge Functions

This repository uses Supabase Cloud. Do not use Supabase local development or Docker for repository work. Make database changes as a new timestamped migration in `supabase/migrations/`; do not edit an already-applied migration.

Before running a SQL smoke test, review the script and ensure the linked project is an approved isolated test or audit project. Smoke tests may create or modify records.

## Pull-request expectations

- Keep a change focused and document user-visible or schema-impacting changes.
- Add or update tests for changed logic.
- Do not commit generated build output, local environment files, credentials or production exports.
- Run the required checks locally; CI must also pass.
- For access-control changes, identify the affected RLS policy, database function or Edge Function authorization check.
