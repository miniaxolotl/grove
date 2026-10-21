import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const telemetryDirectory = () =>
  process.env.GROVE_CONFIG_HOME ??
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "grove");
export function environmentDisabled() {
  return (
    process.env.DO_NOT_TRACK === "1" ||
    !!process.env.CI ||
    process.env.GROVE_PRIVATE === "1" ||
    ["0", "false"].includes(process.env.GROVE_TELEMETRY?.toLowerCase() ?? "")
  );
}
export function telemetryDisabled(directory = telemetryDirectory()) {
  if (environmentDisabled()) return true;
  try {
    lstatSync(join(directory, "telemetry-disabled"));
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}
function privateDirectory(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Telemetry storage unavailable");
  chmodSync(directory, 0o700);
}
function readIdentity(directory: string) {
  const path = join(directory, "telemetry-id");
  const info = lstatSync(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.size > 100
  )
    return "";
  const id = readFileSync(path, "utf8").trim();
  return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    id,
  )
    ? id
    : "";
}
export function installationIdentity(directory = telemetryDirectory()) {
  try {
    if (telemetryDisabled(directory)) return "";
    privateDirectory(directory);
    const path = join(directory, "telemetry-id");
    try {
      const fd = openSync(path, "wx", 0o600);
      try {
        writeFileSync(fd, `${randomUUID()}\n`);
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return "";
    }
    return telemetryDisabled(directory) ? "" : readIdentity(directory);
  } catch {
    return "";
  }
}
export function identityAllowed(id: string, directory = telemetryDirectory()) {
  try {
    return (
      !!id && !telemetryDisabled(directory) && readIdentity(directory) === id
    );
  } catch {
    return false;
  }
}
export function resetTelemetryIdentity(directory = telemetryDirectory()) {
  try {
    unlinkSync(join(directory, "telemetry-id"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
export function setTelemetryEnabled(
  enabled: boolean,
  directory = telemetryDirectory(),
) {
  privateDirectory(directory);
  const path = join(directory, "telemetry-disabled");
  if (!enabled) {
    // Publish disable before clearing the identity. Existing processes recheck
    // both at upload; re-enable never revives their old identity.
    writeFileSync(path, "disabled\n", { mode: 0o600 });
    resetTelemetryIdentity(directory);
  } else {
    resetTelemetryIdentity(directory);
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
