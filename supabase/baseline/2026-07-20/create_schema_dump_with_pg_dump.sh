#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUT_FILE="$ROOT_DIR/supabase/baseline/2026-07-20/schema_dump_before.sql"
LOG_FILE="$ROOT_DIR/supabase/baseline/2026-07-20/schema_dump_before_direct_pg_dump.log"
PG_DUMP="/Users/admin/.local/bin/pg_dump"

if [[ ! -x "$PG_DUMP" ]]; then
  echo "Missing executable pg_dump at $PG_DUMP" >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "Missing .env with SUPABASE_DB_PASSWORD" >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/supabase/.temp/pooler-url" ]]; then
  echo "Missing linked Supabase pooler URL at supabase/.temp/pooler-url" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. "$ROOT_DIR/.env"
set +a

if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo "Missing SUPABASE_DB_PASSWORD in .env" >&2
  exit 1
fi

pooler_url="$(< "$ROOT_DIR/supabase/.temp/pooler-url")"
conn="${pooler_url#postgresql://}"
export PGUSER="${conn%@*}"
rest="${conn#*@}"
export PGHOST="${rest%%:*}"
rest="${rest#*:}"
export PGPORT="${rest%%/*}"
export PGDATABASE="${rest#*/}"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
export PGSSLMODE=require

tmp_file="$(mktemp "$OUT_FILE.tmp.XXXXXX")"

"$PG_DUMP" \
  --schema-only \
  --quote-all-identifiers \
  --role postgres \
  --schema public \
  --schema storage \
  --schema auth \
  2> "$LOG_FILE" \
| sed -E 's/^\\(un)?restrict .*$/-- &/' \
| sed -E 's/^CREATE SCHEMA "/CREATE SCHEMA IF NOT EXISTS "/' \
| sed -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/' \
| sed -E 's/^CREATE SEQUENCE "/CREATE SEQUENCE IF NOT EXISTS "/' \
| sed -E 's/^CREATE VIEW "/CREATE OR REPLACE VIEW "/' \
| sed -E 's/^CREATE FUNCTION "/CREATE OR REPLACE FUNCTION "/' \
| sed -E 's/^CREATE TRIGGER "/CREATE OR REPLACE TRIGGER "/' \
| sed -E 's/^CREATE PUBLICATION "supabase_realtime/-- &/' \
| sed -E 's/^CREATE EVENT TRIGGER /-- &/' \
| sed -E 's/^         WHEN TAG IN /-- &/' \
| sed -E 's/^   EXECUTE FUNCTION /-- &/' \
| sed -E 's/^ALTER EVENT TRIGGER /-- &/' \
| sed -E 's/^ALTER PUBLICATION "supabase_realtime_/-- &/' \
| sed -E 's/^ALTER FOREIGN DATA WRAPPER (.+) OWNER TO /-- &/' \
| sed -E 's/^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"/-- &/' \
| sed -E 's/^GRANT ALL ON FOREIGN DATA WRAPPER (.+) TO "postgres" WITH GRANT OPTION/-- &/' \
| sed -E 's/^GRANT (.+) ON (.+) "()"$/-- &/' \
| sed -E 's/^REVOKE (.+) ON (.+) "()"$/-- &/' \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pg_tle").+/\1;/' \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgsodium").+/\1;/' \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgmq").+/\1;/' \
| sed -E 's/^COMMENT ON EXTENSION (.+)/-- &/' \
| sed -E 's/^CREATE POLICY "cron_job_/-- &/' \
| sed -E 's/^ALTER TABLE "cron"/-- &/' \
| sed -E 's/^SET transaction_timeout = 0;/-- &/' \
| sed -E '/^--/d' \
> "$tmp_file"

unset PGPASSWORD SUPABASE_DB_PASSWORD

mv "$tmp_file" "$OUT_FILE"
wc -l "$OUT_FILE"
shasum -a 256 "$OUT_FILE"
