#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
umask 077
if [[ -f .release ]]; then set -a; source .release; set +a; fi
mkdir -p backups
chmod 700 backups
backup_file="backups/fortutor-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file .env.production -f deploy/compose.production.yml exec -T postgres pg_dump -U fortutor -d fortutor --format=custom > "$backup_file.incoming"
mv "$backup_file.incoming" "$backup_file"
echo 'Backup saved; also copy it to your private off-site backup storage.'
