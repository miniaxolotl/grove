# Explainable connections

Reviewed captures use the isolated dashboard fixture, production CSS and synthetic
notes/notebooks. They contain no production account data.

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
