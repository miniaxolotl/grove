# Simpler notebook organization across Grove

**Proposed implementation plan — 25 October 2026.** This is not a shipped feature
or a gesture-fix verification record. Based on the supplied mobile Notebooks
screenshot, the owner's report that mobile gestures are not working, and the
follow-up request to investigate other areas and make moving, nesting and
rearranging notebooks easy. Source
review baseline: development `05fe8fd`, refreshed to `06d8740` after the independent
subscription badge merged. Preserve that new badge and its on-demand usage controls.

## Outcome and scope

Make opening a notebook the obvious action, organizing it a clear secondary action,
and vertical scrolling dependable. Keep Grove's quiet green notebook identity.
Every operation must work by tapping visible controls and with a keyboard; drag
and swipe are enhancements, not prerequisites.

Scope: the manager, sidebar/mobile explorer, notebook pages and sub-notebook lists,
destination pickers and their shared navigation/gesture/data contracts. Regress
shared note gestures if those handlers change. Also review adjacent note creation,
search/filter and Ask Grove scope selection for consistent notebook discovery;
do not redesign their unrelated content. This does not introduce a mobile app,
change notebook permissions or add AI workflows. The separate notebook-workflows
PR #135 and active import/subscription work are not prerequisites.

Three equally important tasks:

1. **Move:** choose another parent or the top level.
2. **Nest / move out:** put a notebook inside another, or promote it one level.
3. **Rearrange:** change sibling order and retain that order after reload and on
   another device. Renaming notebooks to influence alphabetic order is not a solution.

Manual ordering needs backend support; it is not just a visual drag refinement.

## What needs improvement

| Observation                                                                              | Planned response                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Five exposed actions per active notebook; mobile CSS wraps them onto another row         | One persistent, labelled actions-menu trigger per row; reuse existing actions |
| Folder drag activator, disclosure and title compete for room                             | Clear independent hit areas; title opens, disclosure expands, menu organizes  |
| Permanent dashed Top level target and drag instructions precede/follow everyday browsing | Contextual destinations during a deliberate move, not idle decoration         |
| Unfiltered notebook total repeats beside search                                          | One total when idle; filtered count replaces it while searching               |
| Generous gaps and supplementary footer compete with notebook content                     | Compact heading/search/list rhythm; quieter supplementary navigation          |
| Owner reports mobile gestures failing                                                    | P0 reproduction and root-cause investigation, not threshold guessing          |

## Cross-app investigation and simplification

These are source-verified findings, not completed browser usability tests:

| Area                              | Current implementation / friction                                                                                      | Planned simplification                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop sidebar / mobile explorer | Shared tree, icon-only Manage entry, folder icon is the drag activator; Move is in each row menu                       | Keep one shared tree and action vocabulary; expose a labelled Organize entry in explorer controls so it is discoverable on touch                                   |
| Notebook manager                  | Always-on five-button action strip, idle drop target; no explicit organizing mode                                      | Quiet browse list plus a distinct Organize/Done mode with deliberate controls                                                                                      |
| Notebook page                     | Options menu puts assistance before ordinary management; Sub-notebooks renders a tree without action callbacks         | Put New note / New sub-notebook and Move in clear groups; give sub-notebook rows the same organization entry points without leaving the page                       |
| Move dialog                       | Parent notebook dropdown; full path labels, but no visible search input or manual position choice                      | Shared searchable destination browser showing current location, breadcrumbs, Top level and destination confirmation; keep advanced repository fields out of moving |
| Ordering                          | `NotebookTree` and API sort by name; contract contains parent/version but no sibling position                          | Persist sibling order and support before/inside/after intent, not only parent changes                                                                              |
| Catalog completeness              | `MemoryService.projects()` ends with `.limit(100)` and the provider reads a single array                               | Add a complete owner catalog/pagination path before promising all destinations; Pro already permits 500 notebooks                                                  |
| Adjacent notebook pickers         | Creation, note moves, filters, global search and Ask scope share NotebookSelect; it wraps a select, not a search field | Share complete eligible catalog and path formatting; add visible search where choosing a destination, without changing scope or retrieval semantics                |
| Feedback / recovery               | Dialog moves and drag moves use different handlers and feedback; only drag has the existing version-fenced Undo        | One organization operation/result path; consistent move feedback and explicitly implemented, version-safe Undo for new organization actions                        |

