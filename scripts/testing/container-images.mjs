import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import process from "node:process";
import console from "node:console";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [component, image] = process.argv.slice(2);
assert(["api", "mcp", "website", "languagetool"].includes(component));
assert(image && !image.startsWith("-"));
const docker = (args) =>
  execFileSync("docker", args, { encoding: "utf8", timeout: 30_000 });
const config = JSON.parse(
  docker(["image", "inspect", image, "--format", "{{json .Config}}"]),
);
assert(
  config.User && !["root", "0"].includes(config.User.split(":")[0]),
  "Runtime must be non-root",
);
const isolated = [
  "--network",
  "none",
  "--read-only",
  "--memory",
  "1g",
  "--memory-swap",
  "1g",
  "--cpus",
  "1",
  "--tmpfs",
  "/tmp:rw,nosuid,nodev,noexec,size=32m",
];

if (component === "mcp") {
  const client = new Client({
    name: "grove-container-fixture",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: "docker",
    args: [
      "run",
      "--rm",
      "-i",
      ...isolated,
      "--env",
      "GROVE_TELEMETRY=0",
      image,
    ],
    stderr: "pipe",
  });
  try {
    await client.connect(transport, { timeout: 20_000 });
    const result = await client.listTools({}, { timeout: 20_000 });
    for (const tool of [
      "remember",
      "recall",
      "memories",
      "forget",
      "get_memory",
      "preview_memory_patch",
      "apply_memory_patch",
    ])
      assert(result.tools.some(({ name }) => name === tool));
  } finally {
    await client.close();
  }
} else if (component === "api") {
  // No production database or credentials are mounted. Backend/RLS correctness
  // is separately exercised against disposable real services by the test suite.
  docker([
    "run",
    "--rm",
    ...isolated,
    "--entrypoint",
    "node",
    image,
    "--input-type=module",
    "-e",
    `
    import {execFileSync} from 'node:child_process';
    import {createRequire} from 'node:module';
    for (const entry of ['server','worker','migrate','bootstrap']) execFileSync(process.execPath,['--check','dist/'+entry+'.js']);
    await import('pg'); await import('sharp'); await import('@huggingface/transformers');
    const require=createRequire(import.meta.resolve('@huggingface/transformers'));
    const runtime=require('onnxruntime-node');
    if(typeof runtime.InferenceSession!=='function') throw Error('ONNX native runtime unavailable');
  `,
  ]);
} else {
  const id = docker(["run", "-d", ...isolated, image]).trim();
  try {
    const deadline =
      Date.now() + (component === "languagetool" ? 240_000 : 60_000);
    let ready = false;
    while (Date.now() < deadline) {
      assert.equal(
        docker(["inspect", "--format", "{{.State.Running}}", id]).trim(),
        "true",
        "Container exited before readiness",
      );
      try {
        if (component === "languagetool")
          docker([
            "exec",
            id,
            "curl",
            "-fs",
            "--max-time",
            "2",
            "http://127.0.0.1:8081/ready",
          ]);
        else
          docker([
            "exec",
            id,
            "node",
            "-e",
            "fetch('http://127.0.0.1:3000/release.json').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
          ]);
        ready = true;
        break;
      } catch {
        await setTimeout(1000);
      }
    }
    assert(ready, "Container did not reach real readiness");
    if (component === "website")
      docker([
        "exec",
        id,
        "node",
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      const base='http://127.0.0.1:3000';
      const home=await fetch(base);assert(home.ok);const html=await home.text();
      const asset=html.match(/(?:src|href)="([^" ]*\\/_next\\/static\\/[^" ]+)"/);assert(asset);
      const resource=await fetch(new URL(asset[1],base));assert(resource.ok);assert((await resource.arrayBuffer()).byteLength>0);
      const identity=await (await fetch(base+'/release.json')).json();assert.equal(identity.repository,'miniaxolotl/grove');assert(identity.sourceSha);
    `,
      ]);
    else {
      const result = JSON.parse(
        docker([
          "exec",
          id,
          "curl",
          "-fsS",
          "--max-time",
          "15",
          "--data",
          "language=en-US&enabledOnly=true&enabledRules=EN_A_VS_AN&text=This+is+a+hour+away.",
          "http://127.0.0.1:8081/v2/check",
        ]),
      );
      assert.equal(result.software.version, "6.8");
      assert(
        result.matches.some(
          (match) =>
            match.rule.id === "EN_A_VS_AN" &&
            match.replacements[0].value === "an",
        ),
      );
      assert.equal(docker(["logs", id]), "");
      assert.equal(docker(["diff", id]), "");
    }
  } finally {
    docker(["rm", "-f", id]);
  }
}
console.log(`${component} isolated runtime smoke check passed.`);
