import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { parse, modify, applyEdits } from "jsonc-parser";
import { type AgentName } from "@lib/integration-core/node";
import { GroveError } from "@lib/shared/contracts";

export async function requireClient(agent: Exclude<AgentName, "cli">) {
  try {
    await promisify(execFile)(agent, ["--version"], {
      timeout: 10000,
      maxBuffer: 64 * 1024,
    });
  } catch {
    throw new GroveError(
      "client_missing",
      `Install ${agent} and make sure its command is on PATH, then run grove connect ${agent} again.`,
    );
  }
}

const run = (command: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["inherit", 2, 2],
      shell: false,
    });
    child.once("error", () =>
      reject(new GroveError("client_missing", `${command} is not installed`)),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new GroveError("install_failed", `${command} exited with ${code}`),
          ),
    );
  });
export async function installIntegration(agent: AgentName, remove = false) {
  if (agent === "cli")
    throw new GroveError("invalid_client", "Choose an agent client");
  if (agent === "claude") {
    if (remove) return run("claude", ["plugin", "uninstall", "grove@grove"]);
    await run("claude", ["plugin", "marketplace", "add", "miniaxolotl/grove"]);
    await run("claude", [
      "plugin",
      "install",
      "grove@grove",
      "--scope",
      "user",
    ]);
  } else if (agent === "codex") {
    if (remove) return run("codex", ["plugin", "remove", "grove@grove"]);
    await run("codex", ["plugin", "marketplace", "add", "miniaxolotl/grove"]);
    await run("codex", ["plugin", "add", "grove@grove"]);
    console.error(
      "Grove installed. Review and trust its optional hooks in Codex before automatic recall runs.",
    );
  } else {
    const directory = join(
      process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
      "opencode",
    );
    let path = join(directory, "opencode.jsonc");
    let source = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
    for (const name of ["opencode.jsonc", "opencode.json"]) {
      try {
        source = await readFile(join(directory, name), "utf8");
        path = join(directory, name);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const errors: import("jsonc-parser").ParseError[] = [];
    const config = parse(source, errors, { allowTrailingComma: true });
    if (errors.length || !config || typeof config !== "object")
      throw new GroveError(
        "invalid_config",
        "OpenCode configuration could not be parsed; no changes made",
      );
    const name = "@miniaxolotl/grove-opencode-plugin";
    const isGrove = (entry: unknown) => {
      const value =
        typeof entry === "string"
          ? entry
          : (entry as { package?: string } | null)?.package;
      return value === name || value?.startsWith(`${name}@`);
    };
    const existing = Array.isArray(config.plugins) ? config.plugins : [];
    const entries = existing.filter((entry: unknown) => !isGrove(entry));
    if (!remove) entries.push(existing.find(isGrove) ?? name);
    source = applyEdits(
      source,
      modify(source, ["plugins"], entries, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );
    await mkdir(directory, { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, source, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
    console.error(
      remove
        ? "Grove plugin entry removed"
        : "Grove plugin configured. Restart OpenCode to load it.",
    );
  }
}
