#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BASELINE_VERSION="20260720095234"
VERSIONS_FILE="$ROOT_DIR/supabase/baseline/2026-07-20/remote_versions_before.txt"
SUPABASE="$ROOT_DIR/node_modules/.bin/supabase"

if [[ ! -s "$VERSIONS_FILE" ]]; then
  echo "Missing pre-repair remote versions file: $VERSIONS_FILE" >&2
  exit 1
fi

read -r -a VERSIONS < "$VERSIONS_FILE"
if [[ "${#VERSIONS[@]}" -eq 0 ]]; then
  echo "No historical remote versions found; refusing to rollback repair." >&2
  exit 1
fi

echo "Removing baseline $BASELINE_VERSION from remote migration history if present..."
"$SUPABASE" migration repair --linked --status reverted --agent=no --yes "$BASELINE_VERSION"

echo "Restoring ${#VERSIONS[@]} historical remote migration history rows..."
"$SUPABASE" migration repair --linked --status applied --agent=no --yes "${VERSIONS[@]}"

"$SUPABASE" migration list --linked --agent=no
