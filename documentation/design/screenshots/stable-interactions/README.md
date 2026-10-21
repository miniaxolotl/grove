# Stable workspace interactions

Reviewed captures use the isolated dashboard fixture, production CSS and local
fonts. Notes, notebooks and account details are synthetic.

- [Desktop selection](selection-desktop.png): bulk actions share the existing
  list header. Geometry assertions cover partial selection, selecting all, Move
  cancellation and clearing without moving any note row.
- [Narrow selection](selection-mobile.png): the same header at 320px, with
  touch-sized, labelled actions and no horizontal overflow.
- [Desktop filters](filters-desktop.png): advanced controls overlay the list.
- [Mobile filters](filters-mobile.png): a constrained, scrollable panel with
  persistent heading and footer. Opening, closing and clearing preserve the
  library's geometry; nested dropdown Escape preserves the filter panel.
- [Mobile global search](search-mobile.png): the query remains anchored while
  results load, clear or become empty. The command menu uses the same policy.

Browser verification covers all 108 Chromium scenarios and 11 focused WebKit
scenarios, including the existing editor, notebook, settings, chat and connection
flows, after integrating the landed gesture and note-action work. Automated WCAG
A/AA and viewport geometry checks pass. See the
[interaction contract](../../../development/stable-interactions.md).