The 100-row cap can also make a visible child appear top-level when its parent is
absent from the returned slice. That follows from the list's parent normalization;
it must not be confused with a deliberate unnest. Reproduce with a synthetic
catalog larger than 100 before designing a complete hierarchy UI. Hidden or
unauthorized parents must still remain hidden; completeness must not bypass scope.

Prioritize organization and navigation over cosmetic changes to every screen.
Keep note content, editor/history, existing archive/delete confirmations and AI
tools intact. Shorten always-visible controls, group secondary actions and reuse
the same organization flow instead of adding a separate system per screen.

The screenshot demonstrates layout, not event behavior. Source inspection confirms
the wrapping action strip and permanent target; it does not establish the gesture
failure's cause or exact affected interaction.

## Design direction

### Tokens and hierarchy

Reuse existing workspace tokens rather than introducing a second theme:

| Role    | Current value / proposed use                                |
| ------- | ----------------------------------------------------------- |
| Paper   | `#f8f9f7`, workspace background                             |
| Surface | `#ffffff`, list and inputs                                  |
| Forest  | `#253e31`, primary text and main action                     |
| Muted   | `#626e66`, secondary text with verified contrast            |
| Sage    | `#edf1e9`, restrained hover/active surface                  |
| Line    | `#e1e5df`, list boundaries; not the sole control affordance |

Keep **Space Grotesk**. Proposed phone scale: 24px/30px semibold heading,
16px/22px notebook names and search input, 14px/20px secondary text. Input text must
not provoke iOS focus zoom. Use 16px phone side gutters and an 8px spacing rhythm.
Normal rows target 64–80px, growing naturally for enlarged text. Controls retain
at least 44×44 CSS-pixel independent hit areas; never shrink them to hit a row target.

Use one divided list surface, not a grid of cards. Names get up to two lines at
normal text size, with the full name available accessibly; enlarged text may grow
the row rather than clip controls. Avoid decorative shadows, gradients, new fonts,
additional metadata fetched only for appearance, and nonessential motion.

### Proposed phone layout

```text
Notes       Ask Grove       Archive       Settings
Notebooks                                  Commands

Notebooks                           + New notebook
Active       Archived
[ Search notebooks                              × ]
3 notebooks

  folder  Cocktail Reviews                       …
  folder  Movie Reviews                          …
  folder  The Cottage — Fantasy Hockey            …
          (2026–27)

Help & policies                             expand
Privacy choices
```

This is structure, not a pixel-perfect mockup. At 320px, move the labelled create
button to its own line before compressing the heading or touch targets. Preserve
the four existing destinations and the Notebooks disclosure; do not add a second
sticky or bottom navigation system. Keep everything left-aligned and title-led.

Design review: a card grid and floating add button would add decoration and hide
hierarchy. The divided notebook list and labelled create action instead preserve
Grove's existing identity while removing management clutter. Compact does not mean
smaller type, truncated-only titles or gesture-only controls.

## Interaction contracts

### Browse, search and actions

- Tapping a notebook title opens it. Tapping its disclosure only expands/collapses;
  tapping its menu never opens or drags the notebook. Do not nest buttons in links.
- One menu exposes existing New note, New sub-notebook, Rename, Move and Share,
  followed by separated Archive and Delete actions. Archived notebooks expose
  Restore and Delete only, preserving current lifecycle confirmation and scope.
- Reuse `ActionMenu` with non-compact `NotebookActions`; do not wrap the existing
  compact strip in another menu or create nested duplicate lifecycle menus.
- Keep active/archived URL state and lazy archive fetching. Search matches names,
  retains ancestor paths and expands matching branches; counts describe actual
  matches, not the extra ancestors displayed for context. Clearing restores the
  pre-search expansion state. Show saved sibling order in normal browsing; search
  result ranking and alphabetical destination lookup are separate concerns.
