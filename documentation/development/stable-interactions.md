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
- Active filter chips live in the panel. The trigger's count, the search-clear
  affordance and the sort control have reserved widths. The sort slot remains
  reserved in Graph view so the view switch does not jump sideways.
- Clearing filters preserves sort order. Empty results have a direct Clear
  filters action; the search draft reconciles that external reset. Removing a
  chip focuses its next/previous chip, or Done when it was the last chip.

## Search, commands and preferences

- Global search and the command menu have a viewport-bounded, stable dialog
  height. Results scroll within it. Loading, empty results and the contextual Ask
  link do not move the query input. Clearing search keeps focus in the input.
- Preferences show save state beside a stable Save button. A completed save only
  acknowledges the submitted snapshot; changes made while it is pending remain
  unsaved. Errors use existing toast feedback and the reserved status line.
  Reverting to persisted values removes the need for another write.

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
