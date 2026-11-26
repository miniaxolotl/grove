# Grove UI and UX review

26 November 2026. Review of the web workspace and browser extension, with a
secondary check of public entry pages. **Recommendations, not implemented changes.**

## Verdict

Grove is already past the most obvious AI-template styling. The remaining problem
is **a generic tool shell with too much interface around the work**: navigation,
search modes, formatting controls, explanatory sentences and repeated metadata.
Removing more decoration alone would make it plainer, not more distinctive.

The three design priorities are:

- Give mobile screens back to the note or question, rather than navigation.
- Replace routine explanations with clear controls, examples and compact status.
- Make a note’s source and its use in an answer Grove’s recognizable interaction.

Owner-required checks for the next implementation: remove **excessive horizontal
or vertical dividers**, improve settings/toggle hierarchy and layout, link
directly to all released extension stores, and update URLs as navigation changes
so Back/Forward and reload preserve the exact location and return context.

The overall standard is a professional, task-focused product: show what people
can do, what happened and what needs attention—not how Grove is assembled.
Apply that standard across the web app and extension, not only to settings copy.

## Evidence and limits

- Source: development `622ca2b0b5b98801c21166be9d00965f72bfe42d`, product
  1.11.37. Workspace captures use actual components, production-build CSS and
  synthetic account/API fixtures. No production-auth bypass or account edits.
- Notes reviewed at 1440, 768, 390 and 320px; editor, Ask and Writing settings at
  1440 and 390px. All ten captured states had no horizontal page overflow or
  JavaScript page errors. This is not full journey, keyboard or device acceptance.
- The broader pass adds 23 web captures at 1440/390px: notebooks, graph,
  Connections, API-key scope, AI settings, files/storage and refresh failure, data,
  pending browser/agent approval and sharing. No horizontal page overflow or page
  errors in those states. Desktop axe repeats the shell name-mismatch findings.
  Focused interactions below are not end-to-end import, export, deletion or
  permission-grant acceptance.
- Six focused phone states also had no overflow or page errors: deletion
  cancellation, export options, uncommitted sharing, import entry, file refresh
  failure and stale notes. No API mutations were attempted. Note-row reload and
  failed-refresh observations are recorded in the gallery.
- The cross-screen pass adds ten captures at 1200/768/390px and short 390×600 /
  320×480 layouts. No page overflow or JavaScript page errors in these runs.
  It uses the fixture’s history/Link shim, not the real Next router. Source and
  full-reload observations support the findings; real Next history-cache,
  physical-keyboard/zoom and production acceptance remain separate.
- The refined pass checks 52 finder/history/billing/archive states at fine
  1440×900 / 768×700 and coarse 390×700 / 320×480, plus focused handoff, layout
  diagnostics and long source reading. No page errors, horizontal overflow or
  effect attempts in the completed runs. Two 390px dialogs have no sampled axe
  violations; that is not whole-app or assistive-technology acceptance. Missing
  vertical scroll remains a finding despite the horizontal-overflow checks.
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

The direct destinations already exist in the shared component:

