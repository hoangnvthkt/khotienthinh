# Vioo

Vioo is an internal operations platform for construction and enterprise teams. It brings together inventory, procurement, project execution, workforce, finance, quality, and operational workflows in one web application.

This repository is proprietary. See [LICENSE](LICENSE).

## Technology

- React 18, TypeScript, Vite and Vitest
- Supabase Cloud: Auth, Postgres, Row Level Security, Storage and Edge Functions
- Vercel for SPA hosting

## Repository map

| Path | Purpose |
| --- | --- |
| `components/`, `pages/`, `context/`, `hooks/`, `lib/` | Browser application and domain logic |
| `supabase/migrations/` | Versioned database schema, RLS policies and database logic |
| `supabase/functions/` | Supabase Edge Functions |
| `supabase/tests/` | SQL smoke tests |
| `docs/` | Product, operational and design documentation |

Further details are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Local setup

### Prerequisites

- Node.js 24.13.1 (see `.nvmrc`)
- npm 11+
- A Supabase Cloud project to run connected database smoke tests

Install dependencies and start the application:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The browser application needs only public Supabase settings. Do not put service-role, AI-provider, VAPID private, or other privileged secrets in browser environment files.

## Validation

```bash
npm run lint
npm test
npm run build
npm run qa:pwa
```

Database smoke tests use the linked **Supabase Cloud** project and can mutate test data. Read the relevant SQL file and use an isolated audit/test project before running them.

## Security and audits

- Read [SECURITY.md](SECURITY.md) before reporting a vulnerability.
- Use [AUDIT_SCOPE.md](AUDIT_SCOPE.md) to freeze the reviewed revision and agree access boundaries.
- Never commit `.env` files, private keys, Supabase service-role keys, or production data.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the expected workflow and checks.
