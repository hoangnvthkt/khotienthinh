-- Request command functions intentionally run with a restricted search path.
-- pgcrypto is installed in `extensions` on Supabase Cloud, so include only
-- that trusted schema for the digest() calls used by idempotency hashing.
alter function app_private.submit_request(uuid, text, text, jsonb, jsonb, text)
  set search_path = extensions;

alter function app_private.act_on_request(uuid, text, text, jsonb, uuid, text, timestamptz)
  set search_path = extensions;
