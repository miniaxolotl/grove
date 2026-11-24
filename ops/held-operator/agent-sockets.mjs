// GnuPG versions differ in whether --kill removes an already-dead agent's sockets.
// Never unlink an accepting, unresponsive, replaced or non-socket entry.
import { lstat, unlink } from "node:fs/promises";
import { createConnection } from "node:net";
import process from "node:process";
import { need } from "./operator-control.mjs";

const names = [
  "S.gpg-agent",
  "S.gpg-agent.extra",
  "S.gpg-agent.browser",
  "S.gpg-agent.ssh",
];

async function socketAt(path) {
  try {
    const s = await lstat(path);
    need(
      s.isSocket() && s.uid === process.getuid() && s.nlink === 1,
      "GPG_AGENT_SOCKET_REJECTED",
    );
    return s;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function refused(path) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.once("close", () => (error ? reject(error) : resolve()));
      socket.destroy();
    };
    socket.once("connect", () => finish(Error("GPG_AGENT_STILL_ACTIVE")));
    socket.once("error", (e) =>
      finish(
        e.code === "ECONNREFUSED" ? null : Error("GPG_AGENT_SOCKET_UNCERTAIN"),
      ),
    );
    socket.setTimeout(1500, () => finish(Error("GPG_AGENT_SOCKET_UNCERTAIN")));
  });
}

export async function cleanupAgentSockets(pin) {
  await pin.assert();
  const stale = [];
  // Validate the complete fixed inventory before removing any entry.
  for (const name of names) {
    const path = pin.path + "/" + name;
    const before = await socketAt(path);
    if (!before) continue;
    await refused(path);
    stale.push({ path, before });
  }
  for (const { path, before } of stale) {
    await pin.assert();
    const current = await socketAt(path);
    if (!current) continue;
    need(
      current.dev === before.dev &&
        current.ino === before.ino &&
        current.ctimeMs === before.ctimeMs,
      "GPG_AGENT_SOCKET_CHANGED",
    );
    await unlink(path);
  }
  await pin.handle.sync();
}
