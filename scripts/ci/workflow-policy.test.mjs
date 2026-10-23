import assert from "node:assert/strict";
import { URL } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const pins = {
  "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node": "949feb2413d6458794dcd2491c4babbbce0c15c1",
  "actions/upload-artifact": "cf430e030ddbb5b0abf93d22962f4752f3646cd9",
  "actions/download-artifact": "9000827ccba6bdab643e8b6fd33ac0654aef8333",
  "actions/cache/restore": "55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
  "actions/cache/save": "55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
  "googleapis/release-please-action":
    "45996ed1f6d02564a971a2fa1b5860e934307cf7",
  "docker/setup-buildx-action": "f87e5991a6d7451dcb8d9637bfbc97413f497069",
  "docker/build-push-action": "c3c9e263c25d99ce0380d002d59b67737d91b0dc",
  "docker/login-action": "dbcb813823bdd20940b903addbd779551569679f",
  "opentofu/setup-opentofu": "a1320f892987e89d278cc92dc5adc984fb93aca4",
};
test("all workflows retain the family action pins and trusted checkout boundary", () => {
  const directory = new URL("../../.github/workflows/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) =>
    /\.ya?ml$/.test(name),
  )) {
    const text = readFileSync(new URL(file, directory), "utf8");
    assert.doesNotMatch(
      text,
      /pull_request_target:/,
      `${file}: untrusted privileged execution`,
    );
    for (const [, use] of text.matchAll(/\buses: ([^\s#]+)/g)) {
      if (use.startsWith("./")) continue;
      const [action, sha] = use.split("@");
      assert.match(sha ?? "", /^[a-f0-9]{40}$/, `${file}: unpinned ${action}`);
      if (pins[action])
        assert.equal(
          sha,
          pins[action],
          `${file}: family pin drift for ${action}`,
        );
    }
    for (const block of text.split(/\n\s+- uses: actions\/checkout@/).slice(1))
      assert.match(
        block.split(/\n\s+- /)[0],
        /persist-credentials: false/,
        `${file}: persisted checkout credentials`,
      );
  }
});
