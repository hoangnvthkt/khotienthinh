#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_PROJECT_REF='ftciqmqhmfvjtwoycswe'
readonly EXPECTED_HISTORY_SHA256='87fdac4f9126c04e298185ff4da353aae17e4816bba357934c9103e754077902'
readonly EXPECTED_SCHEMA_SHA256='fba1645de106bfeb879669a7ee945991bd6a941cbc05c909538e3165b1124541'
readonly BASELINE_VERSION='20260903063714'
readonly BASELINE_FILENAME='20260903063714_cloud_schema_baseline_v2.sql'
readonly MAIN_GATE_COMMIT='2ec5a92e05e270da214c13dbc2b2c028386a8d4e'

repo_root="$(git rev-parse --show-toplevel)"
evidence_dir="$repo_root/supabase/baseline/2026-09-03"
env_file="${ENV_FILE:-$repo_root/.env}"
project_ref="$(tr -d '\n' < "$repo_root/supabase/.temp/project-ref")"

if [[ "$project_ref" != "$EXPECTED_PROJECT_REF" ]]; then
  echo "Refusing repair: linked project is $project_ref, expected $EXPECTED_PROJECT_REF." >&2
  exit 1
fi
if [[ ! -f "$env_file" ]]; then
  echo "Refusing repair: set ENV_FILE to the approved environment file." >&2
  exit 1
fi
if [[ ! -f "$repo_root/supabase/migrations/$BASELINE_FILENAME" ]]; then
  echo "Refusing repair: baseline migration is missing." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"

git fetch origin main
if ! git merge-base --is-ancestor "$MAIN_GATE_COMMIT" origin/main; then
  echo "Refusing repair: validated baseline commit is not contained in origin/main." >&2
  exit 1
fi

pooler_url="$(tr -d '\n' < "$repo_root/supabase/.temp/pooler-url")"
db_url="$(POOLER_URL="$pooler_url" node -e '
  const url = new URL(process.env.POOLER_URL);
  url.password = process.env.SUPABASE_DB_PASSWORD;
  process.stdout.write(url.toString());
')"
history_now="$(mktemp)"
fingerprint_jsonl="$(mktemp)"
fingerprint_json="$(mktemp)"
trap 'rm -f "$history_now" "$fingerprint_jsonl" "$fingerprint_json"' EXIT

psql -X "$db_url" --csv -v ON_ERROR_STOP=1 -c \
  "select version, statements, name, created_by, idempotency_key, rollback from supabase_migrations.schema_migrations order by version" \
  > "$history_now"
history_sha="$(shasum -a 256 "$history_now" | awk '{print $1}')"
if [[ "$history_sha" != "$EXPECTED_HISTORY_SHA256" ]]; then
  echo "Refusing repair: production migration history changed ($history_sha)." >&2
  exit 1
fi

psql -X "$db_url" -At -v ON_ERROR_STOP=1 \
  -f "$repo_root/scripts/supabase-baseline/schema-fingerprint.sql" > "$fingerprint_jsonl"
jq -s . "$fingerprint_jsonl" > "$fingerprint_json"
schema_sha="$(shasum -a 256 "$fingerprint_json" | awk '{print $1}')"
if [[ "$schema_sha" != "$EXPECTED_SCHEMA_SHA256" ]]; then
  echo "Refusing repair: production schema fingerprint changed ($schema_sha)." >&2
  exit 1
fi

if [[ "${BASELINE_REPAIR_DRY_RUN:-0}" == '1' ]]; then
  echo "Repair preflight passed; dry run requested, migration history unchanged."
  exit 0
fi

versions=()
while IFS= read -r version; do
  [[ -n "$version" ]] && versions+=("$version")
done < "$evidence_dir/remote_versions_before.txt"
if [[ "${#versions[@]}" -ne 151 ]]; then
  echo "Refusing repair: expected 151 captured remote versions." >&2
  exit 1
fi

npx supabase migration repair "${versions[@]}" \
  --status reverted --db-url "$db_url" --agent=no
npx supabase migration repair "$BASELINE_VERSION" \
  --status applied --db-url "$db_url" --agent=no

ledger_versions="$(psql -X "$db_url" -At -v ON_ERROR_STOP=1 -c \
  "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations")"
if [[ "$ledger_versions" != "$BASELINE_VERSION" ]]; then
  echo "Repair did not reach the expected baseline-only state. Run rollback_history.sh." >&2
  exit 1
fi

echo "Production migration history now records baseline $BASELINE_VERSION only."
