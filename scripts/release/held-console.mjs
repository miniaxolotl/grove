// Fixed-command, bounded private held-probe transport. No custom shell command,
// token argument, remote write or raw console output is accepted/returned.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
const execute = promisify(execFile);
export async function probeConsole(scope, env = process.env) {
  try {
    const { stdout } = await execute(
      "python3",
      [
        fileURLToPath(new URL("./held-console.py", import.meta.url)),
        scope.app,
        scope.deployment,
        scope.component,
        scope.instance,
        scope.challenge,
        scope.mode ?? "held",
        scope.source ?? "",
      ],
      {
        env,
        encoding: "utf8",
        timeout: 50000,
        maxBuffer: 65536,
      },
    );
    return JSON.parse(stdout);
  } catch {
    throw new Error(
      "Private held-instance probe unavailable; retain release hold",
    );
  }
}
