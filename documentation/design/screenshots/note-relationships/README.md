# Explainable connections

Reviewed captures use the isolated dashboard fixture, production CSS and synthetic
notes/notebooks. They contain no production account data.

## List / Graph switch

Captured in Chromium from the List / Graph change based on `c8de2701`, using
the dashboard fixture with CSS from `pnpm build:website`. The “Website redesign”
notebook contains two synthetic notes linked by one related connection.

- [Notes list, 1440×900](graph-switch-list-1440.webp) and
  [Graph, 1440×900](graph-switch-graph-1440.webp): the switch shows the active view
  beside **More**, without moving the filters. Graph retains keyboard focus.
- [Graph, 320×900](graph-switch-graph-320.webp): the switch keeps its text labels
  beside **More** without horizontal overflow.
- [Notebook graph, 390×844](graph-switch-notebook-390.webp): the same switch sits
  beside the scoped note count.

These captures show fixture behavior; they do not qualify a live account,
physical touch or a screen reader.

## Connection inspector evidence

- [Linked notes, desktop](note-connections-desktop.png): compact rows with a short
  reason and quiet category; each row opens the shared inspector.
- [Connection, desktop](note-connection-desktop.png): centered summary with source
  details collapsed, endpoint links and secondary Compare/Dismiss actions.
- [Note evidence, desktop](note-evidence-desktop.png): on-demand current excerpts
  from both notes, without visible revision numbers.
- [Note evidence, 320px](note-evidence-mobile.png): stacked quotations and reachable
  review actions, with no horizontal overflow.
- [Notebook graph](notebook-graph.png): separate Notes/Notebooks levels, keyboard
  focusable edges, quiet lines and an optional connection list.
- [Notebook evidence](notebook-evidence.png): partial coverage is flagged in the
  summary; the supporting-notes disclosure groups sources and coverage (8 of 40
  and 3 of 3) by notebook.

All 78 Chromium scenarios pass. Three focused iPhone/WebKit scenarios also pass:
evidence disclosure/comparison/focus and dismissal/Undo; notebook context and graph;
and failed processing recovery, pagination and stale review/comparison rejection.
Automated WCAG A/AA checks pass for the evidence inspector. Reproduction commands are in
[testing](../../../development/testing.md).
