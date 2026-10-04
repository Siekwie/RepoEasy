#!/usr/bin/env bash
# Deploys the committed HEAD to the server: uploads the source, rebuilds the image, restarts the
# container and waits until it reports healthy. Uncommitted changes are not deployed.
#
#   deploy/deploy.sh [ssh-host]      (default: wiestlab; run from Git Bash on Windows)
#
# The server keeps /srv/repoeasy/.env (secrets, never in git) and /srv/repoeasy/data (the database).
set -euo pipefail

HOST="${1:-wiestlab}"
DIR=/srv/repoeasy
SITES=/srv/proxy/caddy/sites

cd "$(git rev-parse --show-toplevel)"
[ -z "$(git status --porcelain)" ] || echo "Note: uncommitted changes are left out, only HEAD is deployed." >&2
echo "Deploying $(git rev-parse --short HEAD) to $HOST:$DIR"

git archive --format=tar HEAD | ssh "$HOST" "set -e
  rm -rf $DIR/app.new && mkdir -p $DIR/app.new $DIR/data
  tar -x -C $DIR/app.new
  rm -rf $DIR/app && mv $DIR/app.new $DIR/app"

ssh "$HOST" "set -e
  cd $DIR
  test -f .env || { echo 'Missing $DIR/.env (see .env.example)' >&2; exit 1; }
  docker compose -f app/deploy/compose.yml --project-directory . up -d --build --remove-orphans
  docker image prune -f >/dev/null
  if ! cmp -s app/deploy/repoeasy.caddy $SITES/repoeasy.caddy; then
    cp app/deploy/repoeasy.caddy $SITES/repoeasy.caddy
    docker exec caddy caddy reload --config /etc/caddy/Caddyfile
  fi
  for i in \$(seq 1 30); do
    [ \"\$(docker inspect -f '{{.State.Health.Status}}' repoeasy 2>/dev/null)\" = healthy ] && { echo 'repoeasy is healthy'; exit 0; }
    sleep 2
  done
  echo 'repoeasy did not become healthy:' >&2
  docker logs --tail 40 repoeasy >&2
  exit 1"
