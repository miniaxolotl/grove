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
- AI settings explain local versus remote effects and unavailable providers.
  These are not all redundant descriptions. Shorten by grouping related choices,
  not by hiding what leaves the device or what an unavailable option means.
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
- The broader pass’s unmodified Chrome- and Edge-package host cases passed in
  Chromium with synthetic HTTP/models. This is not branded Edge, Firefox, live
  provider or published-store parity acceptance.
- The public-page taste inspector reported nine rule categories as failures. Its
  demands for more pictures and entrance motion are **not** suitable redesign
  requirements here. Source lint also flagged functional audio-progress gradients
  and example-domain validation as “slop”; those are not decorative findings.
  Automated heuristics support, but do not replace, visual judgment.

## Recommended implementation order

1. Correct direct store links, deletion consequences and access-management order.
2. Establish working chat/note URLs, return state and unsaved-draft protection.
3. Group scope/count/empty states and settings; remove redundant divider bands.
4. Recompose mobile/Ask/editor and shared source trails without hiding recovery.

Before accepting a redesign, verify populated/empty/error/offline states, long
titles, slow saves, drafts, keyboard and touch alternatives, reduced motion,
real store-install/permission handoff and 320/390/768/1440px layouts. Keep the
background-state and authorization contracts unchanged.
