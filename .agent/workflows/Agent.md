---
description: 
---

# Project overview
- Vioo ERP for construction enterprise
- React + Vite + Tailwind
- Supabase Postgres/Auth/RLS/Realtime
- Vercel deployment
- PWA

# Critical rules
- Never apply migrations to Supabase Cloud without explicit approval.
- Never use Supabase service-role credentials in frontend code.
- Preserve existing business workflows unless the task explicitly changes them.
- Do not bypass RLS to fix permission issues.
- Do not change production configuration.
- Do not overwrite unrelated uncommitted work.

# Required verification
- npm run typecheck
- npm run lint
- npm run test
- npm run build

# Architecture expectations
- Business logic belongs in domain/service/database layers, not duplicated across UI.
- All authorization must be enforced server-side/RLS/RPC.
- Workflow transitions must be explicit and validated.