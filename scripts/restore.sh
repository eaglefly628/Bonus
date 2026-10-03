#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! -f "$1" ]]; then echo "Usage: scripts/restore.sh backups/file.dump" >&2; exit 1; fi
file="$1"
cd "$(dirname "$0")/.."
docker compose exec -T db pg_restore -U actionpoints -d actionpoints --clean --if-exists --no-owner < "$file"
echo "Restored $file"
