# Grove UI and UX review

26 November 2026. Review of the web workspace and browser extension, with a
secondary check of public entry pages. **Recommendations, not implemented changes.**

## Verdict

Grove is already past the most obvious AI-template styling. The remaining problem
is **a generic tool shell with too much interface around the work**: navigation,
search modes, formatting controls, explanatory sentences and repeated metadata.
Removing more decoration alone would make it plainer, not more distinctive.

The three highest-value changes are:

- Give mobile screens back to the note or question, rather than navigation.
- Replace routine explanations with clear controls, examples and compact status.
- Make a note’s source and its use in an answer Grove’s recognizable interaction.

## Evidence and limits

- Source: development `622ca2b0b5b98801c21166be9d00965f72bfe42d`, product
  1.11.37. Workspace captures use actual components, production-build CSS and
  synthetic account/API fixtures. No production-auth bypass or account edits.
- Notes reviewed at 1440, 768, 390 and 320px; editor, Ask and Writing settings at
  1440 and 390px. All ten captured states had no horizontal page overflow or
  JavaScript page errors. This is not full journey, keyboard or device acceptance.
- Extension captures use the current built Chrome package in isolated Chromium
  156.0.8078.4, synthetic text and mocked HTTP/model responses. No live AI calls.
  This does not establish parity with every published store version or browser.
- Public home, sign-in and install were inspected live. `/app` redirected to
  sign-in; authenticated production behavior was not reviewed. The homepage uses
  a different public text face from the system UI in the workspace and extension.
- The owner confirms **all browser extensions are store-approved**. The old
  local-install-first Chrome language is a stale-copy finding, not an approval
  blocker. No store submission, store install or configuration change was performed.
- [Screenshots and provenance](../screenshots/ui-ux-review/README.md).

## Prioritized findings

### High: installation still looks unfinished

`packages/website/src/components/extension-store-links.tsx:18` labels Chrome
“not yet available”; its Settings variant routes Chrome through a setup guide and
repeats manual-install instructions at lines 74–87.
`packages/website/src/content/site.ts:41` repeats the older claim in the FAQ.
The live install page still shows this wording.

Lead with **Add to Chrome / Edge / Firefox**, using the existing official store
destinations. Keep local installation under an advanced disclosure. Remove the
obsolete waiting language from current docs and FAQs; retain dated evidence as
history. The first useful state should be the existing local writing checks, not
an account-creation requirement. Keep explicit notebook/AI permissions separate.

### High: mobile navigation consumes the workspace

In [Notes at 390px](../screenshots/ui-ux-review/notes-390.png), the first note title
starts around 390px down a 900px viewport. Three navigation bands precede the page
heading, view switch, search, count and bulk-selection row. The first real content
is below two-fifths of the screen. At 320px, New note also wraps to two lines.

`packages/website/src/components/dashboard/shell.tsx:146` and
`packages/website/src/app/app/sidebar.css:29` own this shell.
Use one compact mobile header with notebook scope, search and New note. Put the
notebook tree and commands in a sheet; keep Settings last in navigation. Show
bulk controls when selection starts. Preserve drafts, scroll, scope and back
behavior. Do not replace useful text labels with an unexplained icon rail.

### High: saving is technically careful but visually indecisive

The web editor shows **Saved** alongside **Save note**; the extension shows
**Save now** even though autosave exists. The UI leaves users to infer when a
button is necessary. See
`packages/website/src/components/dashboard/memory-editor.tsx:638` and
`packages/browser-extension/src/panel.ts:583`.

Choose one visible model: automatic saving with a stable Saved/Saving/Not saved
receipt, plus an explicit retry only when needed. Preserve explicit save as a
shortcut or secondary command if useful. Keep first-save behavior understandable.
An uncertain save must remain visibly **Not confirmed**, with a safe recovery
action; never simplify it to Saved or blindly create another note.

### Medium: three searches require users to understand the implementation

The workspace exposes **Search anything**, **Search your notes** and **Search**
inside Ask. They have different scope and jobs, but their presentation does not
explain the distinction through placement. See `shell.tsx:150`,
`library-filters.tsx:188`, and `ask-grove.tsx:721` in
`packages/website/src/components/dashboard/`.

Keep one global note finder. Make library search clearly scoped to the current
notebook. Ask should lead with a question and visible source scope, not another
equal-weight search mode. Advanced retrieval can remain available without being
a primary competing destination. Preserve meaningful search/filter state on
return and in shareable URLs where applicable.

### Medium: Ask looks like a generic chatbot, not a notebook tool

