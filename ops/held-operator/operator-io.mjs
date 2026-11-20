import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import process from "node:process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { need } from "./operator-control.mjs";
import { assertOwnerTarget } from "./window-db.mjs";
import { pinDirectory } from "./pinned-path.mjs";
import { fileURLToPath, URL } from "node:url";
export const IMAGE =
  "sha256:034acfb28d52ed83fe284f4d5309b4bbfd090c9d374148e82e05b4dc20afd9d8";
export const CA = "/etc/ssl/certs/ca-certificates.crt";
export async function runProcess(
  command,
  args,
  input,
  { timeoutMs = 120000, maxBytes = 256 * 1024 * 1024, secretFd, cwd } = {},
) {
  return new Promise((resolve, reject) => {
    let code = null,
      size = 0;
    const chunks = [];
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const p = spawn(
      "/usr/bin/python3",
      ["-I", "-B", fileURLToPath(new URL("./subprocess.py", import.meta.url))],
      {
        detached: true,
        stdio: ["pipe", "pipe", "ignore"],
        signal: globalThis.AbortSignal.timeout(timeoutMs + 10000),
      },
    );
    p.stdout.on("data", (b) => {
      size += b.length;
      if (size > Math.ceil((maxBytes * 4) / 3) + 65536) {
        code = "SUBPROCESS_OUTPUT_LIMIT";
        p.kill("SIGTERM");
      } else chunks.push(b);
    });
    p.on("error", () => {
      code ??= "SUBPROCESS_TIMEOUT";
    });
    p.stdin.on("error", () => {});
    p.on("close", (status) => {
      try {
        const result = JSON.parse(Buffer.concat(chunks));
        code ??= result.error;
        need(
          status === 0 && result.reaped === true && !code,
          code ?? "SUBPROCESS_CLEANUP_UNCERTAIN",
        );
        resolve(Buffer.from(result.output, "base64"));
      } catch (e) {
        reject(
          Object.assign(Error(code ?? e.code ?? "SUBPROCESS_FAILED"), {
            code: code ?? e.code ?? "SUBPROCESS_FAILED",
            tool: command,
          }),
        );
      }
    });
    p.stdin.end(
      JSON.stringify({
        argv: [command, ...args],
        cwd,
        env,
        timeoutMs,
        maxBytes,
        input: Buffer.from(input ?? "").toString("base64"),
        secretFd:
          secretFd === undefined
            ? null
            : Buffer.from(secretFd).toString("base64"),
      }),
    );
  });
}
export function createIO({ control, sourceRoot, manifest }) {
  const { Client } = createRequire(sourceRoot + "/lib/database/package.json")(
    "pg",
  );
  async function crypt(bytes, key, decrypt = false) {
    need(
      typeof key === "string" && key.length >= 32 && !/[\r\n]/.test(key),
      "BACKUP_KEY_REJECTED",
    );
    const home = await control.privateDirectory(control.root + "/gnupg", {
      create: true,
    });
    const pin = await pinDirectory(home);
    try {
      return await runProcess(
        "gpg",
        [
          "--no-options",
          "--homedir",
          pin.path,
          "--batch",
          "--quiet",
          "--no-symkey-cache",
          "--no-random-seed-file",
          "--pinentry-mode",
          "loopback",
          "--passphrase-fd",
          "3",
          "--output",
          "-",
          ...(decrypt
            ? ["--decrypt"]
            : ["--cipher-algo", "AES256", "--symmetric"]),
        ],
        bytes,
        { secretFd: key + "\n", timeoutMs: 60000 },
      );
    } catch {
      need(false, "CRYPT_FAILED");
    } finally {
      // gpg-agent intentionally daemonizes out of its parent's process group.
      // Terminate only the agent for this owned, pinned private homedir.
      try {
        await runProcess(
          "gpgconf",
          ["--homedir", pin.path, "--kill", "gpg-agent"],
          undefined,
          { timeoutMs: 15000 },
        );
      } finally {
        await pin.close();
      }
    }
  }
  async function secret(name) {
    const qualification = await manifest();
    need(
      qualification.executionAdmitted && !qualification.hardBlock,
      "OPERATOR_NOT_QUALIFIED",
    );
    need(
      [
        "MIGRATION_DATABASE_URL",
        "RELEASE_1_11_1_BACKUP_AES256_KEY",
        "DIGITALOCEAN_ACCESS_TOKEN",
        "DIGITALOCEAN_APP_ID",
      ].includes(name),
      "SECRET_NAME_REJECTED",
    );
    try {
      const value = (
        await runProcess(
          "doppler",
          [
            "secrets",
            "get",
            name,
            "--project",
            "grove",
            "--config",
            "ops",
            "--plain",
          ],
          undefined,
          {
            cwd: "/home/elias/Development/bramble-labs",
            maxBytes: 64 * 1024,
            timeoutMs: 20000,
          },
        )
      )
        .toString()
        .trim();
      need(value, "SECRET_UNAVAILABLE");
      return value;
    } catch {
      need(false, "SECRET_UNAVAILABLE");
    }
  }
  function readClient(url) {
    assertOwnerTarget(url);
    const c = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: true, ca: readFileSync(CA) },
      connectionTimeoutMillis: 10000,
      statement_timeout: 10000,
      application_name: "grove-qualified-readonly",
      options:
        "-c default_transaction_read_only=on -c idle_in_transaction_session_timeout=180000 -c transaction_timeout=180000",
    });
    c.on("error", () => {});
    return c;
  }
  return { crypt, secret, readClient };
}
export async function verifyClient(client) {
  need(
    client.connection?.stream?.encrypted === true &&
      client.connection.stream.authorized === true,
    "TLS_UNVERIFIED",
  );
  const r = (
    await client.query(
      "SELECT current_database() AS database,current_user AS role,current_setting('default_transaction_read_only') AS readonly,current_setting('server_version_num') AS server,current_setting('composite_type_mismatch') AS mismatch",
    )
  ).rows[0];
  need(
    r.database === "grove" &&
      r.role === "grove_owner" &&
      r.readonly === "on" &&
      r.server === "170012" &&
      r.mismatch === "error",
    "DATABASE_IDENTITY_DRIFT",
  );
  return { tlsVerified: true, server: r.server, readOnly: true };
}
export const secret = async (name, options = {}) =>
  (await import("./installation.mjs"))
    .loadInstallation(options)
    .then((i) => i.io.secret(name));
