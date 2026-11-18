import { checker } from "./fixtures/harper-checker.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  writingSettingsSchema,
} from "../../lib/shared/src/writing-core.ts";

const settings = writingSettingsSchema.parse({ grammar: false });
for (const [field, prose, typo, correction] of [
  [
    "software",
    "The serializers share a namespace and a read-only datastore.",
    "serialzier",
    "serializer",
  ],
  [
    "science",
    "Compare the spectrograms and the exoplanet’s albedo.",
    "exoplnaet",
    "exoplanet",
  ],
  [
    "law",
    "The appellees invoked estoppel and challenged severability.",
    "severabiltiy",
    "severability",
  ],
  [
    "medicine",
    "The echocardiogram showed tachycardia during spirometry.",
    "spiromerty",
    "spirometry",
  ],
  [
    "finance",
    "The fintech report includes drawdowns and chargebacks.",
    "chargbeack",
    "chargeback",
  ],
  [
    "geography",
    "Overlay the isochrones on the geospatial basemap.",
    "baseamp",
    "basemap",
  ],
  [
    "education",
    "The microcredentials recognize progress in metacognition.",
    "microcredentail",
    "microcredential",
  ],
  [
    "music",
    "The soundscape uses a polyrhythm and several overdubs.",
    "polyrhtyhm",
    "polyrhythm",
  ],
] as const) {
  test(`recognizes ${field} terminology while still correcting nearby errors`, async () => {
    assert.deepEqual(
      (await checker.check(prose, settings)).issues.map((i) => i.original),
      [],
    );
    assert.deepEqual(
      (await checker.check(typo, settings)).issues.map((i) => i.original),
      [typo],
    );
    assert.ok((await checker.check(typo, settings)).issues[0].replacements.includes(correction));
  });
}