[Desktop Ask](../screenshots/ui-ux-review/ask-1440.png) places “What’s on your
mind?” and three stock suggestions far above the composer, separated by a large
empty region. Sources are in a top-right selector and again in a bottom toolbar;
Files & storage is a separate prominent link. The question is not the focal point.

`packages/website/src/components/dashboard/ask-grove.tsx:700` owns the composition.
Start the empty screen with the composer and its notebook/source scope together.
Offer a few existing notes as optional starting material, not invented personal
recommendations. After sending, let the conversation grow naturally and keep its
composer stable. Put storage management in Settings or the attachment picker.
Answers should expose the supporting passage, not just a citation number.

### Medium: routine helper copy makes settings feel heavier than they are

The web Writing page explains Spelling, Basic grammar and its master checkbox
with separate sentences. The extension already demonstrates a shorter treatment.
See `packages/website/src/components/dashboard/writing-preferences.tsx:150`.
The editor adds permanent “Live Markdown · select text to format” instructions at
`packages/website/src/components/dashboard/markdown-editor.tsx:919`.

Remove explanations that merely restate labels. Move optional formatting help and
rule examples to focusable contextual help. Keep local-vs-remote processing and
save-model information brief but visible where the choice is made. Do not put
critical meaning in a hover-only tooltip.

### Medium: the editor spends persistent space on occasional tools

The note route has its own action bar, then Write/Markdown/Preview and a formatting
strip, then a bottom instructional/status strip. Empty source/linked-note
disclosures further fragment the writing surface. Current screenshots are cleaner
than historical galleries, but still emphasize operation over reading.

`packages/website/src/components/dashboard/markdown-editor.tsx:650` and
`packages/website/src/components/dashboard/memory-editor.tsx:766` own these controls. Keep one obvious
Write/Read switch; make raw Markdown secondary. Offer formatting on selection and
through a keyboard-accessible menu, with a persistent fallback. Show populated
Sources/Related sections with honest counts, rather than large empty sections.
Keep the note title, body and useful margin space dominant.

### Medium: web and extension share a palette, not quite an interaction system

Both now use system UI text, which is a sound shared foundation. However, web
buttons use green and 5px radii (`app/app/dashboard.css:128`), while the extension
uses dark ink and 10px radii (`browser-extension/src/panel.css:75`). The extension
uses **Personal** where the web uses **Unfiled** for notes outside notebooks.

Paths above are under `packages/website/src/` and `packages/`, respectively.
Unify action hierarchy, control radii, source labels and save receipts. Keep the
extension’s compact scope; do not import a full web sidebar into it. Treat the
public typeface as a deliberate marketing choice, not a reason to add another
display font inside working screens.

### Medium: writing alternatives hide their most important action

In the extension review, the alternative sentence is the replace button, while
**Copy** is explicitly labelled beside every alternative. A new user may reasonably
assume the sentence is just text. `packages/browser-extension/src/writing/tools-controller.ts:35`
styles the alternatives; the rendering is near line 561.

Show what changed in the selected wording and offer an explicit **Use** or
**Replace** action on the selected alternative. Keep Copy secondary. Preserve
native Undo, source selection, keyboard access and newer-edit guards. This is a
stronger source of character than sparkles or another floating pill.

### Medium: library rows are efficient, but visually undifferentiated

Each note repeats title, excerpt, type, notebook, date and tags in a similar narrow
size range. The permanent selection row adds administrative weight even when the
user just wants to read. `packages/website/src/components/dashboard/memory-row.tsx:155`
owns the row hierarchy.

Make titles and meaningful excerpts lead. Reduce repeated notebook labels in a
scoped view; reserve status emphasis for actual problems. Keep optional metadata
in row details and bulk actions in selection mode. Retain list rows and useful
dividers rather than turning every note into a large card.

## Copy: remove, disclose, or show

| Current                                                        | Recommended treatment                                                                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| “Spelling — Flag misspellings and suggest corrections.”        | **Spelling**. Remove the repeated description.                                                                                      |
| “Basic grammar — Flag common grammar issues.”                  | **Grammar**. Put concrete examples in contextual help.                                                                              |
| “Turn all writing checks in the web app on or off.”            | **Writing checks**, using the control’s state. Remove the sentence.                                                                 |
| “Live Markdown · select text to format”                        | Remove the permanent instruction. Show formatting on selection; help on focus/tap.                                                  |
| “What should stay with you?” as the editor’s accessible name   | Use a literal **Note content** label. Personality should not obscure voice or screen-reader targeting.                              |
| “Did that save?”                                               | **Unconfirmed saves**. Show each note and its actual recovery state.                                                                |
| “Your earlier note is saved. These changes save on their own.” | Show a stable receipt for the saved version and **Saving…** for current changes when work is actually pending.                      |
| “What’s on your mind?” plus three generic suggestions          | Let the question field and chosen sources lead. Optional examples should use existing notes.                                        |
| Repeated rewrite-allowance paragraph in the tool menu          | Show concise, accurate usage context where needed; details in Settings/contextual help. Keep first-use processing consent explicit. |

