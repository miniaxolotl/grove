import { checker } from "./fixtures/harper-checker.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { writingSettingsSchema } from "../../lib/shared/src/writing-core.ts";

const settings = writingSettingsSchema.parse({ grammar: false });

test("Watchlist and common note vocabulary are recognized without accepting arbitrary compounds", async () => {
  const source = [
    "# Watchlist",
    "Compare both watchlists with the audiobook wishlist.",
    "Save the livestream permalink and the screenshot's caption.",
    "Review the watchlist’s backlinks, roadmap subtasks and handoff walkthrough.",
    "Check the watchbucket and the Wtachlists.",
  ].join("\n");
  const issues = (await checker.check(source, settings)).issues;
  assert.deepEqual(
    issues.map((issue) => issue.original),
    ["watchbucket", "Wtachlists"],
  );
  for (const issue of issues) {
    assert.equal(source.slice(issue.from, issue.to), issue.original);
    assert.ok(issue.replacements.length);
  }
});

test("dictionary suggestions correct note words and preserve a possessive’s apostrophe style", async () => {
  for (const [typo, correction] of [
    ["Watchlsit", "Watchlist"],
    ["watchlst", "watchlist"],
    ["Watchlst’s", "Watchlist’s"],
    ["watchlst's", "watchlist's"],
    ["backlnik", "backlink"],
  ]) {
    assert.equal(
      (await checker.check(typo, settings)).issues[0].replacements[0],
      correction,
      typo,
    );
  }
});

// Each note pairs ordinary vocabulary with a nearby misspelling. Check both
// inline detection and the first correction when the reader opens the issue.
for (const [topic, source, typo, correction] of [
  [
    "reading",
    "The ereader’s ebooks have endnotes. Add the webcomic to the booklist and discuss its worldbuilding and fanfiction. Save the endntoe.",
    "endntoe",
    "endnote",
  ],
  [
    "cooking",
    "Get tahini, gochujang, miso, kimchi, tempeh and farro. Make the frittatas on the stovetop; grate the zest with the zesetr.",
    "zesetr",
    "zester",
  ],
  [
    "media",
    "The showrunner’s filmography includes two docuseries. We rewatched the cutscene with the voiceover and saved the mixtpae.",
    "mixtpae",
    "mixtape",
  ],
  [
    "personal planning",
    "Plan a weeklong staycation: pack the daypacks, schedule playdates and set up autopay. Submit the timeshetes first.",
    "timeshetes",
    "timesheets",
  ],
  [
    "design",
    "The wireframes show draggable tooltips. Check the artboard’s kerning and grayscale at narrow viewports, then update the mockpu.",
    "mockpu",
    "mockup",
  ],
  [
    "technical notes",
    "The linter checks both codebases. Update the middleware, stylesheets and webhook’s hostname; document the toolchain in the chagnelog.",
    "chagnelog",
    "changelog",
  ],
]) {
  test(`recognizes ${topic} vocabulary and suggests the nearby correction`, async () => {
    assert.deepEqual(
      (await checker.check(source, settings)).issues.map(
        (issue) => issue.original,
      ),
      [typo],
    );
    assert.equal(
      (await checker.check(typo, settings)).issues[0].replacements[0],
      correction,
    );
  });
}

test("note words take only the suffixes appropriate to their usage", async () => {
  const accepted = [
    "filmographies",
    "docuseries",
    "docuseries’s",
    "middleware's",
    "timeboxes",
    "timebox’s",
    "timeboxed",
    "timeboxing",
    "livestreamed",
    "livestreaming",
    "wireframed",
    "wireframing",
    "declutters",
    "decluttered",
    "decluttering",
    "scrollable",
    "monospaced",
  ];
  const rejected = [
    "filmographys",
    "docuserieses",
    "middlewares",
    "timeboxs",
    "timeboxxed",
    "wireframeing",
    "declutter's",
    "declutterred",
    "scrollables",
    "monospaced’s",
    "artboarded",
    "webhooking",
    "timesheetss",
    "endnotebooklist",
  ];
  assert.deepEqual(
    (
      await checker.check([...accepted, ...rejected].join(" "), settings)
    ).issues.map((issue) => issue.original),
    rejected,
  );
});

test("personal names and acronyms keep their singular possessive without masking other suffixes", async () => {
  const source =
    "Bramblewick’s notes on the API's limits and the SDK’s roadmap. Bramblewick’ll share Zorbleck’s notes.";
  const issues = (
    await checker.check(source, {
      ...settings,
      words: ["Bramblewick"],
    })
  ).issues;
  assert.deepEqual(
    issues.map((issue) => issue.original),
    ["Bramblewick’ll", "Zorbleck’s"],
  );
  assert.deepEqual(
    (await checker.check("Bramblewick’s notes", settings)).issues.map(
      (issue) => issue.original,
    ),
    ["Bramblewick’s"],
  );
});
