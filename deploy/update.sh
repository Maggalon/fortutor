#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ ${1:-} =~ ^fortutor-web:[a-f0-9]{40}$ ]] || { echo 'Invalid web image'; exit 1; }
[[ ${2:-} =~ ^fortutor-worker:[a-f0-9]{40}$ ]] || { echo 'Invalid worker image'; exit 1; }
[[ ${1#*:} == "${2#*:}" ]] || { echo 'Web and worker revisions must match'; exit 1; }
exec 9>.deploy.lock
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
test -r .env.production || { echo 'Missing .env.production'; exit 1; }
export WEB_IMAGE="$1" WORKER_IMAGE="$2"
compose=(docker compose --env-file .env.production -f deploy/compose.production.yml)
docker image inspect "$WEB_IMAGE" "$WORKER_IMAGE" >/dev/null
"${compose[@]}" config --quiet
proxy_network=$("${compose[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["networks"]["proxy"]["name"])')
docker network inspect "$proxy_network" >/dev/null
"${compose[@]}" run --rm --no-deps migrate node --import tsx scripts/check-config.ts
"${compose[@]}" up -d --no-build --wait postgres redis
if [[ -f .release ]]; then bash deploy/backup.sh; fi
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --no-build --wait --wait-timeout 180
if [[ -f .release ]]; then cp .release .release.previous; fi
printf 'WEB_IMAGE=%s\nWORKER_IMAGE=%s\n' "$WEB_IMAGE" "$WORKER_IMAGE" > .release.incoming
mv .release.incoming .release
echo 'Deployment ready'