Tooltips must work on keyboard focus; touch needs a tap-triggered popover or
disclosure. Do not rely on `title` alone. Essential labels remain visible.
Statuses announce meaningful transitions accessibly without repeating toasts or
moving controls. Do not remove persisted pending/failed/uncertain distinctions.

**Keep visible:** selected notebook/access scope, public-link audience, external
processing, irreversible consequences, errors and uncertain saves. Shorten these
without hiding them. Demonstrate with the actual selected note or passage whenever
possible instead of writing a paragraph about what the system will do.

## A distinctive direction: the source stays with the thought

Use Grove’s actual sequence—**browser capture → saved note → cited answer**—as its
signature, not a decorative botanical theme.

- Keep the sprout mark and deep green. Use neutral paper, dark readable body text
  and a restrained green selection/action accent. No glows, textures or gradients.
- Make source trails consistent: source title, optional domain, exact passage and
  a direct return to the note. Reveal the detail when selected, not on every row.
- Treat writing alternatives like marginal edits: show the changed words, one
  explicit action and reversible feedback.
- Use the same note/source/receipt language in the extension, editor and Ask.
  Let real titles, selected passages and linked notes give the interface character.
- Motion should explain a relationship or acknowledge an action. No scroll-fade
  choreography, idle pulses or layout animation during refresh.

This keeps Grove professional while making its distinguishing behavior visible.
It is a proposed direction, not an approved redesign or a new functional promise.

## Applying the reference image intelligently

The main observed matches are generic chat suggestions, repeated instructional
copy and soft nested surfaces in the extension. The app is **not** currently a
field of icon feature cards, fake KPI statistics, glowing heroes or dithered art.
Instrument Serif remains a package dependency, but the inspected workspace renders
system UI text; removing a dependency would not fix the visible problem.

Keep useful list dividers, real source markers, actual counts and shadows on real
overlays. Numbered procedures and citation numbers are meaningful, not decorative
section numbering. An occasional external-link arrow is not the same as arrows on
every action. A short sentence is fine when it says something useful.

## Accessibility and qualification follow-ups

- Axe reported `label-content-name-mismatch` on desktop search/command launchers,
  the notebook-count link, and Ask’s tool button. The visible shortcut/count text
  is not fully represented by the explicit accessible names. Inspect those names
  and use proper shortcut semantics; do not claim a clean accessibility audit.
  Ask’s tool button also reported the issue at 390px.
- Native checkbox boxes measure 16–18px, but their labels expand the hit area.
  Those box measurements alone are **not** evidence of undersized touch targets.
  Likewise, the 1px file input/continuation targets are not ordinary visible buttons.
- The unmodified Chrome host suite initially failed its 320×240 scrolled AI-card
  geometry assertion (bottom 396px against a 240px viewport). A diagnostic run
  subsequently measured a correctly bounded card after rendering, and a fresh
  unmodified Chrome run passed. Treat the earlier failure as intermittent
  timing/short-viewport qualification, not a confirmed permanent clip or a fixed
  bug. Do not relax the assertion to make the review green.
- The public-page taste inspector reported nine rule categories as failures. Its
  demands for more pictures and entrance motion are **not** suitable redesign
  requirements here. Source lint also flagged functional audio-progress gradients
  and example-domain validation as “slop”; those are not decorative findings.
  Automated heuristics support, but do not replace, visual judgment.

## Recommended implementation order

1. Correct store availability and standardize labels/save receipts.
2. Reduce mobile navigation and redundant helper copy; verify recovery and focus.
3. Recompose empty Ask around question + sources; streamline editor controls.
4. Apply shared component tokens and the source-trail interaction across surfaces.

Before accepting a redesign, verify populated/empty/error/offline states, long
titles, slow saves, drafts, keyboard and touch alternatives, reduced motion,
real store-install/permission handoff and 320/390/768/1440px layouts. Keep the
background-state and authorization contracts unchanged.