- Search stays full-width. Show one total when idle and “2 of 3 notebooks” when
  filtering; loading has no invented zero. Provide Clear search for no matches.
- Menus overlay rather than move rows, stay within the visual viewport and remain
  scrollable with a keyboard open or in landscape. Closing a nested dialog returns
  focus to its row trigger, or a sensible next row if the original was removed.
- Retain rows during background refresh/error. First-load failure offers Retry;
  empty active and archived lists have distinct guidance. Keep entered dialog
  values after failure/version conflict and reserve feedback space.

### Organize without gestures

`Notebook actions → Move notebook` is the dependable phone path. Evolve the existing
dialog, rather than adding another modal system: full paths, current location,
visible destination search, breadcrumbs, Top level, explicit Move/Cancel and
disabled no-op/self/descendant choices. Existing Select has typeahead but no visible
search input; searchable destination browsing is new implementation work, not a
capability to assume. Sub-notebooks follow the parent. Cancellation makes no write;
concurrent changes require review.

Keep existing expected-version checks, cache reconciliation and version-fenced
drag Undo. Do not imply that dialog moves already have Undo or promise Undo for
destructive notebook deletion. Undo parity for the shared organization flow below
is new, explicitly tested implementation work.

### One simple organizing mode

Normal browsing retains one actions trigger, not a permanent row toolbar. A
labelled **Organize** control opens the shared organizer from the manager or
explorer; notebook-page actions open it focused on that notebook. Show **Done** to
leave; leaving cancels an uncommitted gesture/choice, not already saved operations.

On a phone, select a notebook and show its organization controls in one anchored,
scrollable panel, not five controls on every row:

```text
Organize notebooks                            Done

  Cocktail Reviews
  Movie Reviews                         selected
    Festival notes
  The Cottage — Fantasy Hockey (2026–27)

Movie Reviews
In: Top level
[ Move up ] [ Move down ]
[ Nest inside… ] [ Move out ]
```

- **Move up / Move down:** move one position among siblings; disable at the bounds.
  Save immediately through the shared operation, announce new position and offer
  Undo. Selection/focus follows the notebook; the panel stays out of the keyboard
  and safe area and never obscures the selected row.
- **Nest inside…:** open the same destination browser, excluding itself and its
  descendants. Confirm “Move Movie Reviews into Cocktail Reviews”; avoid a separate
  technical Parent notebook concept. Insert at the end unless a position was chosen.
- **Move out:** promote one level, placing the notebook immediately after its old
  parent among that parent's siblings. Disable at top level. Preserve its subtree.
- **Move…:** allow choosing any eligible parent and, optionally, an explicit place
  before/after an existing sibling. Default to end for uncomplicated filing. This
  makes distant repositioning practical without dozens of Move up presses or drag.
- Keep these alternatives available with keyboard/screen reader and without hover,
  press-and-hold or precise dragging. No destructive actions in this panel.

For mouse/pen and validated touch dragging, distinguish **insert before**, **nest
inside**, and **insert after** with an insertion line versus an inset destination
highlight and clear text. Mere hover across a row must not unexpectedly reparent it.
Show the final parent/position intent before release; dropping a subtree preserves
its internal order. Do not overload horizontal scrolling with an implicit indent
gesture. Search can locate a notebook, but ambiguous sibling reordering is disabled
until the relevant complete sibling group is visible; explain how to show it.

Use a single service operation for panel, dialog, keyboard and drag actions. The
UI should not maintain independent parent/order algorithms or a move that succeeds
while its position fails. Reuse existing dialog/popover and notice primitives.

Task-effort targets: from an already open organizer, selecting a notebook and
moving it up/down or out takes at most two taps. Nesting needs one destination
choice and one confirmation after opening the picker; searching is optional for
small lists. No task requires a visit to Settings, renaming, a precise long press
or navigating away to the manager. Observe these journeys during usability review,
including with a first-time user, rather than equating fewer icons with simplicity.

### Durable ordering and a complete destination catalog

Proposed implementation contract, to freeze before coding:

