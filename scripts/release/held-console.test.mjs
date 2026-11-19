import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import process from "node:process";
import * as transport from "./held-console.mjs";
import { serveHeldStatus } from "../../packages/api/src/release-hold.ts";
import {
  createPrivateProof,
  listenPrivateProof,
} from "../../packages/api/src/lifecycle-proof.ts";

test("actual PTY/CLI composition executes only the fixed nonce-bound loopback GET and returns sanitized held identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "grove-held-console-"));
  const identity = {
    schema: 1,
    source: "a".repeat(40),
    production: "b".repeat(40),
    tag: "v1.11.30",
    run: 123,
    attempt: 1,
    digest: `sha256:${"c".repeat(64)}`,
    publication: "d".repeat(64),
  };
  const { server, close } = await serveHeldStatus(
    identity,
    "worker",
    { PORT: "0" },
    async () => {},
  );
  const port = server.address().port;
  writeFileSync(
    join(dir, "doctl"),
    `#!/usr/bin/env node
import readline from 'node:readline';
import {spawn} from 'node:child_process';
process.stdout.write('$ ');
const lines=readline.createInterface({input:process.stdin});
lines.once('line',(line)=>{lines.close(); const child=spawn('/bin/sh',['-c',line],{stdio:'inherit'});child.on('exit',(code)=>process.exit(code??1));});
`,
    { mode: 0o700 },
  );
  try {
    const body = await transport.probeConsole?.(
      {
        app: "11111111-1111-4111-8111-111111111111",
        deployment: "22222222-2222-4222-8222-222222222222",
        component: "worker",
        instance: "worker-current",
        challenge: "e".repeat(64),
      },
      {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        PORT: String(port),
        PRIVATE_FIXTURE: "must-not-print",
      },
    );
    assert.deepEqual(body, {
      status: "release_held",
      role: "worker",
      identity,
      schema: "verified",
      challenge: "e".repeat(64),
    });
    await assert.rejects(
      async () =>
        transport.probeConsole?.(
          {
            app: "invalid-private-fixture",
            deployment: "bad",
            component: "worker;rm",
            instance: "other",
            challenge: "bad",
          },
          process.env,
        ),
      (error) => {
        assert.doesNotMatch(
          String(error),
          /invalid-private-fixture|must-not-print/,
        );
        return true;
      },
    );
    await close();
    const evidence = {
      release: "1".repeat(64),
      receipt: "2".repeat(64),
      generation: "1",
      customers: 1,
      remoteVerified: 1,
      pending: 0,
      uncertain: 0,
      caughtUp: true,
      authorityHash: "3".repeat(64),
      remoteHash: "4".repeat(64),
      control: {
        phase: "released",
        approvalHash: "5".repeat(64),
        publicHash: null,
      },
    };
    const privateRuntime = await listenPrivateProof(
      createPrivateProof({
        mode: "runtime",
        role: "worker",
        identity,
        approval: "5".repeat(64),
        secret: "private-console-fixture-secret",
        ready: async () => {},
        evidence: async () => evidence,
      }),
      0,
    );
    try {
      const scope = {
        app: "11111111-1111-4111-8111-111111111111",
        deployment: "22222222-2222-4222-8222-222222222222",
        component: "worker",
        instance: "worker-current",
        challenge: "f".repeat(64),
        mode: "runtime",
        source: identity.source,
      };
      const result = await transport.probeConsole(scope, {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        PORT: String(privateRuntime.server.address().port),
        CURSOR_SECRET: "private-console-fixture-secret",
      });
      assert.deepEqual(result, {
        status: "runtime_verified",
        role: "worker",
        identity,
        approval: "5".repeat(64),
        schema: "verified",
        challenge: scope.challenge,
        evidence,
      });
      assert.doesNotMatch(
        JSON.stringify(result),
        /private-console-fixture-secret|CURSOR_SECRET/,
      );
    } finally {
      await privateRuntime.close();
    }
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});
