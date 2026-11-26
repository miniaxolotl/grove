#!/usr/bin/env bash
# A real, fresh JVM under constrained CPU. Cold initialization must not be
# mistaken for a normal paragraph timeout or a successful readiness response.
set -euo pipefail
image=${1:?Pass the checker image to test}
id=$(docker run -d --network none --read-only --log-driver local \
  --memory 1g --memory-swap 1g --cpus .25 \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m "$image")
trap 'docker rm -f "$id" >/dev/null' EXIT
ready=false
deadline=$((SECONDS + 240))
while (( SECONDS < deadline )); do
  [[ $(docker inspect -f '{{.State.Running}}' "$id") == true ]] || break
  if docker exec "$id" curl -fs --max-time 2 http://127.0.0.1:8081/ready >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 4
done
[[ $ready == true ]] || { echo 'Cold checker did not reach genuine readiness under constrained CPU' >&2; exit 1; }
test -z "$(docker logs "$id" 2>&1)"
test -z "$(docker diff "$id")"
echo 'Real cold checker: known-correction readiness at 0.25 CPU, 1 GiB, zero output and no writable changes passed.'