1. Add server-owned sibling position metadata (for example a spaced integer rank)
   under each account/parent, including top-level siblings. Backfill existing groups
   in stable name/ID order to preserve the current initial presentation. New
   notebooks append to the group; renaming no longer silently reorders it. Existing
   older clients can omit the new fields; do not rename notebook IDs/references.
2. An organization request identifies the notebook, expected version, destination
   parent and an optional before/after sibling anchor plus expected ordering state
   and operation ID. Resolve positional intent server-side under the existing
   account write lock. Reparent + reorder commit atomically; compact ranks only
   inside the affected group when needed. A no-op makes no revision churn.
3. Validate active status, same-account eligible parent/anchor, anchor membership,
   self/descendant cycles, current version and sibling ordering revision. On a
   stale destination/order, preserve user intent and require review rather than
   guessing. Retry an accepted-but-lost request with the exact operation ID/body;
   it produces one durable result. Undo uses the resulting versions/order tokens
   and refuses to overwrite later moves or sibling edits.
4. Use one shared ordering helper for manager/sidebar/sub-notebook rendering.
   Return sufficient ordering metadata to owning sessions; keep ranks internal
   where scoped clients could infer hidden siblings. Do not submit an entire
   account order from a filtered/partial list. Keep ordering edits owner-session
   only initially; existing agent writes retain existing permissions and append
   semantics, not new account-wide organization authority.
5. Replace the owner UI's silent 100-row cap with a cursor-paged full-catalog resource
   or compatible paged extension, consumed through the existing account/session
   cache. Keep legacy array clients compatible. Load enough parent/sibling context
   to act safely; expose loading/partial/error/retry rather than asserting a partial
   list is complete. Do not flatten known parents merely because another page has
   not arrived. Test above 100 and at 500, plus larger self-hosted catalogs.
6. Preserve tenant RLS, current grants, hierarchy-is-not-permission semantics,
   public-link descendant behavior, retained data and notebook lifecycle rules.
   Moving can change coverage under an existing include-sub-notebooks public link;
   disclose that existing consequence in move review without creating/revoking
   links implicitly. Ordinary sibling reorder changes no public access.
7. Add a forward-only migration using the next free slot after refreshed upstream
   review, not a guessed number. Cover export/import/recovery, archived-parent
   restore and older clients. Preserve rank on archive; define restore collision
   resolution deterministically without modifying another notebook's access.
   Do not trigger AI reprocessing solely because display order changed; audit
   version-based source invalidation and minimize unrelated revision churn.

Choose one rank representation and revision/replay contract after reviewing current
migrations/recovery. The exact schema/endpoint shape is proposed, not existing
functionality. This part of the request requires shared contracts, API/service,
database and cache work as well as the frontend; do not ship a CSS-only “rearrange”
that snaps back alphabetically after refresh.

### P0: diagnose the reported mobile gesture failure

Before selecting a repair:

1. Obtain exact failing action, start target, expected/actual outcome, device,
   OS/browser versions and reproduction frequency. Start with notebook dragging
   on the supplied screen; check note swipes and vertical scrolling separately.
2. Reproduce against the affected deployed build and current local production CSS
   using synthetic notebooks, recording build identity. A difference between the
   builds is evidence, not proof that current source fixes the report.
3. Trace `touchstart`/pointer input → handle → sensor pending/active/abort →
   collision/destination → cancel/end → API mutation. Inspect computed touch-action,
   passive listeners, default prevention, pointer capture, scroll ancestors,
   visual-viewport changes and actual request counts. Keep content out of traces.
4. Compare the existing explicit Move path, mouse and keyboard paths. Inspect
   unmount/navigation and second-contact cancellation; test one hypothesis at a
   time. Add the smallest failing regression before changing production handling.
5. Fix the demonstrated boundary and re-run the reproduction plus cross-input
   checks. Do not globally disable scrolling/zoom, replace sensors wholesale or
   adjust long-press delays just because it seems likely to help.

Current code uses a 220ms touch activation delay with 8px tolerance; mouse/pen use
6px activation. The notebook folder icon is the drag activator, with
`touch-action: none`; note rows use `pan-y pinch-zoom`. These are investigation
points, **not confirmed causes**. Existing CDP drag tests exercise Chromium input;
the focused iPhone/WebKit configuration explicitly excludes those CDP cases.

