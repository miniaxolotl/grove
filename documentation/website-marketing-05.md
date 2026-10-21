# Collection 05 website materials

The website leads with a private notebook that makes saved notes easy to find.
The main action is notebook signup. The developer section explains saved context
across coding sessions and links to agent setup.

## Assets

- Search and journal graphics use Collection 05 notebook artwork.
- The interactive notebook and Ask Grove previews demonstrate the supported tasks.
- The approved Sprout mark and Space Grotesk/JetBrains Mono typography remain.
- Share metadata, the brand page, product description and media kit are refreshed.
- `packages/website/public/materials/manifest.json` records sources and hashes.
- The media kit includes logos, fonts, licenses, illustrations and product copy.

Exports come from `marketing/_source/export-websites-05.mjs` in the local dataset,
using `artwork.mjs`, `grove-notebook-art.mjs`, `current-campaigns.mjs` and the design
guidelines. Graphics are labeled as illustrated examples with sample notes.

## Review

Copy uses short, direct language and standard punctuation. Existing browser checks
cover signup links, keyboard previews, agent installation, accessibility, sharing,
telemetry privacy and the private workspace. Only the changed empty-preview text
and setup-heading expectations are updated.

Verified 21 October 2026: website lint/types/build, the 68-case browser suite
(including the corrected copy assertion), root lint/types/build, five packed
artifact tests, 12 release contracts and workflow lint pass. The ten marketing
browser cases pass again after the final copy edits. Additional reviews at
320, 390, 768 and 1440px pass accessibility, overflow, image and download checks.
Identity hashes, font licenses and media-kit archive contents verify.

Publication follows `deploy.md` through protected development, Release Please
and the selected frozen production candidate.
