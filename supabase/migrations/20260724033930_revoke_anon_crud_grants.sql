-- Migration: Revoke direct INSERT, UPDATE, DELETE privileges on public schema from role 'anon'
-- Reason: Permission Health hardening (Phase 5 security audit)

REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;
