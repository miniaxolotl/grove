#!/bin/sh
# Some upstream parse/error paths log the parameters. Suppress both streams
# before starting the JVM, including on platforms that collect container logs.
exec >/dev/null 2>&1
set -eu
ulimit -c 0
exec java -Xms64m -Xmx512m -XX:+UseSerialGC -XX:ActiveProcessorCount=1 \
  -XX:+DisableAttachMechanism -XX:-UsePerfData -XX:-HeapDumpOnOutOfMemoryError \
  -XX:+ExitOnOutOfMemoryError -XX:-CreateCoredumpOnCrash -XX:ErrorFile=/dev/null \
  -Djava.awt.headless=true -Duser.home=/nonexistent -Djava.io.tmpdir=/tmp \
  -Dotel.sdk.disabled=true -Dsun.net.httpserver.maxReqTime=10 -Dsun.net.httpserver.maxRspTime=30 \
  -cp '.:languagetool-server.jar:libs/*' org.languagetool.server.GroveServer
