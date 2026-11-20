import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { need, hashJSON } from "./operator-control.mjs";
import { pythonExecutable, isolatedPythonArgs } from "./python.mjs";
const script = fileURLToPath(new URL("./authority.py", import.meta.url));
export async function authorityRequest(
  request,
  { crashAfterCommit = false } = {},
) {
  return new Promise((resolve, reject) => {
    const p = spawn(pythonExecutable, isolatedPythonArgs(script), {
      stdio: ["pipe", "pipe", "ignore"],
      env: crashAfterCommit
        ? { GROVE_AUTHORITY_FIXTURE_CRASH: "after_commit" }
        : {},
      signal: globalThis.AbortSignal.timeout(15000),
    });
    let output = "",
      failed = false;
    p.on("error", () => {
      failed = true;
    });
    p.stdin.on("error", () => {});
    p.stdout.on("data", (b) => {
      output += b;
      if (output.length > 65536) {
        failed = true;
        p.kill();
      }
    });
    p.on("close", (code) => {
      if (failed || !output)
        return reject(Error("AUTHORITY_ACCEPTANCE_UNKNOWN"));
      try {
        const response = JSON.parse(output);
        need(
          code === 0 && response.ok === true,
          response.error ?? "AUTHORITY_ACCEPTANCE_UNKNOWN",
        );
        resolve(response.result);
      } catch (e) {
        e.operation = request.operation;
        reject(e);
      }
    });
    p.stdin.end(JSON.stringify(request));
  });
}
export const provisionAuthority = (parameters) =>
  authorityRequest({
    operation: "provision",
    parameters: { app: "3aef47f9-3724-4f21-9cad-8c4eb5644af0", ...parameters },
  });
export const appAuthorityIdentity = (d) =>
  Object.fromEntries(
    ["schema", "id", "app", "root", "rootIdentity", "dbIdentity"].map((k) => [
      k,
      d[k],
    ]),
  );
export function assertPinnedAuthority(descriptor, trusted) {
  need(
    hashJSON(appAuthorityIdentity(descriptor)) === trusted.appAuthoritySha256 &&
      descriptor.codeHash === trusted.closureSha256,
    "APP_AUTHORITY_NOT_PINNED",
  );
}
export function openAuthority(descriptor) {
  descriptor = JSON.parse(JSON.stringify(descriptor));
  const call = (operation, parameters = {}) =>
    authorityRequest({ descriptor, operation, parameters });
  return Object.freeze({
    descriptor,
    status: () => call("status"),
    registerInstallation: (parameters) => call("register", parameters),
    reserve: (key, context) => call("reserve", { key, context }),
    advance: (key, old, next, context) =>
      call("advance", { key, old, next, context }),
    head: (key, context) => call("head", { key, context }),
    fixtureCrashAfterCommit: (operation, parameters) =>
      authorityRequest(
        { descriptor, operation, parameters },
        { crashAfterCommit: true },
      ),
    call,
  });
}
