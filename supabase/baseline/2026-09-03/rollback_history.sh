#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_PROJECT_REF='ftciqmqhmfvjtwoycswe'
readonly EXPECTED_HISTORY_SHA256='87fdac4f9126c04e298185ff4da353aae17e4816bba357934c9103e754077902'
readonly BASELINE_VERSION='20260903063714'
readonly MAIN_GATE_COMMIT='2ec5a92e05e270da214c13dbc2b2c028386a8d4e'

repo_root="$(git rev-parse --show-toplevel)"
evidence_dir="$repo_root/supabase/baseline/2026-09-03"
history_csv="$evidence_dir/migration_history_before.csv"
env_file="${ENV_FILE:-$repo_root/.env}"
project_ref="$(tr -d '\n' < "$repo_root/supabase/.temp/project-ref")"

if [[ "$project_ref" != "$EXPECTED_PROJECT_REF" ]]; then
  echo "Refusing rollback: linked project is $project_ref, expected $EXPECTED_PROJECT_REF." >&2
  exit 1
fi
if [[ ! -f "$env_file" ]]; then
  echo "Refusing rollback: set ENV_FILE to the approved environment file." >&2
  exit 1
fi
if [[ "$(shasum -a 256 "$history_csv" | awk '{print $1}')" != "$EXPECTED_HISTORY_SHA256" ]]; then
  echo "Refusing rollback: captured migration history evidence changed." >&2
  exit 1
fi
if [[ "$history_csv" == *"'"* ]]; then
  echo "Refusing rollback: unsupported quote in evidence path." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"

git fetch origin main
if ! git merge-base --is-ancestor "$MAIN_GATE_COMMIT" origin/main; then
  echo "Refusing rollback: validated baseline commit is not contained in origin/main." >&2
  exit 1
fi

pooler_url="$(tr -d '\n' < "$repo_root/supabase/.temp/pooler-url")"
db_url="$(POOLER_URL="$pooler_url" node -e '
  const url = new URL(process.env.POOLER_URL);
  url.password = process.env.SUPABASE_DB_PASSWORD;
  process.stdout.write(url.toString());
')"
current_versions="$(mktemp)"
allowed_versions="$(mktemp)"
history_after="$(mktemp)"
trap 'rm -f "$current_versions" "$allowed_versions" "$history_after"' EXIT

psql -X "$db_url" -At -v ON_ERROR_STOP=1 -c \
  "select version from supabase_migrations.schema_migrations order by version" > "$current_versions"
{
  sed -n '/^[0-9]\{14\}$/p' "$evidence_dir/remote_versions_before.txt"
  printf '%s\n' "$BASELINE_VERSION"
} | LC_ALL=C sort -u > "$allowed_versions"
if comm -23 "$current_versions" "$allowed_versions" | grep -q .; then
  echo "Refusing rollback: migration ledger contains an unexpected version." >&2
  exit 1
fi

if [[ "${BASELINE_REPAIR_DRY_RUN:-0}" == '1' ]]; then
  echo "Rollback preflight passed; dry run requested, migration history unchanged."
  exit 0
fi

# Emergency restore is a single transaction and preserves all six captured
# ledger columns, including the few non-null audit/idempotency fields that the
# CLI repair command cannot reconstruct from migration files alone.
psql -X "$db_url" -v ON_ERROR_STOP=1 --single-transaction \
  -c 'create temporary table baseline_history_restore (like supabase_migrations.schema_migrations including all)' \
  -c "\\copy baseline_history_restore (version, statements, name, created_by, idempotency_key, rollback) from '$history_csv' with (format csv, header true)" \
  -c 'delete from supabase_migrations.schema_migrations' \
  -c 'insert into supabase_migrations.schema_migrations select * from baseline_history_restore'

psql -X "$db_url" --csv -v ON_ERROR_STOP=1 -c \
  "select version, statements, name, created_by, idempotency_key, rollback from supabase_migrations.schema_migrations order by version" \
  > "$history_after"
history_sha="$(shasum -a 256 "$history_after" | awk '{print $1}')"
if [[ "$history_sha" != "$EXPECTED_HISTORY_SHA256" ]]; then
  echo "Rollback completed but checksum differs ($history_sha); keep the migration freeze active." >&2
  exit 1
fi

echo "Production migration history was restored exactly to the captured 151-row state."