- [Chrome Web Store](https://chromewebstore.google.com/detail/ghcndbpbnocjiefnbikdoakajemflcaa)
- [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/grove-private-notes/)
- [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/epmjpecpdnjbgbjnjkfjafonocecffmo)

Chrome and Edge pages resolve with Grove’s listing title. The Firefox HTML page
returned a client challenge; its [official public metadata](https://addons.mozilla.org/api/v5/addons/addon/grove-private-notes/)
identifies Grove as public and not disabled. This is destination evidence, not an
installation test. `packages/website/tests/extension-store-links.spec.ts:48`
currently expects the obsolete Chrome guide/unavailable behavior: update those
expectations alongside the component, not just its display label. Check actual
`href` destinations in Install and Connections, with/without JavaScript and across
browser detection; no setup-guide detour for the store action.

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

The broader pass qualifies this recommendation: do **not** collapse global
navigation search, scoped filtering and question answering into one ambiguous
control. Their different jobs are valid; clarify their scope and hierarchy.

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

Use the compact unavailable-control treatment in the copy guidance below rather
than adding installation/build explanations to each row.

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

## Broader workflow pass

### Medium: scope, counts and empty states look like unrelated fragments

The owner’s supplied crop highlights a display problem, not just excessive copy:
**Notes → search → “0 notes” → “Unfiled” → a large bordered empty-state panel**.
The small count and scope are detached from the heading and from each other;
the panel gives a generic result message more visual weight than the location.
Its padding, heading/body gap and separate recovery button make a tiny amount of
information feel like another full section. The fixture reproduces this at
[768px](../screenshots/ui-ux-review/empty-unfiled-768.png) and
[390px](../screenshots/ui-ux-review/empty-unfiled-390.png); these are not a claim
about the crop’s original viewport or zoom.

- Put the current location and its count in one compact header/breadcrumb, with
  scope leading and count secondary. Do not leave “Unfiled” as an unexplained
  second metadata line. When empty, omit the redundant zero count: **Unfiled** as
  the location, **No notes here yet** and **New note** are enough. Make the
  search’s scope apparent beside the field.
- Keep search/filter controls together and before the result surface. Show active
  constraints as labelled, removable choices when needed—not only a number on an
  icon. Align their edges with the results.
- Make the empty treatment proportionate: one short state sentence, one relevant
  next action, deliberate spacing. A modest result boundary is fine; an extra
  card or divider is not required simply because there is no row to show.
- Distinguish **“No notes in Unfiled yet”** from **“No notes match this search.”**
  The former should offer creation/import in that location; the latter should
  offer Clear search or removal of the actual narrowing filter.

There is also a behavioral mismatch. `memory-library.tsx:224` treats a selected
notebook/Unfiled scope as a filter, even without a search. Lines 674–699 then show
“No matching notes” and reset _all_ filters, including that scope. In the fixture,
Clear filters shows an all-notes result while the URL still says
`?notebook=personal`; reload returns to empty Unfiled. Keep navigation scope
separate from search refinements. Label an intentional scope change **View all
notes**, not Clear filters. The truly empty all-notes view already offers
**Write your first note**—retain that useful distinction rather than using one
generic empty card everywhere. The source paths here are under
`packages/website/src/components/dashboard/`; `.library-scope` explicitly uses
`display: block` in `packages/website/src/app/app/dashboard.css:705`.

### Medium: settings need parent/child hierarchy, not more separators

Writing assistance, Spelling and Basic grammar currently share the same left
edge, weight and checkbox treatment, although one is the master control
(`packages/website/src/components/dashboard/writing-preferences.tsx:159`). Expanded
automatic/highlight/rule options continue down the left column while the shorter
Enhanced grammar block leaves the right side mostly empty on desktop. See
[expanded Writing](../screenshots/ui-ux-review/writing-expanded-1440.png).

Make **Writing checks** the group-level control; nest its spelling, grammar,
timing and display choices visibly. Place remote **Enhanced grammar** in a
separate, clearly labelled group with its automatic-send option nested under it.
Use consistent label/control columns, row height, spacing and readable supporting
text. A dependent option must retain its saved choice when disabled and explain
why it is inactive. Avoid nested “More options → advanced rules” layers when one
meaningful Rules disclosure suffices. In AI settings, keep Organization,
Summaries, Connected agents and Speech as intelligible groups, and distinguish
feature availability from the user’s saved preference. Do not replace every
checkbox with a switch or silently change the existing save policy.

Search both orientations of dividers in the shell, editor toolbars, lists,
connection forms and extension panels. Flag a line when it repeats a boundary
already conveyed by spacing, a heading, a surface or another outline—not merely
because CSS contains `border`. The repeated editor bands and permanent selection
header are the first simplification targets (`app/app/editor.css:287`,
`app/app/dashboard.css:736`, under `packages/website/src/`). Prefer one clear
boundary per group. Retain useful row separation, control outlines, focus rings,
table relationships and destructive-action grouping. The current flat settings
rows already remove their borders (`settings-layout.css:31`); adding a divider
between every toggle would make their hierarchy worse, not better.

The short-screen check also distinguishes **saved configuration** from
**effective state**: after Writing assistance is switched off, Spelling and Basic
grammar remain checked and editable. The local master survives reload. This is
not evidence that the engine still runs: `note-writing.tsx:56` gates it on the
master. Preserve saved child choices, but visibly mark their group **Paused while
writing checks are off**, or otherwise show that they are not currently active.
The hierarchy must communicate that distinction without another paragraph per
toggle. Do not silently clear the children to make the screen look consistent.

### Medium: simplify toolbar and filter layout with consistent icon roles

The owner’s Linear references demonstrate a useful _structure_: compact toolbar
triggers, labelled icon rows inside menus, aligned label/value columns, and
separators between meaningful groups rather than every option. They are not a
request to copy dark styling, round every control or reproduce Linear’s feature
inventory.

Grove already has a good starting point: List/Graph use icons plus text, and
Archive / Today’s note / Import notes already have aligned icons and labels.
The fine-pointer fixture’s More-menu rows share a 36px pitch and icon column. Do not report
those as missing icons or randomly spaced rows. The inconsistent part is their
composition: view choices and the text-only **More** trigger compete as peer
buttons while search, Filters and result metadata occupy another band.

- Keep the two common views together. Consider the existing ellipsis icon for
  More note actions instead of another text button; preserve its accessible name,
  keyboard hint/focus behavior and a tap-discoverable label. Use icon **and text**
  inside menus and for unfamiliar or consequential actions.
- Give Filters and any genuine display-options control distinct meanings/icons;
  do not add a second sliders button for the same job. Add no empty “View settings”
  menu merely to imitate the reference.
- Standardize icon size/stroke, icon/text gap, row baselines, trailing checkmark /
  chevron column, trigger height and menu padding. Keep the panel anchored to its
  trigger and within usable viewport gutters. Separate navigation, view controls
  and destructive actions by grouping, not a divider after every row.
- In the phone Filters panel, two columns begin at only 360px
  (`packages/website/src/app/app/workspace.css:1577`). Topic tag is squeezed beside
  a full-width Apply tag button and its placeholder is clipped. Let search/text
  fields span the usable width; pair only short compatible choices. Keep labels,
  input edges and footer actions aligned; reduce redundant framing instead of
  shrinking text to fit.

The More icon already exists in `ui/action-menu.tsx:19`; the library deliberately
replaces it with `visibleLabel="More"` at `memory-library.tsx:481`. These paths
are under `packages/website/src/components/dashboard/`. Icon-only is an option
for familiar compact triggers, **not** a mandate to remove labels from Save,
Revoke, permission choices or the main Open action.

### Medium: searchable choices need an explicit local-versus-server policy

The supplied Source-select example has eight options and no visible search.
`ui/select.tsx:95` renders a plain Radix option viewport, not a search field.
Keyboard typeahead can move focus (CLI in the phone check), but does not narrow
the eight choices and is not discoverable touch search. Add visible filtering
where option scanning is the problem. Notebook selection already has a search
field: `notebook-picker.tsx:47` filters labels locally, and the test phrase
“Website” correctly narrows it. Preserve and reuse that behavior rather than
declaring every dropdown unsearchable.

| Input/data                                          | Appropriate search                                                                                                    | Boundary to preserve                                                                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sources and other fixed, fully loaded option lists  | Client-side label filtering; Source is a useful candidate.                                                            | No API request for each keystroke over eight static values. Short sort/duration lists can remain simple selects.                                                                 |
| Notebook picker                                     | Client-side over the complete authorized catalog, as today.                                                           | `workspace-cache.ts:320` assembles all catalog pages before exposing them. If scale later requires server search, preserve hierarchy, selected values and full-dataset coverage. |
| Notes/global finder, files and conversation history | Backend search with authorization, scope, sort and pagination.                                                        | Never search only the currently rendered/loaded page and call it the whole result set. Preserve freshness, cancellation and stale-response fencing.                              |
| Topic suggestions                                   | Local suggestions are fine as suggestions; comprehensive tag discovery needs complete catalog data or backend search. | Current suggestions come from loaded note rows (`memory-library.tsx:523`), so they are not an exhaustive tag index.                                                              |

The table’s component paths are under `packages/website/src/components/dashboard/`;
the cache is under `packages/website/src/lib/`. Reuse the existing debounced
backend note-search behavior (`use-note-search.ts`), not an unrelated search
system. Keep small interactive reads synchronous where appropriate; this review
does not propose background jobs for option filtering.

Every searchable select needs a visible search label, a scrollable bounded result
list, retained selection, keyboard/IME support and an honest no-match state.
Server-backed ones also need loading/failure/partial-result states; local ones
should respond immediately. A failed or incomplete fetch is never “no matches.”

### Medium: finder refinements retain results but move their targets

The global finder correctly keeps earlier matches while a refined phrase loads,
marks the region busy and dims the earlier result. However, the first retained
result moves **26px down** when Cancel search appears. This reproduces at fine
1440×900 and 768×700, and coarse 390×700 and 320×480. The outer palette stays
480px tall, clamping to 452px at 320×480; a stable dialog does not establish stable
controls inside it.

`packages/website/src/app/app/palette.css:328` gives the caption a 34px minimum
and 8px vertical padding. Its new Cancel search button inherits a 44px minimum
from `dashboard.css:1073`, making the pending caption 60px tall. Reserve the
caption/action lane across settled and pending states; **do not shrink Cancel’s
hit target**. Preserve retained results, the busy status, cancellability and
immediate typing. Old matches should remain recognizably previous results, not
appear to answer the new phrase before it finishes.

A DOM-only diagnostic reservation removes that 26px movement at 1440/390/320px
while leaving Cancel at 44px. It was discarded with the fixture; no fix or
regression acceptance is claimed.

`packages/website/src/components/dashboard/workspace-search.tsx:109` also creates
fresh query/scope state each time the finder opens. Escape correctly returns
focus, but reopening clears the phrase and restores All notes in all four
contexts. Preserve the current lookup when returning from a result, with an
explicit clear/reset action; do not silently restore a narrow scope without
showing it. This is a recovery recommendation, not evidence that the backend
lost notes or that every new search should inherit an old restriction.

Keep the working one-click **Search all notes** recovery, distinct no-match/error
states, retained input on retry and focus return to the field. “Search anything”
currently opens a note finder; its title/copy should make that scope clear rather
than imply that it also searches commands, settings or conversation history.
Ask remains a separate explicit handoff, not an automatic answer request.

This refines, rather than reverses, the earlier search recommendation:
[NN/g’s scoped-search guidance](https://www.nngroup.com/articles/scoped-search/)
supports visible scope, easy broadening and refinement after results. It does not
justify merging note finding and question answering or expanding authorization.

### Medium: size components by role and input mode, not one global scale

Width alone is not a touch-device test. A dedicated sizing check compares fine
pointer at 1440/768/390px with actual coarse-pointer emulation at 390/320px, all
600px high. The earlier narrow captures use fine-pointer contexts. These are
CSS/fixture measurements, not physical-device acceptance.

| Measured component     | Fine pointer                 | Coarse pointer / narrow layout    | Implication                                                                                                                               |
| ---------------------- | ---------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| More-menu row          | 36px high                    | 44px high                         | Existing touch expansion works; do not flag the earlier 36px capture as the mobile target size.                                           |
| List / More trigger    | 36px high                    | 44px high                         | Keep shared control heights within a toolbar; do not reduce touch targets to make the header fit.                                         |
| Note-row selection     | 16×16px glyph; 16×21px label | Same glyph inside a 44×44px label | Measure the actual hit area. A small checkbox drawing is not automatically a small touch target.                                          |
| Note row               | 94.5px at 1440px             | 151.5px at 320px                  | Repeated metadata, selection/drag affordances and wrapping determine density, not just padding.                                           |
| Writing preference row | 59.2px at 1440px             | 78.4px at 320px                   | Let labels/descriptions wrap; retain the labelled hit area rather than squeezing text.                                                    |
| Empty scoped panel     | 1121×164px at 1440px         | 296×172px at 320px                | The same full-result card spans a very different amount of useful space; simplify its content/hierarchy before imposing a new fixed size. |

Menu icons remain 16px and view icons 15px; at 320px the view icons intentionally
hide while text remains. Do not enlarge every icon to 44px or replace a readable
label with an oversized glyph. Size the surrounding action target independently.

Set a small role-based scale for compact desktop controls, touch controls, list
rows, section headings and overlays. Keep short toolbar controls compact; make
long text fields use the available width; constrain menu/dialog width to content
and usable viewport gutters. Short screens need bounded scrolling with reachable
actions, not a panel that grows past the viewport. Preserve the successful
320×480 nested-picker behavior.

At 320×600 with coarse input, only one complete note fits below the shell and
selection header. Recover space by simplifying those bands and repeated metadata,
not by shrinking 44px targets, body text or the note excerpt. The same review
should cover long translated labels, larger text/zoom and mixed-input devices;
those are follow-up acceptance cases, not measurements claimed here. No new
blanket target-size/WCAG failure is inferred from this sample.

### High: access management comes after installation

`packages/website/src/components/dashboard/connections.tsx:149` places extension,
agent and API-key setup before **Your connections**. In
[mobile Connections](../screenshots/ui-ux-review/connections-390.png), those
installation choices occupy almost the entire first screen, even with an approved
connection present. Finding or revoking existing access requires scrolling past
setup. This is a hierarchy issue, not a need for more onboarding copy.

Lead with existing connections, their scope and **Edit scope / Revoke**. Put
**Add connection** beside the heading and reveal the installation choices there.
An empty account can lead with those choices. Keep Hide visibly distinct from
Revoke: hiding a row does not stop access.

### High: note deletion omits the recovery consequence

`packages/website/src/components/dashboard/note-delete-dialog.tsx:213` says the
note and history will be “hidden from your Grove.” The comparable notebook
warning explicitly says they cannot be restored
(`notebook-lifecycle-summary.tsx:7`). “Hidden” alone can sound like a reversible
view setting, especially beside Archive and connection Hide.

Use a short, visible consequence: **“This note and its history will be hidden.
You can’t restore them in Grove.”** Preserve the real retention contract; do not
claim physical erasure. Keep draft-loss, uncertain-save and conflict warnings
conditional and visible. The review opens and cancels the dialog; it does not
delete a note or prove deletion recovery.

### High: long saved sources have no usable scroll path

`packages/website/src/components/dashboard/source-revision.tsx:36` renders the
saved source in a `.note-document` article without its own scrolling body.
`packages/website/src/app/app/workspace.css:94` removes outer padding and hides
overflow for that layout, which normally relies on the editor’s inner scroller.
The real revision route uses this component at
`app/app/(notes)/memories/[id]/page.tsx:12` under `packages/website/src/`.

In a 50-paragraph synthetic saved revision, the final heading stays below the
viewport after wheel scrolling and Control+End: about y=2,344 at 1440×900,
y=3,983 at 390×700 and y=4,018 at 320×480. The containing main region has
`overflow-y: hidden` and zero scroll offset; the source body has no scrollable
ancestor within that clipped region. This is unreadable evidence, not merely
an oversized empty state. No horizontal overflow or page error is required for
this failure to occur.

Give saved-source reading an explicit, bounded scroll surface and restore reading
gutters; do not apply the editor’s full-bleed contract to plain source content
without its scrolling contract. On 320×480 the article has only 121px of height
above the global footer; demote that footer in this reading context rather than
leaving a tiny scroll strip. Both unavailable and populated sources currently
start flush with the content edge. Preserve the distinction between the cited
revision and the current note, the authorized **Open current note** path and the
honest no-longer-available state.

A DOM-only constrained-body diagnostic makes the end reachable by programmatic
scrolling in all three contexts. It does not prove a complete repair, native
touch/keyboard scrolling or readable short-screen layout. No source code was
changed; actual reader, focus, media and real-browser acceptance remain required.

### Medium: saved revision fallback and failure need truthful recovery

`packages/website/src/components/dashboard/revision-compare.tsx:18` intentionally
falls back to full versions when either text exceeds 6,000 characters. In the
saved-history fixture, a long earlier version compared with saved version 2 says
**“This draft cannot be compared as a saved note yet.”** That describes the wrong
state. Use neutral comparison-unavailable copy and keep the Full versions route;
do not imply that saving again will enable a comparison or remove the bounded
comparison safeguard. Ordinary emoji-containing versions compare successfully;
this is not a general Unicode failure.

`packages/website/src/components/dashboard/memory-detail.tsx:476` renders a history
read failure as an alert without an in-place Retry or next step. All four contexts
reproduce the missing recovery control. Add a scoped retry that preserves the
chosen comparison and reading position; never retry a restore as a side effect
of retrying the read. Preserve the working inline Added/Removed distinction,
full-version disclosure and explicit **Restore as a new revision** action. No
restoration or history mutation was submitted.

### Medium: permission editing should sit beside the permission summary

Agent approval shows selected **Delete memories** and **All current and future
notebooks**, but capability editing is below **Customize access**
(`packages/website/src/components/dashboard/connect-agent.tsx:264`). API-key
creation selects all capabilities initially
(`connections.tsx:573`). The pending browser form is different: read/write are
selected, delete and AI writing are not. Do not generalize one form’s defaults to
all connections.

Group **Can do** and **Can access** into a compact, directly editable summary
before approval. Keep destructive capabilities, future-notebook access and
remote-AI consent explicit; hide identifiers and protocol detail instead. This
recommendation changes presentation, not authorization defaults or grant policy.
Do not add another setup step.

### Medium: extension Search hides the main read action

`packages/browser-extension/src/panel.ts:922` builds the result preview as a
noninteractive `div` and places **Open**, Copy and Share in the overflow menu.
The [Search capture](../screenshots/ui-ux-review/extension-search-390.png) therefore
shows the found note without an obvious way to read it. The full reader itself
is a useful, focused surface.

Make the result title or a visible **Open** the primary keyboard/touch target.
Keep Copy/Share and uncommon management actions in overflow. Progressive
disclosure should remove secondary choices, not conceal the result’s main job.

### Medium: compact refresh feedback hides whether results are current

`packages/website/src/components/dashboard/memory-library.tsx:568` retains loaded
notes on refresh failure, which is good. But “Couldn’t refresh. Showing saved
notes.” is screen-reader-only; the visible control is merely **Retry**, with the
detail in `title`. Touch users should not have to infer what failed.

In Files, the error is below the expanded storage summary and filters
(`files-panel.tsx:544`), while `files.error` replaces the loaded list. Keep a
compact failed-refresh receipt beside Refresh, plus detailed recovery in the
result surface. Retain authorized loaded rows and expanded locations where safe;
do not keep them after access is revoked. Preserve focus, query and scroll. An
offscreen alert or a successful-looking old count is not sufficient visible
freshness feedback.

### Medium: billing feedback belongs beside the refresh and allowance

The synthetic Billing screen preserves feature allowances, pending counts,
separate AI/audio budgets and payment recovery. Keep those truthful distinctions,
but reduce their competing presentation: lead with current plan/payment attention
and the allowance that needs action, with a concise expandable breakdown. The
1,500 Ask allowance and 155,000 AI-request budget are different source contracts,
not inconsistent totals to force into one number. Explain that distinction on
demand rather than asking every reader to understand internal safety budgets.

`packages/website/src/components/dashboard/billing-panel.tsx:139` puts all read
errors at the sheet’s top, while Refresh usage is much lower at line 237. On short
screens, clicking Refresh usage scrolls that button into view, but the resulting
failure is outside the visible settings region above it. Retained usage still
looks ordinary beside the button. Keep a concise visible failed/stale receipt
and retry beside the refresh, in reserved space; retain the prior values rather
than blanking them. A live-region alert is useful, but is not proof that a sighted
user can see a message above their current scroll position. This is consistent
with [W3C’s status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html),
not a claim of screen-reader or WCAG acceptance.

At 390×700, the failed-read alert spans y=−178…−142 while Refresh usage spans
y=435.5…479.5 inside the visible settings scroller; at 320×480 the alert is also
above that region. The original meter stays mounted. Desktop 1440×900 keeps the
alert visible, so this is not an everywhere-hidden error. The gallery shows both
the unchanged-looking refresh viewport and the actual alert after scrolling up.

Make pending reservations distinct from completed use: in the sample, 1,499 used
plus 1 pending fills a 1,500 allowance and shows Monthly limit reached. Explain
that no actions remain available while that reservation is pending, without
claiming all 1,500 have completed or suggesting that a retry/reset can erase usage.
Keep reset dates, actual zero values and the statement that editing, keyword
search and export remain available.

Do not report the fixture’s empty disabled Billing component as a reproduced
normal production route: `app/app/settings/billing/page.tsx:6` gates the real page
with `showBilling()`/`notFound()`, and the fixture bypasses that server gate.
Disabled-feature, permission and provider-failure states need separate acceptance.
No checkout, portal, trial, payment or provider request was executed.

### High: navigation must update the URL and preserve the return location

Opening a library row leaves the URL at `/app` and opens a dialog; reloading
returns to the list. `memory-library.tsx:138` holds selection in local state.
A canonical note route exists, but **Open note page** is secondary in
`memory-detail.tsx:276`.

Keep quick-open, but reflect the selected note in the route; a secondary canonical
link alone does not meet the owner’s return-location requirement. Back should
close the detail and restore its originating list; Forward/reload/copied URL
should identify the same note. This is not an argument to replace every short
action with a full page.

Extend the check beyond notes: library filters/view/sort, notebook subviews
(`context.tsx:71`), file filters/page (`files-panel.tsx:264`), selected conversation
and meaningful Settings disclosures need restorable navigation state. Settings
sections already use real routes; daily notes already encode their date and
exports accept a task ID. Preserve these working cases. Local sidebar expansion
and scroll persistence (`workspace-navigation-state.tsx`) are useful but do not
substitute for a location URL.

Acceptance must cover **filtered list → note → files/settings → Back → same
filtered list**, including the selected row, pagination/loaded range, view, scroll
and focus. Push history for meaningful navigation; replace it for normalization
and rapid filter edits, not every keystroke. Keep drafts and private content out
of URLs; use bounded route IDs or scoped state handles where needed. Validate
return destinations as authorized local paths, handle deleted/inaccessible targets
honestly, and preserve unsaved edits. Direct deep links need a sensible parent
fallback when there is no originating history entry.

**Browser-tab titles and renamed resources are part of this contract.**
`packages/website/src/app/app/layout.tsx:17` supplies the fixed metadata title
“Your notebook | Grove”; the reviewed app routes/dashboard components have no
resource-title override. This is source evidence, not a live authenticated-tab
measurement: the isolated fixture supplies its own test-page title.

- Update the address as people enter notes, notebooks, conversations and durable
  views; the heading, selected navigation item, URL and browser-tab title must
  describe the same location. Use concise tab titles such as **Launch review ·
  Grove**, **Website redesign · Grove** and **Billing · Grove**, not one generic
  title for the whole app.
- Reflect a changed note/notebook title in the current browser tab and relevant
  breadcrumb, result and navigation labels after the rename is confirmed. If a
  local title draft is shown before confirmation, distinguish its unsaved state;
  a rejected or uncertain rename must not look saved. Preserve focus, text input
  and scroll while updating these labels.
- Where readable title slugs are used, update the canonical address after a
  confirmed rename using replacement history, not one new entry per keystroke.
  Keep a stable authorized resource ID as identity; old copied/bookmarked URLs,
  internal links and previous slugs must still resolve to the same resource or
  redirect safely. Existing ID-only URLs remain valid. Handle empty, duplicate,
  long and non-Latin titles without using the title as an authorization key.
- A readable slug exposes its words to browser history, copied links and possibly
  request logs/referrers. Do not put note bodies, drafts, credentials or hidden
  notebook ancestry into URLs, or leak an inaccessible resource’s title through
  metadata. Reset to a generic authorized title on sign-out/access loss; account
  changes must not retain another account’s labels.
- Verify note → notebook → Settings → Back/Forward/reload/new tab, note and notebook
  renames, save failure, stale slug, archived/deleted/no-access targets and multiple
  open tabs. Update the title of the current resource only; a background rename
  must not relabel an unrelated tab. Real Next metadata/history behavior remains
  an implementation acceptance check, not something the fixture proves.

The third pass confirms two concrete cross-screen failures behind that rule:

- **Files → chat does not open the referenced conversation.**
  `files-panel.tsx:131` emits `/app/ask?chat=<id>`, but
  `packages/website/src/app/app/ask/page.tsx:11` consumes only `draft`, and Ask’s
  selected conversation is session state (`ask-grove.tsx:136`). The fixture lands
  on an empty Ask screen without reading the referenced chat. A control check
  opens the same seeded conversation through History and reads it successfully;
  its selection still leaves the URL at `/app/ask`, and reload loses it. Repair
  producer and consumer together, validate access to the ID, and distinguish an
  unavailable conversation from a fresh blank chat.
- **Files → note → the app’s Back action returns to Notes, not Files.**
  `memory-inspector.tsx:209` computes a notebook/home destination from the note,
  rather than its origin. This is distinct from the browser Back button. A scoped
  file query, expanded location and scroll position need a return path too.

### High: unsaved AI preferences are protected only inside Settings

In the fixture, switching Answers and writing off without saving, visiting
Writing, then returning to AI & search retains the edit. Visiting Notes and
returning instead restores the saved On value and disables Save; the unsaved
choice disappears without a recovery decision. `preference-editor.tsx:28` keeps
the draft in the Settings provider, and `settings-frame.tsx:14` owns that provider.
There is no comparable leave/reload guard in this editor. These paths are under
`packages/website/src/components/dashboard/`.

Retain a safely account-scoped draft or ask **Keep editing / Discard changes**
before losing it; save only through the existing explicit action. Cover links,
browser history, refresh, sign-out and account changes without leaking a draft to
another account. Preserve the working within-Settings behavior and newer-edit
reconciliation during save. Do not “fix” lost work with silent autosave or another
global toast.

### Preserve the interaction details that already work

The refined finder/history/archive pass adds several positives: finder retry and
scope broadening return focus to the field; cancelling retains the phrase; Escape
returns to the launcher. A scoped **Ask Grove about this** handoff carries the
phrase and notebook into an unsent composer at 1440/390/320px. Archive selection
does not move the sampled note row at 1440/768/390/320px, and Clear selection
focuses the header checkbox. Keep these rather than treating every existing
transition as defective; no restore, delete or question submission was performed.

At 320×480, the notebook picker stays within the viewport. Escape closes the
nested picker first and restores focus to Parent notebook; a second Escape
closes the creation dialog and returns focus to New notebook. Those are useful
properties to retain when flattening panels or reducing dividers. Tab sampling
also reached the document body/browser-focus boundary; this is not evidence of a
background control being activated, nor a complete focus-trap certification.

Axe additionally flags accessible-name mismatches on the picker’s Top level
option and the tablet Filters trigger. The master-off screen had no axe findings.
Neither result proves the whole keyboard or accessibility experience is accepted.
The tablet About you Preferences subview also reloads to Overview at the same
`/app/profile` URL, reinforcing the broader subview/route finding rather than
creating another unrelated navigation prescription.

### What the wider pass does not justify removing

- Notebook creation has useful Name/Parent controls and a real agent-access
  consequence. Retain that consequence; remove only generic nesting advice.
- Graph renders actual note relationships, not invented KPIs. A small synthetic
  graph does not justify filling the canvas with fake activity or declaring the
  graph useless without a large-library review.
- Sharing names **General access** and explains who can read. Retain audience,
  inherited access and expiry information when applicable. Choosing public access
  is not publication until **Create link / Save**; never replace that distinction
  with optimism.
- AI settings explain local versus remote effects. Keep those consequential
  distinctions visible; move repeated availability reasons into accessible
  contextual help beside a muted control, using “Temporarily unavailable.”
- Import/export are purposeful Settings surfaces. The review checks entry/options,
  not upload processing, export completion, download integrity or real email.

The wider reference search supports that distinction:
[NN/g’s tooltip guidance](https://www.nngroup.com/articles/tooltip-guidelines/)
reserves tooltips for nonessential explanation;
[progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
defers advanced or infrequent choices; and
[recognition rather than recall](https://www.nngroup.com/articles/recognition-and-recall/)
supports visible primary actions. The
[Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md)
also support semantic controls, visible focus and announced async states. These
are design references, not evidence that Grove passed every guideline.

## Copy: remove, disclose, or show

### Professional, user-focused presentation

- Lead with the task or outcome. Use direct labels and calm, specific language;
  remove rhetorical prompts, repeated instructions and implementation jargon.
- Show only what helps someone choose, act or recover. Put optional examples in
  contextual help and technical diagnostics in support details, not routine UI
  paragraphs or tooltips. Required setup belongs beside its action in Settings.
- Use one term for each concept across web and extension. State what failed and
  offer a valid next action; do not expose raw service errors or promise recovery
  times. Keep progress and completion distinct in plain language.
- Make the hierarchy visual: align labels and controls, group related settings,
  use consistent role-based sizing and remove redundant panels/dividers. A shorter
  paragraph is not a substitute for a clearer layout.

Acceptance: someone should understand the current scope, available action and
result without knowing Grove’s providers, deployment configuration or internal
processing. Keep the engineering evidence in this review; do not turn it into
customer-facing explanatory copy.

### Transactional email consistency

Include email in the same presentation system, not as a separate marketing
mini-site. At the reviewed snapshot, all five Grove-owned letters share
`packages/api/src/email-template.ts`: welcome, connection approval/revocation,
export ready and deletion requested. Their Georgia branding/headings, cream
outlined sheet, decorative top stripe and category eyebrow differ from the app’s
system-interface type and quieter neutral surfaces. Full subjects also make
unnecessarily long in-message headings.

The owner-requested implementation is isolated in
[email consistency PR #349](https://github.com/miniaxolotl/grove/pull/349), with
[current samples and historical before captures](https://github.com/miniaxolotl/grove/blob/fix/email-webapp-consistency/documentation/design/screenshots/transactional-email/README.md).
It aligns system type, green ink, neutral paper, compact 24px headings, spacing,
5px action corners and one 44px primary action; removes decorative framing and
filler; and keeps a wrapping fallback address. This review branch remains
documentation-only. A proposed/verified source change is not a deployed email.

Consistency must not remove security meaning: keep unrecognized-access recovery,
the account-authorized export landing and absolute deadline, and public support
after account access ends. A deletion receipt confirms the request—not finished
cleanup. Keep HTML/plain-text meaning aligned, preview samples visibly labelled,
and images/remote fonts unnecessary. Use inline email-safe styles and presentation
tables instead of importing web-app CSS or adding email animation. Preserve
recipient/tenant checks, durable delivery and uncertain-send fingerprint fencing;
reconcile pending sends before changing templates, never blindly resend.

The offline implementation check covers all five letters at 620/390/320px,
including normal/preview, long-link, stripped-style and dark-preference cases.
Browser/axe results do not establish Gmail, Outlook, Apple Mail, forced-dark-mode,
screen-reader or inbox-delivery acceptance. Clerk authentication mail and
payment-provider templates are separately managed; this pass makes no provider
dashboard changes or live sends. Review those separately before claiming that
every account-related email matches the app.

### Concrete copy changes

| Current                                                        | Recommended treatment                                                                                                                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| “Spelling — Flag misspellings and suggest corrections.”        | **Spelling**. Remove the repeated description.                                                                                                                              |
| “Basic grammar — Flag common grammar issues.”                  | **Grammar**. Put concrete examples in contextual help.                                                                                                                      |
| “Turn all writing checks in the web app on or off.”            | **Writing checks**, using the control’s state. Remove the sentence.                                                                                                         |
| “Live Markdown · select text to format”                        | Remove the permanent instruction. Show formatting on selection; help on focus/tap.                                                                                          |
| “What should stay with you?” as the editor’s accessible name   | Use a literal **Note content** label. Personality should not obscure voice or screen-reader targeting.                                                                      |
| “Did that save?”                                               | **Unconfirmed saves**. Show each note and its actual recovery state.                                                                                                        |
| “Your earlier note is saved. These changes save on their own.” | Show a stable receipt for the saved version and **Saving…** for current changes when work is actually pending.                                                              |
| “What’s on your mind?” plus three generic suggestions          | Let the question field and chosen sources lead. Optional examples should use existing notes.                                                                                |
| Repeated rewrite-allowance paragraph in the tool menu          | Show concise, accurate usage context where needed; details in Settings/contextual help. Keep first-use processing consent explicit.                                         |
| “Unavailable on this installation / in this build”             | Dim the affected control and move **Temporarily unavailable** plus optional detail into accessible contextual help. Remove the permanent implementation-specific paragraph. |

For example, `packages/website/src/components/dashboard/writing-preferences.tsx:210`
uses the installation-specific Enhanced grammar paragraph. Keep its label legible
and saved value intact; mute only the unavailable action. Preserve the ability to
turn off or revoke access. Use “Temporarily unavailable” for temporary feature
availability—not intentional Off states, deleted resources, missing permissions
or unsupported browsers. Those need an accurate explanation and any recovery action.

Help must work on keyboard focus and tap, not just hover. A native disabled input
cannot receive focus: use an adjacent focusable help control and associate its
explanation accessibly. Do not rely on grey or `title` alone. Essential labels remain visible.
Statuses announce meaningful transitions accessibly without repeating toasts or
moving controls. Do not remove persisted pending/failed/uncertain distinctions.

**Keep visible:** selected notebook/access scope, public-link audience, external
processing, irreversible consequences, errors and uncertain saves. Shorten these
without hiding them. Demonstrate with the actual selected note or passage whenever
possible instead of writing a paragraph about what the system will do.

## Screenshot follow-up: sidebar, account and notebook actions

The owner’s crops highlight real presentation questions, but their browser zoom
and capture scale are unknown. Do not copy their pixel sizes into CSS targets.
A focused fixture check uses ten synthetic notebooks at 1440×900, 1440×600,
1024×600, coarse-pointer 390×600 and 320×480 with the same product snapshot.

| Before / observed area                                                                                         | After / recommendation                                                                                                                             | Why                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The account row combines an avatar, name, “Private Grove” and a framed Pro badge inside a second hover surface | One aligned account row and one quiet plan affordance; remove redundant reassurance when it conveys no distinct scope                              | Reduce competing outlines/surfaces without removing account identity or the plan action.                                                                       |
| Pro opens an interactive usage dialog on hover/focus, including a second AI/audio disclosure                   | Keep a concise plan summary; put the full breakdown behind a clear details action in Settings                                                      | A quick plan check should not cover most of the sidebar with technical allowance categories. Keep relevant limits, pending usage and recovery truthful.        |
| The notebook heading has separate collapse, manage-title/count, Organize and create actions                    | Establish one heading hierarchy: clear disclosure, quiet total count, create action and a secondary organization entry                             | Make each target’s job obvious; do not make the hovered title/count look like the current notebook. Preserve distinct browse, create and reorder capabilities. |
| Folder icons also act as drag/organize buttons, while row titles navigate                                      | Keep disclosure, open and organization targets visually distinct; reveal management affordances on hover/focus and make them discoverable on touch | Avoid accidental organization when someone expects to open a notebook. Do not remove the drag/keyboard alternative or the indentation slots.                   |
| Move, Rearrange and Files & storage share the same folder-input icon                                           | Use distinct meaningful icons and concise contextual labels such as Move to…, Reorder… and Files                                                   | These are different destinations, not three copies of the same action. Keep notebook scope and avoid repeated “notebook” in every visible label.               |
| The nine-action menu repeats long labels and separates Archive and Delete individually                         | Group creation, management and lifecycle actions deliberately; retain safe confirmation and clear destructive styling                              | Tighten the menu by hierarchy and copy, not by shrinking touch rows or removing useful actions.                                                                |

Source owners: `shell.tsx:171`, `notebook-explorer.tsx:156`,
`notebook-tree.tsx:319` and `notebook-actions.tsx:33` under
`packages/website/src/components/dashboard/`. **Move notebook** opens a focused
destination picker; **Rearrange notebook** opens Organize with that notebook
selected. Both dialogs cancel back to the same menu trigger in the desktop
fixture. Clarify this overlap before deciding whether to consolidate entry points;
do not delete one as a proven duplicate.

There is a concrete destructive-style mismatch: Delete uses `danger`, while
`packages/website/src/app/app/actions.css:7` targets `action-danger`. The rendered
Delete text has the same `rgb(40, 76, 56)` as ordinary actions. Align the semantic
style contract while preserving the text label, separation and confirmation;
colour alone is not the warning. No deletion was submitted.

The Pro action is approximately 44×44px around a 36×24px badge. Retain the hit area
while simplifying its visible treatment. The expanded usage panel is 300×527px
on desktop; at 320×480 it clamps to 300×464px and scrolls. Menu rows are 36px for
fine pointer and 44px for coarse input, with aligned icon columns. The complete
menu is 200×346px or 200×418px respectively. End reaches Delete and Escape returns
to the opener in all five contexts; no horizontal page overflow or page errors.
These are density/discoverability findings, not a reproduced clipping failure.
A synthetic failed usage read preserves Pro and offers Try again. Preserve that
recovery rather than turning a failed read into an empty or successful usage total.

### Hover, highlighting, sizing and action indicators

Audit these as different states, not one pale background reused everywhere:

| Before / area to check                                                    | After / required treatment                                                                                                             | Why                                                                                        |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Notebook heading/count, row and Pro hover surfaces can resemble selection | Subtle hover for the exact target; a distinct persistent current/selected state and a visible keyboard focus ring                      | Make “under the pointer,” “open” and “selected” distinguishable.                           |
| Actions appear on row hover                                               | Reveal them on focus-within too; keep a discoverable touch equivalent and a stable action slot                                         | Avoid hidden management controls, width changes and hover-only access.                     |
| One row contains disclosure, folder/drag, title and More                  | Use a caret for expansion, a clear open link and a separate management affordance; retain expanded/pressed semantics                   | The indicator must predict the action, not merely decorate the row.                        |
| Visual glyphs and target sizes differ                                     | Align icon/text baselines and control heights by context; keep 44px touch targets independently of glyph size                          | Tightening means less visual clutter, not smaller tap areas.                               |
| Pending, disabled and successful actions look similar                     | Show a scoped pending indicator and a confirmed result in reserved space; disable only conflicting actions and keep recovery available | A press is not a save, a job acceptance is not completion, and grey is not an explanation. |

Check hover-to-popover travel, delayed opening/cancellation, click-to-pin,
outside-click/Escape dismissal and focus return. Verify that hover/focus never
executes the action, opens a modal unexpectedly or changes selection. Exercise
touch, keyboard, mixed input, long labels, forced colours and zoom; do not turn
this source review into a blanket accessibility acceptance claim.

In the focused desktop fixture, notebook-heading hover changes only background;
keyboard focus adds a 2px outline without changing its box. Row actions change
opacity from 0 to 1 on hover/focus while retaining their slot; selected notes have
a persistent tinted background. Preserve these working distinctions. A temporary
diagnostic class substitution makes Delete red, confirming the semantic class
mismatch above; it was restored and no source fix or deletion was made.

### Loading and skeleton polish

The latest owner screenshots show two distinct layers: Safari’s own refresh/
loading chrome above the page, and Grove’s shell/list placeholders. Do not infer
the spinner’s cause, loading duration or layout shift from still images. Real
iOS browser chrome, pull-to-refresh, visual viewport and keyboard behavior need
device testing; the Chromium fixture cannot certify them.

Source already separates the session-opening shell (`workspace-opening.tsx:143`)
from a data-pending list (`memory-library.tsx:669`) and retained-row refresh.
Keep those jobs distinct. The list skeleton renders five rows, with excerpts only
in search; normal loaded notes may have excerpts, multiline titles and tags.
Match the shared header, search, selection and row rhythm so the handoff does not
feel like rebuilding the page. Keep placeholder rows decorative/inert and use one
concise status per loading region—not fake checkboxes or working-looking actions.

A controlled check at 1440×900 fine pointer and 390×844 coarse input confirms
several useful behaviors: Settings→Notes warm returns add no note reads or
skeletons; a held refresh retains the same mounted first row, keyboard focus and
sampled geometry without a skeleton. The refresh indicator starts hidden and is
visible after 450ms, consistent with the existing 350ms CSS delay. Preserve this
quiet retained-content path rather than replacing it with a page loader.

The separately forced session shell and data-pending list differ: the phone list
starts at y=323 versus y=335; desktop y=160 versus y=164. Sampled ordinary skeleton
rows are 112px versus about 131px loaded on phone, and 85px versus about 94.5px on
desktop. The loaded sample has excerpts and tags. Align shared shell/search/list
geometry and provide realistic row structure, not a claim that every note has a
fixed height. Six seeded notes initially expose four via progressive loading;
these measurements do not cover all rows or long-title acceptance. The session
shell was forced independently, not observed during real authentication; these
are fixture comparisons, not production CLS or authentication timing results.

An induced refresh failure keeps the row and its geometry, but the screenshot
shows only Retry beside the count: “Couldn’t refresh. Showing saved notes.” is
screen-reader-only. Keep the working recovery and add a concise visible freshness
explanation within reserved status space. Do not mistake `innerText` containing
that clipped message for proof that sighted users see it. Both contexts had no
page errors or horizontal overflow; the deliberate 1,200ms transport hold is not
a production latency benchmark.

Time the complete journey separately: session ready, safe navigation ready,
first useful rows, background enrichment and any external approval. Test cached,
fast, moderately slow and stalled reads; do not benchmark production with a
synthetic transport delay. A warm return should reuse authorized content instead
of flashing a full skeleton. A refresh should retain mounted rows, focus, scroll
and edits; show unobtrusive feedback only for sustained work. Never add a minimum
spinner duration just to make animation visible or smooth over a failed request.

Keep skeletons static or very restrained, without shimmer/idle pulsing, and
respect reduced motion. Preserve readable, non-motion loading status. When data
cannot load, end the placeholder state with scoped recovery; when refresh fails,
keep authorized content but visibly indicate freshness. “Organizing…” on a note
is background processing, not a reason to block reading or restore the whole
page skeleton. Verify unchanged and long-content results, empty/error states,
pagination, retries, cancellation and account/access changes before acceptance.

## Sorting: notes and notebooks

Provide a consistent **Sort by** control for both notes and notebooks:

- **Custom order** — arrange items manually, with drag and keyboard/menu
  alternatives. Keep this order when switching to another sort and back.
- **Date created** and **Last edited** — newest or oldest first.
- **Title** — A–Z or Z–A, using language-aware comparison.

This extends existing behavior rather than adding sorting from scratch: note
filters already offer Automatic, Recently edited, Least recently edited and
Recently created (`library-filters.tsx:264` in the dashboard components).
Notebook sibling ordering already uses saved position, name and a stable fallback
(`packages/website/src/lib/notebooks.ts:4`). Reuse those foundations.

Keep the selected sort/direction clear and remember the user’s choice per view
and scope, including return navigation. Sort notebooks within their parent;
sorting must not move items between notebooks or flatten the hierarchy. Manual
reordering should explicitly use Custom order, not silently override date/title
sorting. Label notebook dates accurately; do not imply they include child-note
activity unless that is the chosen, supported measure.

Apply ordering to the complete authorized result set before pagination, with
stable ties—not only loaded rows. Preserve search and filters; offer Best match
when searching without replacing an explicit sort choice. Verify custom-order
save/reload, toggling modes, new/renamed items, equal dates/titles, nested notebooks,
multiple result pages and keyboard/touch access. These are proposed acceptance
checks, not newly implemented or browser-verified behavior.

## Internal integration: useful note and notebook links

Owner-requested addition to the proposed update; not an implemented capability
or a claim that the current link renderer has passed these checks.

- Recognize a Grove note or notebook link when pasted or inserted into a note.
  Display the linked title by default, rather than a raw URL or identifier.
  Preserve an existing custom label when parsing a formatted link.
- Offer **Edit link** to change the label later without changing its destination,
  and **Use original title** to return to the default. Never overwrite a custom
  label during refresh or when the linked resource is renamed.
- On hover or keyboard focus, show a compact preview: title, Note/Notebook type
  and a short excerpt or notebook description when available. Add location only
  when it helps distinguish the target. No configuration or processing detail.
- Keep the title a real navigable link. Provide the same preview through a
  separate tap-accessible action; viewing details must not force navigation or
  discard the current note’s draft, selection or scroll position.
- Resolve details only within the viewer’s existing access. Linking does not
  grant access or expose private previews in shared notes. For deleted or
  inaccessible targets, show a concise, accurate state without leaking details;
  do not replace it with “Temporarily unavailable.”

Acceptance: paste note and notebook links, preview and open each, edit the label,
then save/reload. Check default and custom labels after renames/moves, keyboard
and touch access, dismiss/focus return, slow or failed preview loads and revoked
access. Keep the preview stable without moving the note text. These are future
implementation checks, not new browser-test results from this review.

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

## Focused polish: tighten the interface before adding motion

Use the existing before-captures and findings above as the baseline. This is a
prioritized refinement brief, not a new visual acceptance result. Professional
does not mean smaller text or less useful content; remove friction and competing
structure first.

| Before / area to tighten                                         | After / proposed treatment                                                                     | Why                                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Mobile shell and permanent selection header crowd the first note | One compact header; contextual bulk actions; align scope, search and results                   | Give the work more of the first screen without shrinking touch targets.      |
| Notes repeat notebook/type/date/tag metadata at similar weight   | Title and excerpt lead; show only useful metadata in the current scope; align trailing actions | Improve scanning and row density without another card layer.                 |
| Writing settings give parent and child controls equal emphasis   | Clear groups, nested dependent options, one control column and proportionate section gaps      | Make relationships visible without explanatory paragraphs or extra dividers. |
| Filters, counts and empty states feel detached                   | One scope/count header, controls before results and one relevant empty-state action            | Make location and recovery immediately understandable.                       |
| Ask/editor toolbars compete with the question or note            | Keep the composer/body dominant; consolidate secondary tools and source details                | Reduce repeated controls and oversized empty regions.                        |
| Files/detail/history round trips lose context                    | Restore the precise view, draft, selection, scroll and focus; keep quick previews local        | Fix continuity before disguising navigation with a transition.               |
| Web and extension differ in control proportions and terminology  | Share role-based sizing, icon alignment, action hierarchy and concise status language          | Make both surfaces feel like one product without enlarging the extension.    |

### Motion opportunities: useful, brief and unobtrusive

Motion already exists: select chevrons transition in `controls.css:42`, note rows
have swipe/hover feedback in `dashboard.css:783`, and the command palette has a
140ms fade in `palette.css:450` (all under `packages/website/src/app/app/`). Reuse
and refine these patterns rather than adding a second animation system. Timings
below are starting points for testing, not measured improvements.

| Before / interaction                               | After / proposed motion                                                                         | Why                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Menus, filters and proposed internal-link previews | A restrained 125–200ms opacity/near-full-scale reveal anchored to the trigger; faster dismissal | Explain where the surface came from without making users wait.                            |
| Mobile navigation sheets and occasional dialogs    | A short, interruptible sheet transition, roughly 180–250ms; centered dialogs use a small fade   | Preserve spatial orientation; never delay focus or the next action.                       |
| Pointer/touch button presses                       | Subtle 100–160ms press/release feedback on the control, without moving adjacent content         | Confirm input; do not animate every icon or label independently.                          |
| Custom-order dragging                              | A clear drag preview and insertion marker, with a restrained settle on release                  | Make the destination legible; retain keyboard/menu alternatives and honest save feedback. |
| Copy, link insertion and confirmed saves           | A brief icon/opacity change in a reserved feedback slot                                         | Acknowledge the actual result without repeated toasts, row jumps or confetti.             |
| Source/citation exploration and graph selection    | Briefly emphasize the selected passage or its related edges, then return to rest                | Give Grove a distinctive, useful connection between the note and its evidence.            |

Prioritize menus/previews and action feedback; add sheet and source-emphasis
polish only after layout and navigation are reliable. Keep keyboard navigation,
typing, search results and sort/filter updates immediate; do not animate rows
reshuffling during refresh. Avoid page-entry cascades, reading-text zoom/blur,
idle pulses and continuous decorative traces. In particular, review the existing
infinite graph spark (`exploration.css:372`) as a candidate for selection-triggered
emphasis rather than adding more ambient motion; its use was not re-tested here.

Use lightweight transform/opacity transitions where appropriate, with no layout
animation or new dependency by default. Respect reduced motion, retain visible
non-motion status and disable pointer-hover effects on touch. Motion must be
interruptible, keep previews hoverable/dismissible and never imply completion
before the real save/job completes. Verify rapid open/close, Escape/focus return,
keyboard/touch, reduced motion, long content, slow/failing requests and short
screens. A blocked or failed action needs recovery, not a success animation.

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
- The broader pass’s unmodified Chrome- and Edge-package host cases passed in
  Chromium with synthetic HTTP/models. This is not branded Edge, Firefox, live
  provider or published-store parity acceptance.
- The public-page taste inspector reported nine rule categories as failures. Its
  demands for more pictures and entrance motion are **not** suitable redesign
  requirements here. Source lint also flagged functional audio-progress gradients
  and example-domain validation as “slop”; those are not decorative findings.
  Automated heuristics support, but do not replace, visual judgment.

## Recommended implementation order

1. Correct direct store links, deletion consequences, access-management order and unreadable saved-source views.
2. Establish working chat/note URLs, resource-aware tab titles, rename/link compatibility, return state and unsaved-draft protection.
3. Group scope/count/empty states and settings; remove redundant divider bands.
4. Recompose mobile/Ask/editor and shared source trails without hiding recovery.
5. Add consistent sorting and parsed internal links with compact previews and editable labels.
6. Apply the focused spacing/hierarchy pass, then test only purposeful microinteractions.

Before accepting a redesign, verify populated/empty/error/offline states, long
titles, slow saves, drafts, keyboard and touch alternatives, reduced motion,
real store-install/permission handoff and 320/390/768/1440px layouts. Keep the
background-state and authorization contracts unchanged.
