// Same network-none/tmpfs PG restore mechanism; custody/source are now explicit.
import { randomUUID } from "node:crypto";
import process from "node:process";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { open, mkdir, unlink, rmdir, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { IMAGE, runProcess } from "./operator-io.mjs";
import { need, hashJSON } from "./operator-control.mjs";
import { pinDirectory } from "./pinned-path.mjs";
import {
  readSnapshot,
  extraQueries,
  compareRestored,
  quote,
} from "./catalog.mjs";
const equal = (a, b) =>
  need(hashJSON(a) === hashJSON(b), "RESTORE_METADATA_DRIFT");
const fixtureDatabases = new WeakMap();
const ownedFixtures = new WeakMap();
export const isFixtureDatabase = (db) =>
  fixtureDatabases.get(db)?.alive() === true;
export const isOwnedFixture = (fixture) =>
  ownedFixtures.get(fixture)?.alive() === true;
export function createRestorer({
  control,
  sourceRoot,
  crypt,
  run = runProcess,
  clientFactory,
}) {
  const { Client } = createRequire(sourceRoot + "/lib/database/package.json")(
    "pg",
  );
  const makeClient = clientFactory ?? ((options) => new Client(options));
  async function createRestoreFixture(before, { secondDatabase = false } = {}) {
    await control.assertIdentity();
    const rootPin = await pinDirectory(control.root);
    let sourcePin;
    try {
      sourcePin = await pinDirectory(sourceRoot, { privateLeaf: false });
    } catch (e) {
      await rootPin.close();
      throw e;
    }
    const stable = async () => {
      await control.assertIdentity();
      await rootPin.assert();
      await sourcePin.assert();
    };
    const started = Date.now(),
      id = randomUUID(),
      name = "grove-qualified-restore-" + id,
      socketLeaf = rootPin.path + "/r-" + id.slice(0, 8),
      leasePath = rootPin.path + "/fixture.lock";
    let lease;
    try {
      await stable();
      lease = await open(
        leasePath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
    } catch {
      await sourcePin.close();
      await rootPin.close();
      need(false, "FIXTURE_BUSY");
    }
    let owned = false,
      socketOwned = false,
      closed = false;
    let socketHandle, socketPath;
    const clients = new Set();
    const connect = (
      database = "grove_restore",
      user = "cloud_admin",
      readOnly = false,
    ) => {
      need(!closed && socketHandle && socketPath, "FIXTURE_CLOSED");
      need(
        ["grove_restore", "grove_backup_restore"].includes(database) &&
          ["cloud_admin", "grove_owner", "grove_api", "grove_jobs"].includes(
            user,
          ),
        "FIXTURE_TARGET_REJECTED",
      );
      const c = makeClient({
        host: socketPath,
        user,
        database,
        connectionTimeoutMillis: 10000,
        statement_timeout: 10000,
        options: readOnly
          ? "-c default_transaction_read_only=on -c transaction_timeout=180000 -c idle_in_transaction_session_timeout=180000"
          : undefined,
      });
      c.on("error", () => {});
      clients.add(c);
      return c;
    };
    async function close() {
      if (closed) return;
      closed = true;
      try {
        for (const c of clients) await c.end().catch(() => {});
        if (owned) {
          await run("docker", ["stop", name], undefined, {
            timeoutMs: 30000,
          });
          await run("docker", ["rm", name]);
          owned = false;
        }
        if (socketOwned) {
          const s = await socketHandle.stat(),
            actual = await lstat(socketLeaf);
          need(
            s.dev === actual.dev &&
              s.ino === actual.ino &&
              !actual.isSymbolicLink(),
            "FIXTURE_SCRATCH_CHANGED",
          );
          await socketHandle.chmod(0o700);
          await rmdir(socketLeaf);
        }
        await unlink(leasePath);
      } finally {
        await lease.close();
        await socketHandle?.close();
        await sourcePin.close();
        await rootPin.close();
      }
    }
    try {
      await lease.writeFile(JSON.stringify({ id, pid: process.pid }) + "\n");
      await lease.sync();
      await rootPin.handle.sync();
      await stable();
      need(
        (
          await run("docker", [
            "image",
            "inspect",
            IMAGE,
            "--format",
            "{{.Id}}",
          ])
        )
          .toString()
          .trim() === IMAGE,
        "TOOLCHAIN_DRIFT",
      );
      await mkdir(socketLeaf, { mode: 0o777 });
      socketOwned = true;
      socketHandle = await open(
        socketLeaf,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      // From this point onward, daemon mounts and ALL PG clients address the
      // socket directory inode itself, never its replaceable child basename.
      socketPath = `/proc/${process.pid}/fd/${socketHandle.fd}`;
      need(
        Buffer.byteLength(socketPath + "/.s.PGSQL.5432") < 108,
        "FIXTURE_SOCKET_PATH_TOO_LONG",
      );
      await socketHandle.chmod(0o777);
      await stable();
      // The daemon binds this live child dirfd, not a re-resolved socket leaf.
      owned = true;
      await run("docker", [
        "run",
        "--detach",
        "--log-driver",
        "none",
        "--name",
        name,
        "--label",
        "bramble.task=grove-qualified-operator",
        "--label",
        "bramble.operator=" + id,
        "--network",
        "none",
        "--memory",
        "1g",
        "--tmpfs",
        "/var/lib/postgresql/data:rw,noexec,nosuid,size=768m",
        "--mount",
        `type=bind,src=${socketPath},dst=/socket`,
        "-e",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "-e",
        "POSTGRES_USER=cloud_admin",
        "-e",
        "POSTGRES_DB=grove_restore",
        "-e",
        "POSTGRES_INITDB_ARGS=--locale-provider=builtin --builtin-locale=C.UTF-8 --locale=C.UTF-8",
        IMAGE,
        "-c",
        "unix_socket_directories=/var/run/postgresql,/socket",
        "-c",
        "logging_collector=off",
        "-c",
        "log_destination=stderr",
        "-c",
        "log_statement=none",
        "-c",
        "log_min_error_statement=panic",
        "-c",
        "log_min_messages=panic",
      ]);
      owned = true;
      await stable();
      const socketIdentity = await socketHandle.stat();
      need(
        (await run("docker", ["exec", name, "stat", "-Lc", "%d:%i", "/socket"]))
          .toString()
          .trim() === `${socketIdentity.dev}:${socketIdentity.ino}`,
        "FIXTURE_MOUNT_IDENTITY_CHANGED",
      );
      need(
        (
          await run("docker", [
            "inspect",
            name,
            "--format",
            "{{.HostConfig.LogConfig.Type}}",
          ])
        )
          .toString()
          .trim() === "none",
        "PRIVATE_LOGGING_REJECTED",
      );
      await run(
        "docker",
        [
          "exec",
          name,
          "sh",
          "-c",
          'for i in $(seq 1 45); do psql -h /socket -U cloud_admin -d grove_restore -Atc "SELECT 1" >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1',
        ],
        undefined,
        { timeoutMs: 50000 },
      );
      const admin = connect();
      await stable();
      await admin.connect();
      const version = (
        await admin.query(
          "SELECT current_setting('server_version_num') AS server,current_setting('composite_type_mismatch') AS mismatch",
        )
      ).rows[0];
      need(
        version.server === "170012" && version.mismatch === "error",
        "RESTORE_TOOLCHAIN_DRIFT",
      );
      if (before) {
        equal(
          before.extras.database.map(
            ({ effective_acl: _effective_acl, ...r }) => r,
          ),
          [
            {
              owner: "grove_owner",
              encoding: 6,
              datcollate: "C.UTF-8",
              datctype: "C.UTF-8",
              datlocprovider: "b",
              datlocale: "C.UTF-8",
            },
          ],
        );
        for (const role of before.metadata.roles.filter(
          (r) => r.rolname !== "cloud_admin",
        )) {
          need(
            !role.rolconfig?.length &&
              !role.rolvaliduntil &&
              Number.isInteger(role.rolconnlimit) &&
              role.rolconnlimit >= -1,
            "ROLE_SETTINGS_UNSUPPORTED",
          );
          const options = [
            ["SUPERUSER", role.rolsuper],
            ["INHERIT", role.rolinherit],
            ["CREATEROLE", role.rolcreaterole],
            ["CREATEDB", role.rolcreatedb],
            ["LOGIN", role.rolcanlogin],
            ["REPLICATION", role.rolreplication],
            ["BYPASSRLS", role.rolbypassrls],
          ]
            .map(([k, b]) => (b ? k : "NO" + k))
            .join(" ");
          await admin.query(
            `CREATE ROLE ${quote(role.rolname)} ${options} CONNECTION LIMIT ${role.rolconnlimit}`,
          );
        }
        for (const m of before.metadata.memberships)
          await admin.query(
            `GRANT ${quote(m.parent)} TO ${quote(m.member)} WITH ADMIN ${!!m.admin_option}, INHERIT ${!!m.inherit_option}, SET ${!!m.set_option}`,
          );
      } else {
        // Empty synthetic cluster only; no private rows or production roles.
        await admin.query(
          "CREATE ROLE grove_owner LOGIN CREATEROLE CREATEDB BYPASSRLS",
        );
      }
      const databases = secondDatabase
        ? ["grove_restore", "grove_backup_restore"]
        : ["grove_restore"];
      await admin.query("ALTER DATABASE grove_restore OWNER TO grove_owner");
      if (secondDatabase)
        await admin.query(
          "CREATE DATABASE grove_backup_restore OWNER grove_owner",
        );
      await admin.query("ALTER ROLE grove_owner SUPERUSER");
      try {
        for (const database of databases) {
          const c = connect(database);
          try {
            await c.connect();
            await c.query("SET ROLE grove_owner");
            await c.query("CREATE EXTENSION vector VERSION '0.8.0'");
            await c.query("CREATE EXTENSION pg_trgm VERSION '1.6'");
          } finally {
            await c.end();
            clients.delete(c);
          }
        }
      } finally {
        await admin.query("ALTER ROLE grove_owner NOSUPERUSER");
      }
      if (before)
        for (const database of databases) {
          const c = connect(database);
          try {
            await c.connect();
            for (const f of (await c.query(extraQueries.allPublicFunctions))
              .rows) {
              const wanted = before.extras.allPublicFunctions.find(
                (r) => r.signature === f.signature,
              );
              need(
                wanted && ["grove_owner", "cloud_admin"].includes(wanted.owner),
                "EXTENSION_OWNER_DRIFT",
              );
              if (f.owner !== wanted.owner)
                await c.query(
                  `ALTER FUNCTION ${f.signature} OWNER TO ${quote(wanted.owner)}`,
                );
            }
            for (const category of [
              "types",
              "operators",
              "operatorClasses",
              "operatorFamilies",
              "aggregates",
            ])
              for (const object of (await c.query(extraQueries[category]))
                .rows) {
                if (category === "types" && object.typname.startsWith("_"))
                  continue;
                const wanted = before.extras[category].find((r) =>
                  category === "types"
                    ? r.typname === object.typname
                    : ["operatorClasses", "operatorFamilies"].includes(category)
                      ? r.name === object.name && r.method === object.method
                      : r.signature === object.signature,
                );
                need(
                  wanted &&
                    ["grove_owner", "cloud_admin"].includes(wanted.owner),
                  "EXTENSION_OWNER_DRIFT",
                );
                if (object.owner === wanted.owner) continue;
                const sql =
                  category === "types"
                    ? `TYPE public.${quote(object.typname)}`
                    : category === "operators"
                      ? `OPERATOR ${object.signature}`
                      : category === "aggregates"
                        ? `AGGREGATE ${object.signature}`
                        : `OPERATOR ${category === "operatorClasses" ? "CLASS" : "FAMILY"} public.${quote(object.name)} USING ${quote(object.method)}`;
                await c.query(`ALTER ${sql} OWNER TO ${quote(wanted.owner)}`);
              }
          } finally {
            await c.end();
            clients.delete(c);
          }
        }
      await admin.end();
      clients.delete(admin);
      const fixture = {
        name,
        socketPath,
        connect,
        setupMs: Date.now() - started,
        close,
        async ownerDatabase() {
          need(!closed, "FIXTURE_CLOSED");
          await stable();
          const { createDatabase } = await import(
            "file://" + sourcePin.path + "/lib/database/src/index.ts"
          );
          await stable();
          const db = createDatabase(
            `postgresql://grove_owner@localhost/grove_restore?host=${encodeURIComponent(socketPath)}`,
            { max: 1, statementTimeoutMs: 10000 },
          );
          fixtureDatabases.set(db, { alive: () => !closed });
          return db;
        },
        async restore(dump, expected, { database = "grove_restore" } = {}) {
          await stable();
          need(databases.includes(database), "FIXTURE_TARGET_REJECTED");
          const start = Date.now();
          await run(
            "docker",
            [
              "exec",
              "-i",
              name,
              "pg_restore",
              "--exit-on-error",
              "-h",
              "/socket",
              "-U",
              "cloud_admin",
              "-d",
              database,
            ],
            dump,
          );
          const restoreMs = Date.now() - start,
            c = connect(database);
          try {
            await c.connect();
            const after = await readSnapshot(c);
            compareRestored(expected, after);
            return {
              restored: true,
              tables: after.tables.length,
              rows: Object.values(after.rowsets).reduce(
                (n, r) => n + r.count,
                0,
              ),
              restoreMs,
              securitySetting: "error",
              metadataStripped: false,
            };
          } finally {
            await c.end();
            clients.delete(c);
          }
        },
      };
      ownedFixtures.set(fixture, { alive: () => !closed });
      return Object.freeze(fixture);
    } catch (e) {
      try {
        await close();
      } catch {
        need(false, "FIXTURE_CLEANUP_FAILED");
      }
      throw e;
    }
  }
  async function restoreEncryptedBackup({ encrypted, key, before }) {
    const start = Date.now(),
      dump = await crypt(encrypted, key, true),
      fixture = await createRestoreFixture(before);
    let result;
    try {
      result = await fixture.restore(dump, before);
    } finally {
      await fixture.close();
    }
    return {
      ...result,
      totalMs: Date.now() - start,
      isolatedNetwork: "none",
      storage: "tmpfs",
      logDriver: "none",
      cleanupVerified: true,
    };
  }
  return { createRestoreFixture, restoreEncryptedBackup };
}
