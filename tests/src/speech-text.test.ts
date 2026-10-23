import assert from "node:assert/strict";
import { test } from "node:test";
import { speechText } from "@lib/shared/speech";

for (const [name, content, expected] of [
  [
    "indented code",
    "Before.\n\n    private_code()\n\nAfter.",
    "Before.\n\nAfter.",
  ],
  [
    "longer closing fence",
    "Before.\n\n```js\nprivate_code()\n````\n\nAfter.",
    "Before.\n\nAfter.",
  ],
  [
    "nested fenced code",
    "> Before.\n>\n> ~~~js\n> private_code()\n> ~~~~\n>\n> After.",
    "Before.\n\nAfter.",
  ],
  ["unfinished fence", "Before.\n\n```js\nprivate_code()", "Before."],
  [
    "reference destinations",
    '[The guide][docs].\n\n[docs]: https://private.example/path "Private title"',
    "The guide.",
  ],
  [
    "shortcut links",
    "Read [the guide].\n\n[the guide]: https://private.example/path",
    "Read the guide.",
  ],
  [
    "inline destinations and images",
    "[The guide](https://private.example/path) and **ordinary prose**.\n\n![Private image](https://private.example/image.png)",
    "The guide and ordinary prose.",
  ],
  [
    "reference media",
    "Before.\n\n[Recording][audio]\n\n![Image][picture]\n\n[audio]: grove-media:private-id\n[picture]: https://private.example/image.png\n\nAfter.",
    "Before.\n\nAfter.",
  ],
  [
    "inline code and HTML",
    "Before `private_code()` after.\n\n<script>private_code()</script>",
    "Before  after.",
  ],
  [
    "escaped prose",
    "Keep \\*literal\\* labels and [nested **words**](https://private.example).",
    "Keep *literal* labels and nested words.",
  ],
] as const) {
  test(`narration excludes Markdown data while preserving prose: ${name}`, () => {
    assert.equal(speechText(content), expected);
  });
}
