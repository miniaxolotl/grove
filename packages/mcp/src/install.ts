import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  parseTree,
  findNodeAtLocation,
  getNodeValue,
  createScanner,
  SyntaxKind,
  modify,
  applyEdits,
  type Edit,
} from "jsonc-parser";
import { type AgentName } from "@lib/integration-core/node";
import { GroveError } from "@lib/shared/contracts";
import claudePackage from "../../grove-claude-plugin/package.json" with { type: "json" };
import codexPackage from "../../grove-codex-plugin/package.json" with { type: "json" };

export function activationInstructions(agent: Exclude<AgentName, "cli">) {
  if (agent === "opencode")
    return {
      restartRequired: false,
      message:
        "OpenCode loads Grove automatically. Check its MCP tools; if Grove has not appeared, restart OpenCode.",
    };
  if (agent === "claude")
    return {
      restartRequired: false,
      message:
        "In Claude Code, run /reload-plugins to load Grove, or start a new session.",
    };
  return {
    restartRequired: true,
    message:
      "Restart Codex to load Grove. Review its optional hooks in Codex to enable automatic recall.",
  };
}

async function nativeInstallation(agent: "claude" | "codex") {
  try {
    const { stdout } = await promisify(execFile)(
      agent,
      ["plugin", "list", "--json"],
      { timeout: 10000, maxBuffer: 1024 * 1024 },
    );
    const value = JSON.parse(stdout);
    const plugins = agent === "claude" ? value : value.installed;
    const plugin = Array.isArray(plugins)
      ? plugins.find(
          (plugin) =>
            (agent === "claude" ? plugin.id : plugin.pluginId) ===
              "grove@grove" &&
            (agent !== "claude" || plugin.scope === "user"),
        )
      : undefined;
    if (!plugin) return "missing";
    const expected = (agent === "claude" ? claudePackage : codexPackage)
      .version;
    const actual =
      typeof plugin.version === "string" &&
      /^\d+\.\d+\.\d+$/.test(plugin.version)
        ? plugin.version.split(".").map(Number)
        : [];
    const target = expected.split(".").map(Number);
    const difference =
      actual.length === 3
        ? (actual
            .map((part: number, index: number) => part - target[index])
            .find((part: number) => part !== 0) ?? 0)
        : -1;
    return plugin.enabled === true && difference >= 0 ? "ready" : "update";
  } catch {
    return "missing";
  }
}

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
  const native =
    !remove && agent !== "opencode"
      ? await nativeInstallation(agent)
      : "missing";
  if (native === "ready") {
    console.error("✓ Grove integration is already installed");
    return;
  }
  if (agent === "claude") {
    if (remove) return run("claude", ["plugin", "uninstall", "grove@grove"]);
    await run("claude", ["plugin", "marketplace", "add", "miniaxolotl/grove"]);
    if (native === "update") {
      await run("claude", ["plugin", "marketplace", "update", "grove"]);
      await run("claude", [
        "plugin",
        "update",
        "grove@grove",
        "--scope",
        "user",
      ]);
    }
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
    if (native === "update")
      await run("codex", ["plugin", "marketplace", "upgrade", "grove"]);
    await run("codex", ["plugin", "add", "grove@grove"]);
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
    const config = parseTree(source, errors, { allowTrailingComma: true });
    const plugins = config && findNodeAtLocation(config, ["plugins"]);
    if (
      errors.length ||
      config?.type !== "object" ||
      (plugins && plugins.type !== "array")
    )
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
      return (
        typeof value === "string" &&
        (value === name || value.startsWith(`${name}@`))
      );
    };
    const entries = plugins?.children ?? [];
    const matches = entries.filter((node) => isGrove(getNodeValue(node)));
    if ((!remove && matches.length === 1) || (remove && !matches.length)) {
      console.error(
        remove
          ? "Grove plugin entry is already removed"
          : "✓ Grove integration is already configured",
      );
      return;
    }
    if (!matches.length) {
      source = applyEdits(source, modify(source, ["plugins", -1], name, {}));
    } else {
      // Keep the first configured Grove entry in place during deduplication.
      // Remove values and separator tokens, never intervening comments/trivia.
      const discard = new Set(remove ? matches : matches.slice(1));
      const lastKept = entries.filter((node) => !discard.has(node)).at(-1);
      const scanner = createScanner(source, true);
      const edits: Edit[] = [];
      for (const node of entries) {
        if (discard.has(node))
          edits.push({ offset: node.offset, length: node.length, content: "" });
        if (
          discard.has(node) ||
          (node === lastKept && node !== entries.at(-1))
        ) {
          scanner.setPosition(node.offset + node.length);
          if (scanner.scan() === SyntaxKind.CommaToken)
            edits.push({
              offset: scanner.getTokenOffset(),
              length: 1,
              content: "",
            });
        }
      }
      source = applyEdits(source, edits);
    }
    await mkdir(directory, { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, source, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
    console.error(
      remove ? "Grove plugin entry removed" : "✓ Grove integration configured",
    );
  }
  if (
    !remove &&
    agent !== "opencode" &&
    (await nativeInstallation(agent)) !== "ready"
  )
    throw new GroveError(
      "install_incomplete",
      `Grove was approved, but ${agent} has not enabled the required plugin version. Check its plugin settings, then run grove connect ${agent} again to finish.`,
    );
}
