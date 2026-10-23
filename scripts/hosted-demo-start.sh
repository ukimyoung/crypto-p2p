#!/usr/bin/env bash
# Starts the demo on a single host (used by render.yaml): seeds the database,
# runs the API on an internal port and the web app on $PORT. If either process
# stops, the script exits so the host restarts both.
set -euo pipefail
cd "$(dirname "$0")/.."

(cd apps/api && DEMO_SEED=yes node dist/demo/seed-cli.js)

(cd apps/api && PORT=3000 exec node dist/main.js) &
(cd apps/web && API_URL=http://127.0.0.1:3000 exec npx next start -p "${PORT:-3001}") &
wait -n
exit 1
