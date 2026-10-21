# Explainable connections

Reviewed captures use the isolated dashboard fixture, production CSS and synthetic
notes/notebooks. They contain no production account data.

- [Note evidence, desktop](note-evidence-desktop.png): cautious conflict label,
  specific disagreement, current excerpts from both notes, Compare and Dismiss.
- [Note evidence, 320px](note-evidence-mobile.png): stacked quotations and reachable
  review actions, with no horizontal overflow.
- [Notebook graph](notebook-graph.png): separate Notes/Notebooks levels, keyboard
  focusable edges and labelled shared threads.
- [Notebook evidence](notebook-evidence.png): limited coverage (8 of 40 and 3 of 3),
  source-note links and direct notebook navigation.

All 78 Chromium scenarios pass. Three focused iPhone/WebKit scenarios also pass:
evidence/comparison/focus and dismissal/Undo; notebook context and graph; and failed
processing recovery, pagination and stale review/comparison rejection. Automated
WCAG A/AA checks pass for the evidence inspector. Reproduction commands are in
[testing](../../../development/testing.md).
