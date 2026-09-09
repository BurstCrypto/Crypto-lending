#!/usr/bin/env bash

set -euo pipefail

suffix="${GITHUB_RUN_ID:-local}-$$"
network="railway-gateway-${suffix}"
api="railway-api-${suffix}"
web="railway-web-${suffix}"
gateway="railway-gateway-${suffix}"

cleanup() {
  docker rm --force "$gateway" "$web" "$api" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run --detach --name "$api" --network "$network" --entrypoint node \
  crypto-lending-api:ci -e \
  "require('node:http').createServer((request,response)=>response.end('api:'+request.url)).listen(3001,'0.0.0.0')" \
  >/dev/null
docker run --detach --name "$web" --network "$network" --entrypoint node \
  crypto-lending-web:ci -e \
  "require('node:http').createServer((request,response)=>response.end('web:'+request.url)).listen(3000,'0.0.0.0')" \
  >/dev/null
docker run --detach --name "$gateway" --network "$network" \
  --env "API_ORIGIN=http://${api}:3001" \
  --env "WEB_ORIGIN=http://${web}:3000" \
  crypto-lending-gateway:ci >/dev/null

for _attempt in {1..30}; do
  if [ "$(docker exec "$gateway" wget -qO- http://127.0.0.1:8080/healthz 2>/dev/null || true)" = 'ok' ]; then
    break
  fi
  sleep 1
done

test "$(docker exec "$gateway" wget -qO- http://127.0.0.1:8080/healthz)" = 'ok'
test "$(docker exec "$gateway" wget -qO- http://127.0.0.1:8080/api/v1/probe?asset=usdc)" = 'api:/api/v1/probe?asset=usdc'
test "$(docker exec "$gateway" wget -qO- http://127.0.0.1:8080/platforms)" = 'web:/platforms'
