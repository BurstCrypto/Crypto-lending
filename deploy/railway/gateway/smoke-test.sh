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

test "$(docker run --rm --entrypoint id crypto-lending-gateway:ci -u)" != '0'

docker network create "$network" >/dev/null
docker run --detach --name "$api" --network "$network" --entrypoint node \
  crypto-lending-api:ci -e \
  "require('node:http').createServer((request,response)=>response.end('api:'+request.url+'|xff:'+request.headers['x-forwarded-for']+'|xfp:'+request.headers['x-forwarded-proto'])).listen(3001,'0.0.0.0')" \
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
api_response="$(docker exec "$gateway" wget -qO- http://127.0.0.1:8080/api/v1/probe?asset=usdc)"
test "${api_response%%|xff:*}" = 'api:/api/v1/probe?asset=usdc'
forwarded_response="$(docker exec "$gateway" wget -qO- \
  --header='X-Real-IP: 198.51.100.4' \
  --header='X-Forwarded-For: 203.0.113.7, 203.0.113.8' \
  --header='X-Forwarded-Proto: https' \
  http://127.0.0.1:8080/api/v1/probe)"
test "${forwarded_response#*|xff:}" = '198.51.100.4|xfp:https'
if docker exec "$gateway" wget -qO- \
  http://127.0.0.1:8080/api/v1/internal/health/dependencies >/dev/null 2>&1; then
  echo 'gateway exposed the private API readiness endpoint' >&2
  exit 1
fi
test "$(docker exec "$gateway" wget -qO- http://127.0.0.1:8080/platforms)" = 'web:/platforms'
