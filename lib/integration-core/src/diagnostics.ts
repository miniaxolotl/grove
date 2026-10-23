import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export type DiagnosticCheck = {
  id: string;
  context: "cli" | "bridge_probe" | "host";
  status: "passed" | "failed" | "unknown" | "skipped";
  code: string;
  message: string;
};

export type DiagnosticReport = {
  schemaVersion: 1;
  client: "opencode" | "claude" | "codex";
  observedAt: string;
  status: "ok" | "attention";
  hostVerified: false;
  checks: DiagnosticCheck[];
};

/** Inspect PATH without running a client or sourcing shell/version-manager files. */
export async function findExecutable(command: string) {
  const suffixes =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.COM;.CMD;.BAT").split(";")
      : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    // Empty/relative entries would make diagnosis execute project-controlled code.
    if (!isAbsolute(directory)) continue;
    for (const suffix of suffixes) {
      const path = join(directory, `${command}${suffix}`);
      try {
        if (!(await stat(path)).isFile()) continue;
        await access(
          path,
          process.platform === "win32" ? constants.F_OK : constants.X_OK,
        );
        return path;
      } catch {
        /* Try the next executable path, without logging filesystem details. */
      }
    }
  }
  return null;
}
