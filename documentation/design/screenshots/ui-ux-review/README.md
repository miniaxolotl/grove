# UI/UX review evidence

26 November 2026. [Findings and proposed direction](../../review/ui-ux.md).
These are **before** captures, not redesign previews.

## Web workspace

Development `622ca2b0b5b98801c21166be9d00965f72bfe42d`, product 1.11.37.
Actual components in the existing isolated dashboard fixture, built production
CSS, system UI text and synthetic notes/account/API responses. All viewports are
900px tall. No real account content, provider calls or production authentication.

| Notes, desktop                     | Notes, tablet                    | Notes, phone                     | Notes, narrow phone              |
| ---------------------------------- | -------------------------------- | -------------------------------- | -------------------------------- |
| ![Notes at 1440px](notes-1440.png) | ![Notes at 768px](notes-768.png) | ![Notes at 390px](notes-390.png) | ![Notes at 320px](notes-320.png) |

The 320px list uses progressive loading; “4+ notes” is the loaded count, not an
incorrect claim that the synthetic library contains only four notes.

| Editor, desktop                      | Editor, phone                      | Ask, desktop                         | Ask, phone                         |
| ------------------------------------ | ---------------------------------- | ------------------------------------ | ---------------------------------- |
| ![Editor at 1440px](editor-1440.png) | ![Editor at 390px](editor-390.png) | ![Empty Ask at 1440px](ask-1440.png) | ![Empty Ask at 390px](ask-390.png) |

| Writing settings, desktop                        | Writing settings, phone                        |
| ------------------------------------------------ | ---------------------------------------------- |
| ![Writing settings at 1440px](settings-1440.png) | ![Writing settings at 390px](settings-390.png) |

No horizontal page overflow or JavaScript page errors in these ten states.
Axe findings and their qualification are in the review; no full accessibility,
physical-device or production journey acceptance is claimed. The editor’s transient
Checking state is not proof of finished proofing or production service health.

## Extension

Same source, locally built Chrome package installed in isolated Chromium
156.0.8078.4 with mocked account/API/model responses. The synthetic example sentence
comes from the existing test fixture, not account data. Notes/Settings are 390×844;
writing alternatives are 320×480. A diagnostic capture changed only the test
navigation to expose Notes/Settings, not product code.

| Notes                                              | Settings                                                  | Writing alternatives                                                                       |
| -------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ![Extension note capture](extension-notes-390.png) | ![Extension writing settings](extension-settings-390.png) | ![Writing alternatives with explicit Copy but implicit replace](extension-writing-320.png) |

The host test initially failed a short-viewport geometry assertion; a fresh
unmodified Chrome run passed. The intermittent observation remains in the review.
This is not a full cross-browser installed-suite pass. No live AI, native
permission prompts or cross-store/browser-version parity is claimed.

## Broader workflow evidence

Same source/build and synthetic fixture boundaries as above. The broader run
captured 23 web states at 1440/390×900 with no page overflow or JavaScript page
errors. Six focused phone captures additionally cover deletion cancellation,
export options, uncommitted public-sharing selection, import entry, scrolled file
failure and stale notes. Those six also had no overflow or page errors; axe was
run on the 23-state set, not the focused interaction set.

Selected captures follow; the full temporary capture set is not shipped. Desktop
axe repeats the shell accessible-name mismatches described in the review.

| Expanded Writing, desktop                                                                          | Expanded Writing, phone                                        |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| ![Master control and dependent writing options at the same indentation](writing-expanded-1440.png) | ![Expanded writing options at 390px](writing-expanded-390.png) |

These two additional captures open More writing options and advanced rules without
changing a setting. Both have no horizontal page overflow; no additional axe or
page-error measurement is claimed for this small disclosure-only run. They show
why parent/child grouping and balanced layout matter more than adding dividers.

| Notebooks                                            | Real relationship graph                           | AI settings                                    | Files                                       |
| ---------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| ![Notebook management at 1440px](notebooks-1440.png) | ![Synthetic note graph at 1440px](graph-1440.png) | ![AI settings at 1440px](ai-settings-1440.png) | ![Uploaded files at 1440px](files-1440.png) |

| Connections                                                                        | Pending browser approval                                                                       | Pending agent approval                                                        | API-key scope                                                    |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ![Installation options precede existing connections at 390px](connections-390.png) | ![Browser read and write selected, delete and AI writing unselected](browser-approval-390.png) | ![Agent access summary and Customize access at 390px](agent-approval-390.png) | ![API-key selected capabilities at 390px](api-key-scope-390.png) |

Browser approval is seeded with an empty-capability pending connection, **not** an
already-approved receipt. Browser, agent and API-key defaults differ. No approval,
key creation or revocation was submitted.

| Note deletion                                                                | Stale notes                                                                                           | File refresh failure                                                                      | Public-sharing selection                                                   |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| ![Delete warning omits ordinary restore unavailability](delete-note-390.png) | ![Loaded notes retained with a visible Retry but no visible failure explanation](stale-notes-390.png) | ![Error after scrolling below expanded storage and filters](files-error-scrolled-390.png) | ![Anyone with the link selected before Create link](share-pending-390.png) |

The deletion dialog initially focused Cancel and was cancelled. Note-row opening
left the URL at `/app`; reload returned to the list without the detail dialog.
The induced stale-note refresh kept two rows. With storage expanded, the file
failure alert began around y=1002 in a 900px viewport at scroll 0, and loaded file
rows disappeared; the image deliberately scrolls to the actual alert rather than
presenting an unchanged top viewport as evidence. No API mutations were attempted
in these focused interactions. The synthetic failure is not a live outage.

| Import entry                                                                           | Note export options                                                          | Extension Search                                                          | Extension reader                                           |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| ![Import destination and file constraints before choosing files](import-notes-390.png) | ![Note export options without preparing or downloading](export-note-390.png) | ![Extension Search result with overflow action](extension-search-390.png) | ![Focused extension note reader](extension-reader-390.png) |

The extension additions are 390×844 captures from the unmodified Chrome host
suite, same isolated Chromium version and mocked HTTP/models. The synthetic
`<script>` text, “Unsafe” link and “No tracking” image fallback are deliberate
sanitization fixtures, not product copy or real account content. Copied receipts
reflect preceding test actions. Selected Chrome- and Edge-package host cases
passed on Chromium; this does not establish branded Edge/Firefox, native prompts,
real models, published store versions or production acceptance.

Import entry was closed without choosing files; export options were closed
without preparing/downloading a file; sharing was closed without Create link.
Worker completion, download integrity, live publication and erasure are untested.

## Public entry pages

Live `grovenote.app`, captured 26 November 2026. Home requested 1440×900 and its
scrollbar-adjusted capture is 1425×900; install is 1461×1008. Deployed source identity
was not established. These are public pages only; no sign-in or account changes.
The install screenshot records stale Chrome availability copy, not the owner’s
current store-approval state.

| Home                                      | Install                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| ![Live public home](public-home-1440.png) | ![Live install page with stale Chrome availability wording](public-install.png) |
