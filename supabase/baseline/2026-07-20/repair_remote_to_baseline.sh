#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BASELINE_VERSION="20260720095234"
BASELINE_FILE="$ROOT_DIR/supabase/migrations/${BASELINE_VERSION}_remote_schema_baseline.sql"
VERSIONS_FILE="$ROOT_DIR/supabase/baseline/2026-07-20/remote_versions_before.txt"
SUPABASE="$ROOT_DIR/node_modules/.bin/supabase"

if [[ ! -s "$BASELINE_FILE" ]]; then
  echo "Missing baseline migration: $BASELINE_FILE" >&2
  echo "Start Docker or install pg_dump, generate the baseline file, review it, then rerun." >&2
  exit 1
fi

if [[ ! -s "$VERSIONS_FILE" ]]; then
  echo "Missing pre-repair remote versions file: $VERSIONS_FILE" >&2
  exit 1
fi

read -r -a VERSIONS < "$VERSIONS_FILE"
if [[ "${#VERSIONS[@]}" -eq 0 ]]; then
  echo "No historical remote versions found; refusing to repair." >&2
  exit 1
fi

echo "Reverting ${#VERSIONS[@]} historical remote migration history rows..."
"$SUPABASE" migration repair --linked --status reverted --agent=no --yes "${VERSIONS[@]}"

echo "Marking baseline $BASELINE_VERSION as applied..."
"$SUPABASE" migration repair --linked --status applied --agent=no --yes "$BASELINE_VERSION"

"$SUPABASE" migration list --linked --agent=no
