# Stable workspace interactions

Small state changes should keep the user's current control and reading position
in place. Content can resize when the content itself changes; selection, opening
controls and transient feedback should use space already available.

## Library

- `LibrarySelection` owns the permanent list header. Partial selection uses the
  native checkbox's mixed state. Bulk actions occupy that header rather than a new
  row. Clearing returns focus to its checkbox; Escape clears selection without
  taking over drag cancellation or nested overlays. The existing 50-note limit
  and mutation/undo operations still apply.
- Advanced filters use a native light-dismiss popover, measured against the
  visible viewport. Its footer stays available while its fields scroll. Dropdown
  portals stay inside the nearest popover or modal, so the top layer, focus
  isolation and nested Escape dismissal agree.
- Active filter chips, notebook selection and sorting live in the panel. The
  trigger's count and search-clear affordance reserve their widths. The view
  switch keeps its position without a separate sort slot in the caption.
- Clearing filters preserves sort order. Empty results have a direct Clear
  filters action; the search draft reconciles that external reset. Removing a
  chip focuses its next/previous chip, or Done when it was the last chip.
- Row dots and swipe reveal share `ActionMenu`. Native auto-popovers own dismissal
  and single-menu visibility; actions close before opening a dialog so focus returns
  to the row trigger. Menus overlay the list rather than adding a second row.

## Navigation and note tools

- Search passages share `search-passage.ts`: bounded plain-text extraction, literal
  Unicode letter/number tokens (two or more UTF-16 units), case-insensitive without
  accent folding, at most 16 query words and a 40–500-character passage. Prefer a
  window containing more distinct matched words, break ties by first occurrence,
  and use the opening excerpt when no literal word occurs. JSX text/`mark` rendering
  never executes query regexes or HTML. Match the query belonging to visible results.
- `note-headings.ts` uses CommonMark/GFM rather than line regexes or DOM indices.
  ATX/Setext headings, nested structures, inline labels and CRLF positions use one
  model. Fenced examples are not headings. NFC/lowercase letter/number slugs have
  a `section-` prefix, `heading` for an empty slug and global collision suffixes
  starting at 2; rename/duplicate-order stability is deliberately not promised.
- `NoteOutline` shares searchable rows, private section-link copy/fallback and
  current-section state between inspector and optional rail. The rail appears only
  above 1000px of **editor container** width. Do not remount CodeMirror when pinning,
  opening the inspector or changing modes. Selection navigation adds no history or
  autosave. Preview follows scroll; writing follows cursor or scrolled source block;
  the last section is active at the document's scroll end.
- Saved-note fragments resolve inside the mounted editor after data/chunks load and
  on hash/history changes. Unknown or malformed fragments do nothing. New-note copy
  stays disabled until first-save identity arrives. These links never create public
  capabilities; existing shared-link rewrites preserve fragments only after their
  ordinary linked-note scope check.
- Sidebar persistence belongs to the authenticated account owner, not a reusable
  tree or a module-level global. Follow the metadata/restore contract in
  [client caching](client-cache.md); scroll listeners are passive and writes debounced.
- Heading jumps and conversation history use `Dialog.onDismissed` to hand focus
  over **after** normal opener restoration. React's closed state or an animation
  frame alone does not guarantee the modal's deferred cleanup has finished. Delete
  success uses the same hook to focus history search; Cancel retains its opener.

- `sidebar.css` owns desktop/mobile navigation. Reserve row action space, allow two
  notebook-label lines and keep focus outlines inset. The explorer header stays
  reachable while its tree scrolls; phone navigation wraps when text is enlarged.
- Note modes share one persistent toolbar and editor instance. Properties and
  outline use `InspectorDialog`; save feedback has reserved width. Switching
  presentation or returning from focus mode restores the corresponding scroll.
- Viewer task toggles use parsed source positions and the normal editor history,
  autosave and conflict path. Pass task editing only to the editable note viewer;
  shared readers, revision history and comparisons keep read-only Markdown.

## Search, commands and preferences

- Global search and the command menu have a viewport-bounded, stable dialog
  height. Results scroll within it. Loading, empty results and the contextual Ask
  link do not move the query input. Clearing search keeps focus in the input.
- Command labels, icons, aliases and shortcuts come from the shared command and
  shortcut definitions. Keep selection keyed by command identity during first-save
  routing and availability updates, and leave native text-editing keys to the input.
- Preferences show save state beside a stable Save button. A completed save only
  acknowledges the submitted snapshot; changes made while it is pending remain
  unsaved. Errors use existing toast feedback and the reserved status line.
  Reverting to persisted values removes the need for another write.

## Visual treatments

- Use typography, spacing and quiet surfaces for hierarchy. Selected palette rows
  use a full-row fill; avoid decorative coloured edge stripes on controls or content.
  Forced-colour selection uses a complete inset outline.
- Workspace overlays share the workspace colour tokens even when rendered outside
  `.grove-app`. Keep dialog headings compact, shadows restrained and dropdown
  entrances stationary. Hover feedback must retain text contrast and skip disabled
  controls.
- Quotes use inset spacing and a neutral surface across writing, reading, public
  links and connection evidence. Source lists use divided rows, with excerpts and
  keyboard focus kept readable at phone widths.
- Desktop note grips appear on row hover or focus without changing the reserved
  space. Touch layouts keep the grip visible.
- Ask Grove fills the space beneath navigation and keeps conversation/search
  scrolling inside the console. The composer stays visible at ordinary desktop,
  tablet and phone sizes; short windows can scroll the page to reach its controls.
- Note rows, search, graphs and source lists share `memoryExcerpt` for compact
  plain-text previews, including quotes, tasks, fenced code and link labels.

## Verification

The browser suite checks row/header bounds at 320, 390 and 1440px; partial/all
selection and focus recovery; nested dropdown dismissal; filter reset and sort
retention; contained touch layouts and WCAG A/AA checks; held search results and
empty command geometry; and held/failed preference saves with newer edits.

After the production website build, run the normal Chromium suite and the
focused WebKit suite (use separate fixture ports when running concurrently):

```sh
WEBSITE_TEST_PORT=4396 DASHBOARD_TEST_PORT=3196 pnpm test:website
DASHBOARD_TEST_PORT=3197 pnpm --filter website exec playwright test \
  --config playwright.stable-webkit.config.ts
```

The WebKit checks also run in the Playwright `v1.64.1-noble` image on hosts without
WebKit's system libraries. Synthetic fixture data stays separate from application
authentication and production storage.

## Parallel feature integration

The selection header and filter panel are independent of the library's data
source. When integrating client-cache work, retain its query ownership, stale
state and deferred editor boundaries. Likewise retain the gesture, action,
relationship and sharing workstreams' row controls and mutation contracts.
Preference draft/saved snapshots must remain separate if `/me` moves to a shared
query cache; a background cache update must not acknowledge unsaved local edits.
