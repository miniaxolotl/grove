import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkDocumentation } from "./check.mjs";

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), "grove-docs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const file = join(root, name);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}

test("reports broken local files, images and heading fragments with source lines", async (t) => {
  const root = await fixture(t, {
    "documentation/a.md":
      "# A\n[missing](b.md)\n![image](lost.png)\n[bad](#absent)\n",
  });
  const result = await checkDocumentation(root);
  assert.deepEqual(
    result.errors.map((e) => e.code),
    ["missing-file", "missing-file", "missing-anchor"],
  );
  assert.deepEqual(
    result.errors.map((e) => e.line),
    [2, 3, 4],
  );
});

test("parses GFM references, duplicate and formatted headings, Unicode and HTML anchors", async (t) => {
  const root = await fixture(t, {
    "documentation/a.md":
      '# A\n[ref][target]\n[duplicate](b.md#hello-world-1)\n[unicode](b.md#café)\n[html](b.md#compat)\n<img src="image%20one.png">\n\n[target]: b.md#hello-world\n',
    "documentation/b.md":
      '# **Hello** `world`\n## Hello world\n## Café\n<a id="compat"></a>\n',
    "documentation/image one.png": "synthetic image",
  });
  assert.deepEqual((await checkDocumentation(root)).errors, []);
});

test("ignores code examples and remote/site URLs but checks linked repository files", async (t) => {
  const root = await fixture(t, {
    "documentation/a.md":
      "# A\n`[fake](no.md)`\n```md\n[example](no.md)\n```\n[web](https://example.com/no.md)\n[route](/app)\n[mail](mailto:a@example.com)\n[source](../lib/example.ts)\n",
    "lib/example.ts": "export {};",
  });
  const result = await checkDocumentation(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.files, 1);
});

test("rejects malformed URL encoding and paths outside the repository", async (t) => {
  const root = await fixture(t, {
    "documentation/a.md":
      "# A\n[escape](../../outside.md)\n[bad](oops%ZZ.md)\n",
  });
  assert.deepEqual(
    (await checkDocumentation(root)).errors.map((e) => e.code),
    ["outside-repository", "invalid-url"],
  );
});

test("checks incoming root README and agent-guide links as well as documentation", async (t) => {
  const root = await fixture(t, {
    "documentation/a.md": "# A\n",
    "README.md": "# Root\n[removed](documentation/gone.md)\n",
    "AGENTS.md": "# Agents\n[section](documentation/a.md#gone)\n",
  });
  const result = await checkDocumentation(root);
  assert.equal(result.files, 3);
  assert.deepEqual(result.errors.map((e) => e.code).sort(), [
    "missing-anchor",
    "missing-file",
  ]);
});

test("HTML images and reference definitions report broken targets rather than silently passing", async (t) => {
  const root = await fixture(t, {
    "documentation/a.md":
      '# A\n[ref][target]\n<img src="no.png">\n\n[target]: b.md#missing\n',
    "documentation/b.md": "# B\n",
  });
  assert.deepEqual(
    (await checkDocumentation(root)).errors.map((e) => e.code),
    ["missing-file", "missing-anchor"],
  );
});
