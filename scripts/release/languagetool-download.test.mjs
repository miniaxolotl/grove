import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { URL } from "node:url";

const run = promisify(execFile);
const upstream =
  "https://maven-central.storage-download.googleapis.com/maven2/org/languagetool/languagetool-standalone/6.8/languagetool-standalone-6.8.zip";
const pin = "f04aecf37e35ef17d44b336da9668a5a3a871edd14bd83a766a7e110b9ebcd21";
const sample = "synthetic pinned LanguageTool archive";
const digest = createHash("sha256").update(sample).digest("hex");

async function command() {
  const dockerfile = await readFile(
    new URL("../../ops/languagetool/Dockerfile", import.meta.url),
    "utf8",
  );
  const line = dockerfile
    .replace(/\\\n\s*/g, " ")
    .split("\n")
    .find((line) => line.startsWith("RUN curl "));
  assert(
    line,
    "Pinned checker download needs bounded HTTP retries before extraction",
  );
  assert(line.includes(upstream));
  assert.doesNotMatch(line, /repo1\.maven\.org|repo\.maven\.apache\.org/);
  assert(line.includes(pin));
  return line.slice(4);
}

test("checker archive download retains HTTPS/checksum pins and bounded transient-only retries", async () => {
  const shell = await command();
  for (const flag of [
    "--fail",
    "--retry 3",
    "--retry-max-time 180",
    "--connect-timeout 10",
    "--max-time 60",
    "--proto '=https'",
    "--proto-redir '=https'",
    "sha256sum -c -",
  ])
    assert(shell.includes(flag), flag);
  assert.doesNotMatch(shell, /--insecure|--retry-all-errors|\|\| true/);
});

for (const scenario of ["transient", "not-found", "changed-archive"]) {
  test(`real curl checker download handles ${scenario} without relaxing integrity`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "grove-lt-download-"));
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      const status =
        scenario === "not-found"
          ? 404
          : scenario === "transient" && requests < 3
            ? [429, 503][requests - 1]
            : 200;
      response.writeHead(status);
      response.end(
        status === 200
          ? scenario === "changed-archive"
            ? "unexpected archive"
            : sample
          : "temporary fixture response",
      );
    });
    try {
      const shell = await command();
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      // Only this owned loopback fixture replaces the fixed URL, protocol and
      // sample checksum. Production has no URL/TLS/checksum override.
      const fixture = shell
        .replace(
          upstream,
          `http://127.0.0.1:${server.address().port}/archive.zip`,
        )
        .replaceAll("'=https'", "'=http'")
        .replace(pin, digest)
        .replaceAll("/tmp/lt.zip", join(directory, "lt.zip"));
      const result = run("sh", ["-c", fixture], { timeout: 15000 });
      if (scenario === "transient") {
        await result;
        assert.equal(requests, 3);
        assert.equal(await readFile(join(directory, "lt.zip"), "utf8"), sample);
      } else {
        await assert.rejects(result);
        assert.equal(requests, 1);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });
}