Required behavior, independent of the eventual repair:

- Normal vertical gestures on rows/content scroll; they do not start a move, reveal
  actions, follow a link or write data. Pinch zoom and browser-edge navigation remain
  native. If movement begins before pickup, abort pending drag without a write.
- If retained on phones, dragging starts only on a deliberate handle activation,
  not anywhere on a row. Show pickup/destination feedback only after activation.
  Decide whether touch dragging remains exposed only after device evidence; keep
  tap Move available either way, and retain desktop/keyboard organization.
- Show Top level and relevant valid destinations while moving. Hiding idle targets
  must not make keyboard destinations unavailable on pickup. No row layout jump.
- Successful drag makes one valid move; invalid/current/self/descendant drops,
  second contact, `touchcancel`/`pointercancel`, lost capture, route/source removal
  and explicit Cancel make zero writes. All interruption paths clear the preview,
  pending timers, listeners and scroll locks; the next tap works normally.
- Destination autoscroll must not fight page scroll. Preserve scroll/focus after
  completion, failure and cancellation. Announce meaningful pickup/result/cancel
  states without announcing every pointer movement.
- Existing note swipe only reveals actions; it never archives/deletes immediately.
  Diagnose it separately if reported broken. Do not add notebook swipe as new scope.

### Navigation and footer

Reduce this screen's redundant vertical spacing before altering global chrome.
Keep navigation reachable, account access available and command controls labelled
for touch users rather than relying only on desktop shortcut symbols/tooltips.
Group supplementary setup/help/legal links under a native disclosure on compact
screens; retain immediately reachable cookie/telemetry choices without changing
consent behavior or hiding legally required access. Test shared-shell pages before
shipping shared changes. Avoid a fixed-height application shell that traps scrolling
behind Safari's expanding browser bars or the software keyboard.

## Implementation sequence and code map

| Phase                                | Work                                                                                                                                      | Primary files                                                                                                           | Exit condition                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P0 — reliability and catalog         | Capture failing input, add regression, isolate repair; remove incomplete-destination assumptions                                          | `memory-drag.tsx`, `memory-row.tsx` if affected, `notebooks-provider.tsx`, service listing                              | Reproduction passes; scroll/cancel cause zero writes; catalogs above100 preserve parents |
| P1 — durable organization foundation | Atomic parent/order operation, version/replay-safe Undo, compatible complete catalog and persisted ranks                                  | Shared contracts, API routes, memory service, forward migration, cache helpers                                          | Reorder/nest/unnest survive reload; concurrent/foreign/stale changes are safe            |
| P1 — unified organizer and list      | Organize/Done, Move up/down/out/inside, visible destination search, compact browse rows                                                   | `notebook-tree.tsx`, `notebook-actions.tsx`, `notebook-dialog.tsx`, `project-form.tsx`, `src/app/app/projects/page.tsx` | All three organization tasks work by tap/keyboard and through validated drag             |
| P2 — cross-app simplification        | Consistent explorer and notebook-page controls, sub-notebook actions, grouped options, shared picker completeness and scoped shell polish | `context.tsx`, `notebook-explorer.tsx`, `notebook-select.tsx`, `shell.tsx`, notebook/sidebar/workspace styles           | Same saved order/actions everywhere; unrelated workflows and consent unchanged           |
| Qualification                        | Cross-engine/device/accessibility review and documentation                                                                                | Existing tests, testing/workspace/delivery docs and screenshot gallery                                                  | Required gates and evidence reviewed on exact PR head                                    |

Component paths above are under `packages/website/src/components/dashboard/` unless
prefixed with `src/`; stylesheet names are under `packages/website/src/app/app/`.
Confirm filenames and interfaces again before coding; shared modules have parallel
workstreams. Backend entry points include `lib/shared/src/contracts.ts`,
`lib/memory/src/index.ts`, `lib/database/src/` and `packages/api/src/app.ts`.
Read installed Next.js guides before implementation. Durable order/completeness
need API and forward-migration work; no new dependency or provider is expected.
Reuse account-owned cached reads; do not introduce per-row requests or preload editors.

