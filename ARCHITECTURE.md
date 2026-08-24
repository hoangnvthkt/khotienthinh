# Architecture

## Overview

Vioo is a TypeScript single-page application (SPA). The browser is served by Vercel and communicates with Supabase Cloud for identity, data, storage and server-side workflows.

```text
Browser (React / Vite PWA)
        |
        | public Supabase URL + anon key; authenticated user JWT
        v
Supabase Cloud ── Postgres + RLS policies
        |       ├─ Auth
        |       ├─ Storage
        |       └─ Edge Functions ── privileged integrations / AI providers
        v
Vercel ── static SPA hosting and route rewrite
```

## Application layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| Presentation | `pages/`, `components/` | Screens, interaction patterns and user feedback |
| State and workflow | `context/`, `hooks/` | Authentication, app state and workflow coordination |
| Domain/data access | `lib/` | Business rules, Supabase queries, import/export and offline support |
| Database | `supabase/migrations/` | Schema, constraints, functions, RLS policies and audit-related data logic |
| Server-side integration | `supabase/functions/` | Privileged workflows, notifications, document URLs, account administration and AI integration |

Main business areas include inventory, procurement, projects, workforce/HRM, finance, quality, document workflows and reporting.

## Authentication and authorization

The frontend initializes Supabase with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, which are public client configuration values. `AuthContext` validates a Supabase user session and loads the active internal user profile plus active permission grants.

Authorization must be enforced by database Row Level Security (RLS), database functions, and Edge Function checks; frontend conditions are usability controls only. Privileged operations that require `SUPABASE_SERVICE_ROLE_KEY` run inside Edge Functions and must never run in the browser.

## Secrets and external services

Browser configuration is restricted to `VITE_*` public values. Privileged Supabase, AI-provider and VAPID secrets are configured as Supabase Cloud secrets for Edge Functions. The repository contains variable names and runtime guards, not secret values.

The AI integration is invoked server-side through the `ai-assistant` Edge Function. Any AI-provider credentials must remain within the Edge Function environment.

## Deployment and change control

- SPA deployment configuration: `vercel.json`
- Database change history: `supabase/migrations/`
- Edge Function configuration: `supabase/config.toml` and function-local `deno.json` files
- CI checks: `.github/workflows/ci.yml`

For an audit, identify the exact Git tag or commit in [AUDIT_SCOPE.md](AUDIT_SCOPE.md). Production infrastructure, secrets and customer data are not included in repository access.
