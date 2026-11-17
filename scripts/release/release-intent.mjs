import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import console from "node:console";
import { pathToFileURL } from "node:url";

const plainVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseAs = /^Release-As:[ \t]*(.*)$/gim;

export function reconcileGroveReleaseHistory(tag, source, history) {
  const v16 = "0ee29d9c96b532af6ebfadc7c38026843c122029";
  const v19 = "7b36ba690553437a3d1c987db8d9b104f4f175fe";
  const superseded = "27eed31fad3269be923ecfe57ac04cd42b92e39a";
  const reaffirmed = "a30ec65fc6b72dfc60855a4bfaa24502d6415c78";
  const indexOf = (sha) => history.findIndex((commit) => commit.sha === sha);
  const footerOf = (message) =>
    [...message.matchAll(releaseAs)].map((match) => match[1].trim());

  let remove = -1;
  let expected;
  if (tag === "v1.11.16" && source === v16 && indexOf(superseded) >= 0) {
    // #198's store-preparation version was superseded by #211. Require the
    // actual merged Release Please PR (#196) between those two decisions.
    const selected = indexOf(reaffirmed);
    const generated = indexOf(v19);
    remove = indexOf(superseded);
    assert.ok(selected >= 0 && selected < generated && generated < remove);
    assert.deepEqual(footerOf(history[selected].message), ["1.11.19"]);
    expected = "1.11.18";
  } else if (tag === "v1.11.19" && source === v19) {
    // Release Please tags #196, not the later commit that reaffirmed it.
    remove = indexOf(reaffirmed);
    expected = "1.11.19";
  }
  if (remove >= 0)
    assert.deepEqual(footerOf(history[remove].message), [expected]);
  return history.map(({ message }, index) =>
    index === remove ? message.replace(releaseAs, "") : message,
  );
}

export function assertReleaseIntent(messages, currentVersion) {
  assert.match(currentVersion, plainVersion);
  assert.ok(
    Array.isArray(messages) &&
      messages.every((message) => typeof message === "string"),
  );
  const text = messages.join("\n\n").replaceAll("\r\n", "\n");
  const versions = [...text.matchAll(releaseAs)].map((match) =>
    match[1].trim(),
  );
  for (const version of versions)
    assert.match(
      version,
      plainVersion,
      "Use one plain Release-As: X.Y.Z decision",
    );
  assert.ok(
    new Set(versions).size <= 1,
    "Conflicting Release-As decisions require reconciliation",
  );
  const selected = versions[0] ?? null;
  if (/^[a-z]+(?:\([^\n)]+\))?!:[ \t]+|^BREAKING[ -]CHANGE:[ \t]*/im.test(text))
    assert.ok(
      selected,
      "Breaking changes require an explicit Release-As version decision",
    );
  if (selected) {
    const before = currentVersion.split(".").map(BigInt);
    const after = selected.split(".").map(BigInt);
    const index = after.findIndex((value, i) => value !== before[i]);
    assert.ok(
      index >= 0 && after[index] > before[index],
      "Release-As must advance the released version",
    );
  }
  return selected;
}

export function assertManifestVersion(released, manifest, selected) {
  assert.match(released, plainVersion);
  assert.match(manifest, plainVersion);
  if (manifest === released) return;
  if (selected) {
    assert.equal(
      manifest,
      selected,
      "Merged version differs from explicit Release-As decision",
    );
    return;
  }
  const before = released.split(".").map(BigInt);
  const after = manifest.split(".").map(BigInt);
  assert.ok(
    after[0] === before[0] &&
      after[1] === before[1] &&
      after[2] === before[2] + 1n,
    "Merged release version requires an explicit Release-As decision",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const git = (...args) =>
      execFileSync("git", args, {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
      });
    const tag = git(
      "tag",
      "--merged",
      "HEAD",
      "--list",
      "v*",
      "--sort=-version:refname",
    )
      .trim()
      .split("\n")
      .find((value) => plainVersion.test(value.slice(1)));
    const config = JSON.parse(
      readFileSync("release-please-config.json", "utf8"),
    );
    const base = tag ?? config["bootstrap-sha"];
    assert.ok(
      base && (tag || /^[a-f0-9]{40}$/.test(base)),
      "Release history or an explicit bootstrap boundary is required",
    );
    const records = git(
      "log",
      "--first-parent",
      "-z",
      "--format=%H%x00%B",
      `${base}..HEAD`,
    ).split("\0");
    assert.equal(records.pop(), "");
    assert.equal(records.length % 2, 0);
    const history = [];
    for (let i = 0; i < records.length; i += 2) {
      assert.match(records[i], /^[a-f0-9]{40}$/);
      history.push({ sha: records[i], message: records[i + 1] });
    }
    const messages = reconcileGroveReleaseHistory(
      tag,
      tag ? git("rev-parse", `${tag}^{commit}`).trim() : null,
      history,
    );
    const selected = assertReleaseIntent(
      messages,
      tag ? tag.slice(1) : "0.0.0",
    );
    if (tag) {
      const manifest = JSON.parse(
        readFileSync(".release-please-manifest.json", "utf8"),
      )["."];
      assert.equal(
        manifest,
        JSON.parse(readFileSync("package.json", "utf8")).version,
        "Root version ledger mismatch",
      );
      assertManifestVersion(tag.slice(1), manifest, selected);
    }
    console.log(
      "Patch-first release intent verified; explicit version decisions are consistent.",
    );
  } catch {
    console.error(
      "Release intent blocked: review breaking changes and supply one higher plain Release-As version; verify full tag history.",
    );
    process.exitCode = 1;
  }
}