## Acceptance and verification

- Review 320, 390, 430, 768 and 1440px, short landscape, 200% text and 2× pinch zoom.
  No horizontal document overflow, overlapping hit areas or inaccessible controls.
  Three ordinary notebooks fit in the content area at 390×844 with the explorer
  collapsed and keyboard closed; long titles/text scaling may increase row height.
- All controls at least 44×44px for touch, normal input/name text at least 16px,
  visible keyboard focus, meaningful accessible names and expanded/current states.
  Check WCAG A/AA contrast, reduced motion, forced colors and a screen reader.
- Seed long/unbroken names, repeated names under different parents, deep nesting,
  0/1/100/500 notebooks, filtered descendants and archive states. Preserve paths and
  avoid new read requests per row. Large lists remain scrollable and responsive.
- Explicit task journeys: move A from one parent to another; nest A inside B;
  promote a deep child one level; move top-level/sibling A before/after B; move a
  whole subtree; reorder with only taps and with keyboard. Repeat from manager,
  explorer and notebook-page rows; reload and open a second session/device to
  verify the same order. Rename must not change a saved position.
- Backend tests cover seeded alphabetical backfill, more-than-100 discovery, partial
  pages/failed page retry, same-account RLS, invisible parents/siblings, cycles,
  anchor deletion/archive/move during a request, concurrent sibling reorders,
  no-op/end boundaries, exact replay, version-safe Undo and restore/import/recovery.
  Order-only changes must not charge AI usage or fabricate a content revision.
- Exercise create/open/rename/sub-notebook/move/share/archive/restore/delete through
  visible controls; cancel confirmations, force stale versions and retry failures.
  Assert cache/list reconciliation and correct focus, not just toast text.
- Add failing regressions in existing `packages/website/tests/workspace.spec.ts`
  before handler/UI changes. Cover actual notebook handles, not only note handles.
  Keep Chromium trusted-input cases and supported WebKit tap/scroll/menu tests
  distinct; do not substitute synthetic DOM events for native gesture qualification.
- Test physical iPhone Safari and Android Chrome: ordinary/diagonal scroll, pickup,
  cancel, actual destination drop, rapid second tap, second contact, zoom, keyboard,
  browser-bar resize and edge navigation. Record devices/builds and failures.
  Without device access, disclose the gap and do not claim the gesture bug fixed.
- Run Node 24 / pnpm 10.33: root `pnpm lint`, `pnpm check-types`, `pnpm build`,
  `pnpm test:artifacts`; website lint/types/production build, affected/full browser
  suites, relevant backend/migration/RLS tests and existing bundle budgets. Use
  only new disposable non-owner PostgreSQL fixtures and isolated browser ports.
  No retained DB resets or authentication/tenant-boundary changes. Release checks only if release
  inputs change. Follow [testing guidance](testing.md).

## Documentation, review and rollout

After implementation, update [workspace behavior](../workspace.md), server/API,
notebook lifecycle, export/recovery and rollout docs, this proposal's
status, [testing](testing.md) and [delivery evidence](../delivery.md). Audit claims
about permanent Share buttons, More actions, long-press reliability, idle drop
targets and footer placement. Preserve historical delivery results as historical;
do not rewrite earlier emulation passes as physical-device acceptance.

Save reviewed synthetic before/after, open-menu, move, nested/long-name and archived
captures under `documentation/design/screenshots/notebook-mobile-ux/`, with build
identity and viewport/engine notes. Do not commit the owner's private screenshot.
Include relevant previews in the implementation PR, at most four per row. No
after-screenshots are appropriate for this documentation-only planning task.

Use small dependency-ordered PRs into `development`, assigned to `miniaxolotl` with
one appropriate label; verify exact-head CI and resolved review. This plan's PR is
documentation-only. No automatic merge, release, production setting change or
deployment is implied. After a confirmed authorized merge, remove only the clean
stale task worktree and retain external plans/evidence.
