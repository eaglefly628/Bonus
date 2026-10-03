#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="backups/actionpoints-${stamp}.dump"
docker compose exec -T db pg_dump -U actionpoints -d actionpoints -Fc > "$target"
find backups -name 'actionpoints-*.dump' -type f -mtime +13 -delete
echo "Backup saved to $target"
