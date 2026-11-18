#!/usr/bin/env bash
# Disposable Compose project; never read the installation's .env or start its API/DB.
set -euo pipefail
cd "$(dirname "$0")/../.."
export POSTGRES_PASSWORD=fixture API_DATABASE_PASSWORD=fixture WORKER_DATABASE_PASSWORD=fixture
export CLERK_PUBLISHABLE_KEY=fixture CLERK_SECRET_KEY=fixture CLERK_ISSUER=fixture
export CLERK_WEBHOOK_SIGNING_SECRET=fixture CURSOR_SECRET=fixture LANGUAGETOOL_URL= COMPOSE_PROFILES=
project="grove-lt-verify-$$"
compose=(docker compose --env-file /dev/null -p "$project" -f docker-compose.yml)
if "${compose[@]}" config --services | grep -qx languagetool; then exit 1; fi
"${compose[@]}" --profile proofing config --services | grep -qx languagetool || { echo 'Missing optional proofing service' >&2; exit 1; }
compose+=(--profile proofing)
"${compose[@]}" config --format json | node -e '
const assert=require("node:assert/strict"), {services:s}=JSON.parse(require("fs").readFileSync(0));
assert.equal(s.api.environment.LANGUAGETOOL_URL, "");
assert(!("LANGUAGETOOL_URL" in s.worker.environment));
assert(!s.api.depends_on.languagetool && !s.languagetool.environment && !s.languagetool.volumes);
assert.deepEqual(Object.keys(s).filter(n=>s[n].networks?.proofing !== undefined).sort(), ["api", "languagetool"]);
assert.equal(s.languagetool.logging.driver,"none");'
# Capture stdout/stderr in the disposable container to test suppression at source.
fixture() { "${compose[@]}" -f - "$@" <<'YAML'; }
services:
  languagetool:
    logging: { driver: local }
YAML
trap 'fixture down --timeout 5 --rmi local' EXIT
fixture up -d --build --wait --wait-timeout 180 languagetool
id=$(fixture ps -q languagetool)
test -z "$(docker port "$id")"
test "$(docker network inspect "${project}_proofing" -f '{{.Internal}}')" = true
docker exec "$id" sh -eu -c '
  test "$(id -u)" != 0
  test "$(cat /sys/fs/cgroup/memory.max)" = 1073741824
  test "$(cat /sys/fs/cgroup/memory.swap.max)" = 0
  test "$(cat /sys/fs/cgroup/cpu.max)" = "100000 100000"
  test "$(ulimit -c)" = 0
  test "$(df --output=size -k /tmp | tail -1 | tr -d " ")" = 32768
  test -r COPYING.txt && test -r third-party-licenses/README.txt
  test ! -w /opt/lt
'
known() {
  docker run --rm --read-only --log-driver none --network "${project}_proofing" --entrypoint curl "$(docker inspect -f '{{.Image}}' "$id")" -fsS --max-time 15 --data 'language=en-US&enabledOnly=true&enabledRules=EN_A_VS_AN&text=This+is+a+hour+away.+GroveSyntheticMarker.' http://languagetool:8081/v2/check |
    node -e 'const r=JSON.parse(require("fs").readFileSync(0)); if(r.software.version!=="6.8" || !r.matches.some(m=>m.rule.id==="EN_A_VS_AN" && m.replacements[0].value==="an"))process.exit(1)'
}
known
docker exec -i "$id" bash -eu <<'SH'
url=http://localhost:8081/v2/check
code() { curl -sS --max-time 8 -o /dev/null -w '%{http_code}' --data "$1" "$url"; }
[[ $(code 'language=GroveSyntheticMarker&text=fixture') = 4?? ]]
[[ $(code "language=en-US&text=GroveSyntheticMarker$(printf %05000d 0)") = 4?? ]]
[[ $(code "language=en-US&text=GroveSyntheticMarker$(printf %070000d 0)") = 413 ]]
# Occupy the only reader with a partial request, then disconnect it. Concurrent
# checks must be refused promptly rather than sit in an executor draft queue.
exec 3<>/dev/tcp/127.0.0.1/8081
printf 'POST /v2/check HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 200\r\n\r\ntext=GroveSyntheticMarker' >&3
sleep .3
result=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' --data 'language=en-US&text=GroveSyntheticMarker' "$url") || rc=$?
[[ $result = 503 || ($result = 000 && ${rc:-0} != 28) ]]
exec 3>&-
SH
known
test -z "$(docker logs "$id" 2>&1)"
test -z "$(docker diff "$id")"
docker exec "$id" sh -ec 'if grep -rla GroveSyntheticMarker /tmp /dev/shm; then exit 1; else test "$?" = 1; fi; cat /sys/fs/cgroup/memory.peak; grep ^VmHWM /proc/1/status'
docker restart "$id" >/dev/null
fixture up -d --no-recreate --wait --wait-timeout 180 languagetool
known
test -z "$(docker logs "$id" 2>&1)"
echo 'Private LT known correction, failure paths, bounds and restart passed.'
