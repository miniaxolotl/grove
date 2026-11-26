#!/usr/bin/env bash
# Compile the actual launcher against a deterministic engine fixture. Java/Jackson
# versions come from the same pinned builder and actual checker image. No host
# ports, database, provider credentials or remote network are used by the tests.
set -euo pipefail
cd "$(dirname "$0")/../.."
image=${1:?Pass the checker image to test}
builder=maven:3.9-eclipse-temurin-17@sha256:1a352420f7aba21f5ad08df31bab55f74c013fb491f1ae8ab1dd7ff9ed698584
scratch=$(mktemp -d "${TMPDIR:-/tmp}/grove-lt-startup.XXXXXXXX")
mkdir "$scratch/libs" "$scratch/classes"
container=$(docker create --network none --entrypoint /bin/sh "$image")
cleanup() {
  docker rm -f "$container" >/dev/null
  rm -rf -- "$scratch"
}
trap cleanup EXIT
while IFS= read -r jar; do
  docker cp "$container:$jar" "$scratch/libs/"
done < <(docker run --rm --network none --entrypoint /bin/sh "$image" -c 'find /opt/lt/libs -maxdepth 1 -name "jackson-*.jar" -print')
docker run --rm --network none --read-only --memory 512m --cpus 1 \
  --tmpfs /tmp:rw,nosuid,nodev,size=32m --user "$(id -u):$(id -g)" \
  -v "$PWD/ops/languagetool:/source:ro" -v "$scratch:/test:rw" \
  --workdir /test --entrypoint /bin/sh "$builder" -ec '
    javac --release 17 -proc:none -cp "/test/libs/*" -d /test/classes /source/GroveServer.java /source/startup-test/StartupTest.java
    java -cp "/test/classes:/test/libs/*" org.languagetool.server.StartupTest
  '
