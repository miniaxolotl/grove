import assert from "node:assert/strict";
import { test } from "node:test";
import * as contract from "@lib/shared/internal-links";
import { findGroveLinks } from "@lib/shared/internal-link-source";
const id = "00000000-0000-4000-a000-000000000091";

test("reference editing follows the reader's first definition", () => {
  const href = `/app/memories/${id}`;
  const source = `[Read][Ref]\n\n[ref]: ${href}\n[REF]: /app/projects/${id}`;
  assert.equal(findGroveLinks(source)[0]?.resource.href, href);
});

test("authoring preserves literal entities and strikethrough syntax in captions and entity-like URLs", () => {
  const href = `/app/memories/${id}#A&amp;B`;
  const label = "~~draft~~ &copy;";
  const [link] = findGroveLinks(contract.createGroveLink(href, label, false));
  assert.equal(link.label, label);
  assert.equal(link.resource.href, href);
});

test("recognizing a Grove URL never authorizes a preview against a different installation", () => {
  assert.equal(
    contract.isLocalGroveLink(
      `/app/memories/${id}`,
      "https://notes.example.test",
    ),
    true,
  );
  assert.equal(
    contract.isLocalGroveLink(
      `https://grovenote.app/app/memories/${id}`,
      "https://notes.example.test",
    ),
    false,
  );
  assert.equal(
    contract.isLocalGroveLink(
      `https://usegrove.cloud/app/memories/${id}`,
      "https://grovenote.app",
    ),
    true,
  );
  assert.equal(
    contract.isLocalGroveLink(
      `https://outside.example/app/memories/${id}`,
      "https://grovenote.app",
    ),
    false,
  );
});

test("an explicitly authored URL caption stays literal while a raw autolink can follow its title", () => {
  const href = `https://grovenote.app/app/memories/${id}`;
  const source = `${contract.createGroveLink(href, href, false)}\n\n${href}\n\n<${href}>`;
  const links = findGroveLinks(source);
  assert.equal(links.length, 3);
  assert.equal(links[0].followTitle, false);
  assert.equal(links[1].followTitle, true);
  assert.equal(links[2].followTitle, true);
});

test("Grove link parsing preserves note revisions, notebook IDs and passage fragments", async () => {
  const { parseGroveLink } = contract;
  assert.deepEqual(
    parseGroveLink(`/app/memories/${id}?revision=12#passage-2`),
    {
      kind: "note",
      id,
      href: `/app/memories/${id}?revision=12#passage-2`,
      revision: 12,
    },
  );
  assert.deepEqual(
    parseGroveLink(`https://grovenote.app/app/projects/${id}#notes`),
    {
      kind: "notebook",
      id,
      href: `https://grovenote.app/app/projects/${id}#notes`,
    },
  );
  assert(parseGroveLink(`https://usegrove.cloud/app/memories/${id}`));
  assert(
    parseGroveLink(
      `http://127.0.0.1:4522/app/memories/${id}`,
      "http://127.0.0.1:4522",
    ),
  );
});

test("unsupported schemes, hosts, malformed IDs and ambiguous revision links never become previews", async () => {
  const { parseGroveLink } = contract;
  for (const href of [
    `https://example.com/app/memories/${id}`,
    `https://grovenote.app.evil.test/app/memories/${id}`,
    `https://user:password@grovenote.app/app/memories/${id}`,
    `//grovenote.app/app/memories/${id}`,
    `http://grovenote.app/app/memories/${id}`,
    `javascript:alert(1)`,
    `data:text/html,private`,
    `/app/memories/not-an-id`,
    `/app/memories/${id}/delete`,
    `/app/memories/${id}?revision=0`,
    `/app/memories/${id}?revision=2&revision=3`,
    `/app/memories/${id}?revision=999999999999999999`,
    `/app/memories/${id}\n`,
    `/app\\memories\\${id}`,
    `/app/memories/${id}?q=${"x".repeat(4096)}`,
  ])
    assert.equal(parseGroveLink(href), null, href);
});

test("versioned title markers opt into live labels without converting custom labels", async () => {
  const { groveTitleMarker, followsGroveTitle } = contract;
  const href = `/app/memories/${id}`;
  assert.equal(groveTitleMarker, "grove:title:v1");
  assert.equal(
    followsGroveTitle("Saved readable title", href, groveTitleMarker),
    true,
  );
  assert.equal(followsGroveTitle("Custom caption", href, undefined), false);
  assert.equal(
    followsGroveTitle("Custom caption", href, "grove:title:v2"),
    false,
  );
  assert.equal(followsGroveTitle(href, href, undefined, true), true);
  assert.equal(followsGroveTitle(href, href, undefined), false);
});

test("source link insertion preserves literal labels and parsing ignores code and foreign links", async () => {
  const { createGroveLink, groveTitleMarker } = contract;
  const href = `/app/memories/${id}?revision=3#exact-passage`;
  const label = "Read [this] *literally*";
  const followed = createGroveLink(href, label, true);
  const custom = createGroveLink(href, label, false);
  const source = `Before\n\n${followed}\n\n${custom}\n\n\`${followed}\`\n\n\`\`\`md\n${followed}\n\`\`\`\n\n[External](https://example.com/app/memories/${id})\n`;
  const links = findGroveLinks(source);
  assert.equal(links.length, 2);
  assert.equal(links[0].label, label);
  assert.equal(links[0].title, groveTitleMarker);
  assert.equal(links[0].followTitle, true);
  assert.equal(links[1].label, label);
  assert.equal(links[1].followTitle, false);
  assert.equal(links[0].resource.revision, 3);
  assert.equal(source.slice(links[0].from, links[0].to), followed);
  assert.throws(
    () => createGroveLink("https://example.com/private", label, true),
    /Grove/,
  );
});
