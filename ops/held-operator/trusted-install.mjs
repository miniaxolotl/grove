// Offline materialization only. Never installs/chowns code, loads credentials or
// initializes an authority. Parent reviews the returned closure before copying.
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  lstat,
  chmod,
  realpath,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join, dirname } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { need, sha } from "./operator-control.mjs";
import { runProcess } from "./operator-io.mjs";
import { verifySource } from "./qualification.mjs";
import { pinDirectory } from "./pinned-path.mjs";
import { pythonExecutable, isolatedPythonArgs } from "./python.mjs";

export async function stageTrustedInstall({
  repository,
  inventory,
  destination,
  run = runProcess,
}) {
  repository = resolve(repository);
  destination = resolve(destination);
  await mkdir(destination, { mode: 0o700 });
  const pin = await pinDirectory(destination),
    originalDestination = destination;
  destination = pin.path;
  try {
    const files = {},
      resolutions = [],
      packages = new Map(),
      copied = new Set();
    async function put(relative, bytes, executable = false) {
      need(
        !relative.startsWith("/") && !relative.split("/").includes(".."),
        "INSTALL_PATH_REJECTED",
      );
      const path = join(destination, relative);
      await mkdir(dirname(path), { recursive: true, mode: 0o755 });
      await writeFile(path, bytes, {
        flag: "wx",
        mode: executable ? 0o755 : 0o644,
      });
      await chmod(path, executable ? 0o755 : 0o644);
      files[relative] = sha(bytes);
    }
    async function copy(dir, prefix) {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        if (["node_modules", "__pycache__"].includes(item.name)) continue;
        need(!item.isSymbolicLink(), "INSTALL_SOURCE_SYMLINK");
        if (item.isDirectory())
          await copy(join(dir, item.name), prefix + "/" + item.name);
        else {
          need(item.isFile(), "INSTALL_SOURCE_ENTRY");
          const path = join(dir, item.name);
          await put(
            prefix + "/" + item.name,
            await readFile(path),
            !!((await lstat(path)).mode & 0o100),
          );
        }
      }
    }
    for (const folder of ["ops/held-operator", "scripts"])
      await copy(join(repository, folder), folder);
    for (const name of ["package.json", "pnpm-lock.yaml", ".do/app.json"])
      await put(name, await readFile(join(repository, name)));
    await pin.assert();
    const archive = await run("git", ["archive", inventory.source], undefined, {
      cwd: repository,
      maxBytes: 256 * 1024 * 1024,
    });
    await pin.assert();
    const sourceRoot = destination + "/admitted-source";
    await mkdir(sourceRoot, { mode: 0o755 });
    await run("tar", ["-x", "-C", sourceRoot], archive);
    await pin.assert();
    await verifySource(sourceRoot, inventory, { load: false });
    for (const name of Object.keys(inventory.files)) {
      const path = join(sourceRoot, name);
      await chmod(
        path,
        inventory.files[name].mode === "100755" ? 0o755 : 0o644,
      );
      files["admitted-source/" + name] = sha(await readFile(path));
    }
    async function packageRoot(name, from) {
      let path = dirname(createRequire(from).resolve(name));
      for (;;) {
        try {
          const pkg = JSON.parse(await readFile(path + "/package.json"));
          if (pkg.name === name) return { path, pkg };
        } catch {
          /* walk to owning package */
        }
        need(path !== dirname(path), "INSTALL_DEPENDENCY_ROOT");
        path = dirname(path);
      }
    }
    async function visit(name, from, target = "node_modules/" + name) {
      const { path, pkg } = await packageRoot(name, from);
      const previous = packages.get(target);
      need(
        !previous || previous.version === pkg.version,
        "INSTALL_DEPENDENCY_LAYOUT_CONFLICT",
      );
      packages.set(target, { version: pkg.version, path });
      if (copied.has(target)) return;
      copied.add(target);
      await copy(path, target);
      const dependencyTarget = (dep, version) => {
        for (let parent = target; ; parent = dirname(parent)) {
          const candidate =
              (parent === "." ? "" : parent + "/") + "node_modules/" + dep,
            known = packages.get(candidate);
          if (known)
            return known.version === version
              ? candidate
              : target + "/node_modules/" + dep;
          if (parent === ".") break;
        }
        return "node_modules/" + dep;
      };
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        const child = await packageRoot(dep, path + "/package.json");
        const location = dependencyTarget(dep, child.pkg.version);
        resolutions.push({
          from: target + "/package.json",
          specifier: dep,
          target: location + "/package.json",
          version: child.pkg.version,
        });
        await visit(dep, path + "/package.json", location);
      }
      for (const dep of Object.keys(pkg.optionalDependencies ?? {}))
        if (!pkg.dependencies?.[dep]) {
          let child;
          try {
            child = await packageRoot(dep, path + "/package.json");
          } catch (e) {
            if (e.code === "MODULE_NOT_FOUND") continue;
            throw e;
          }
          const location = dependencyTarget(dep, child.pkg.version);
          resolutions.push({
            from: target + "/package.json",
            specifier: dep,
            target: location + "/package.json",
          });
          await visit(dep, path + "/package.json", location);
        }
    }
    for (const name of ["pg", "knex", "objection", "fflate"]) {
      const from =
          name === "fflate"
            ? repository + "/package.json"
            : repository + "/lib/database/package.json",
        p = await packageRoot(name, from);
      packages.set("node_modules/" + name, {
        version: p.pkg.version,
        path: p.path,
      });
    }
    for (const name of ["pg", "knex", "objection"]) {
      resolutions.push({
        from: "admitted-source/lib/database/package.json",
        specifier: name,
        target: "node_modules/" + name + "/package.json",
      });
      await visit(name, repository + "/lib/database/package.json");
    }
    resolutions.push({
      from: "scripts/release/held-artifacts.mjs",
      specifier: "fflate",
      target: "node_modules/fflate/package.json",
    });
    await visit("fflate", repository + "/package.json");
    // Node is shipped with the reviewed bundle so a mutable per-user mise install
    // never becomes the production executable. Python/stdlib are root-owned OS
    // inputs, with concrete interpreter/module/cache hashes in the closure.
    await put(
      "bin/node",
      await readFile(await realpath(process.execPath)),
      true,
    );
    const script = fileURLToPath(new URL("./authority.py", import.meta.url));
    const toolchain = JSON.parse(
      (
        await runProcess(
          pythonExecutable,
          isolatedPythonArgs(script, "--toolchain"),
        )
      ).toString(),
    );
    const supervisorToolchain = JSON.parse(
      (
        await runProcess(
          pythonExecutable,
          isolatedPythonArgs(
            fileURLToPath(new URL("./subprocess.py", import.meta.url)),
            "--toolchain",
          ),
        )
      ).toString(),
    );
    const toolFiles = [];
    for (const path of [
      ...new Set([...toolchain.files, ...supervisorToolchain.files]),
    ].sort())
      toolFiles.push({ path, sha256: sha(await readFile(path)) });
    // This root-controlled trust-plane file holds the closure's own digest and
    // independent review key pin. Including it in its own hash is circular.
    delete files["scripts/release/held-operator-trust.json"];
    const closure = {
      schema: 1,
      base: "../..",
      files,
      resolutions,
      toolFiles,
      tools: {
        nodeSha256: files["bin/node"],
        pythonPath: await realpath(pythonExecutable),
        python: toolchain.python,
        sqlite: toolchain.sqlite,
      },
    };
    const bytes = JSON.stringify(closure, null, 2) + "\n";
    await writeFile(
      destination + "/ops/held-operator/qualified-code.json",
      bytes,
      { flag: "wx", mode: 0o644 },
    );
    await pin.assert();
    await pin.handle.chmod(0o755);
    return {
      root: originalDestination,
      sourceRoot: originalDestination + "/admitted-source",
      closureSha256: sha(bytes),
      files: Object.keys(files).length,
    };
  } finally {
    await pin.close();
  }
}