export const qualify = async (...args) =>
  (await import("./installation.mjs"))
    .loadInstallation({ readOnly: args[0]?.consume === false })
    .then((i) => i.qualify(...args));
// No documented provider CAS exists. Local files/leases cannot fence dashboard
// writers. Remain blocked until an independently enforced authority is supplied.
export const assertExclusiveWindow = async (...args) =>
  (await import("./installation.mjs"))
    .loadInstallation()
    .then((i) => i.window.assert(...args));
export const prepareProviderWrite = async (...args) =>
  (await import("./installation.mjs"))
    .loadInstallation()
    .then((i) => i.window.prepare(...args));
export const finishProviderWrite = async (...args) =>
  (await import("./installation.mjs"))
    .loadInstallation()
    .then((i) => i.window.finish(...args));
export const readbackProviderWrite = async (...args) =>
  (await import("./installation.mjs"))
    .loadInstallation({ readOnly: true })
    .then((i) => i.window.readback(...args));
export const databaseLibrary = async (options = {}) =>
  (await import("./installation.mjs"))
    .loadInstallation(options)
    .then((i) => i.database);
export const prepareDatabaseWrite = async (command, state) =>
  (await import("./installation.mjs")).loadInstallation().then((i) =>
    i.window.prepare(command, state, {
      kind: "sql",
      proofHash: command.proposed,
    }),
  );
export const finishDatabaseWrite = async (command, state, proof) =>
  (await import("./installation.mjs")).loadInstallation().then((i) =>
    i.window.finish(command, state, {
      kind: "sql",
      proofHash: proof.proofHash,
    }),
  );
export const readbackDatabaseWrite = async (command, state, proof) =>
  (await import("./installation.mjs"))
    .loadInstallation({ readOnly: true })
    .then((i) =>
      i.window.readback(command, state, {
        kind: "sql",
        proofHash: proof.proofHash,
      }),
    );
export const resolveDatabaseWrite = async (command, state, proof) =>
  (await import("./installation.mjs")).loadInstallation().then((i) =>
    i.window.resolveSQL(command, state, {
      kind: "sql",
      proofHash: proof.proofHash,
    }),
  );
export const resolveProviderWrite = async (...args) =>
  (await import("./installation.mjs"))
    .loadInstallation()
    .then((i) => i.window.resolveProvider(...args));
export const resolveIdleWrite = async (...args) =>
  (await import("./installation.mjs"))
    .loadInstallation()
    .then((i) => i.window.resolveIdle(...args));
