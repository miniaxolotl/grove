// Linux pathname-to-dirfd boundary shared by offline staging and scratch leases.
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import process from "node:process";
import { need } from "./operator-control.mjs";
export async function pinDirectory(path, { privateLeaf = true } = {}) {
  need(isAbsolute(path) && resolve(path) === path, "PINNED_PATH_REJECTED");
  async function walk() {
    let fd = await open("/", constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      const parts = path.split("/").filter(Boolean);
      for (const [i, part] of parts.entries()) {
        const next = await open(
          `/proc/self/fd/${fd.fd}/${part}`,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        await fd.close();
        fd = next;
        const s = await fd.stat();
        need(
          [0, process.getuid()].includes(s.uid) &&
            !(s.mode & (privateLeaf && i === parts.length - 1 ? 0o077 : 0o022)),
          "PINNED_DIRECTORY_REJECTED",
        );
      }
      return fd;
    } catch (e) {
      await fd.close();
      throw e;
    }
  }
  const fd = await walk(),
    s = await fd.stat(),
    identity = `${s.dev}:${s.ino}`;
  return {
    path: `/proc/${process.pid}/fd/${fd.fd}`,
    handle: fd,
    identity,
    async assert() {
      const fresh = await walk();
      try {
        const n = await fresh.stat();
        need(`${n.dev}:${n.ino}` === identity, "PINNED_ROOT_CHANGED");
      } finally {
        await fresh.close();
      }
    },
    close: () => fd.close(),
  };
}
