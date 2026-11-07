# Bundled English spelling dictionary

`en.aff` / `en.dic` are pinned copies of `dictionary-en@4.0.0`
(SCOWL-derived American English), the same dataset version the browser
extension bundles. They are fetched lazily by the note editor on first
eligible edit only — never during sign-in, search or boot — and stay on
this origin: no third-party dictionary download, no proofing text leaves
the device for local checks.

- Source: <https://github.com/wooorm/dictionaries/tree/main/dictionaries/en>
- License: `(MIT AND BSD)` — see package `license` file and the Titus Wormer /
  Thomas Beverley attributions in `dictionary-en`'s readme.
- Update rule: bump `dictionary-en` in `packages/browser-extension/package.json`
  and re-copy both files in the same commit so the extension and the webapp
  never disagree on spelling.
