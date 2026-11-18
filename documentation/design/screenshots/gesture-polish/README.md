# Gesture and interaction polish

Reviewed Chromium captures from the isolated dashboard fixture, using production
CSS, local fonts and synthetic notes/notebooks. Touch scenarios use trusted CDP
events; these are browser-emulated device captures.

## Notebook drag feedback

Captured from the optimized candidate based on `c8de2701`:

- Desktop, 1280 × 800 (470 × 183 crops): [drop inside](notebook-drag-inside.png)
  uses a softly filled row and a folder-entry icon; [drop between](notebook-drag-between.png)
  marks the sibling boundary without filling the row. The lifted source keeps its
  readable label and grip. Neither cue changes the destination's dimensions.
- Phone, 390 × 844: [nest a notebook](notebook-drag-touch.png) shows the item
  held above the contact, leaving Garden readable. [Cancel a note move](touch-drag-cancel.png)
  shows the tray after edge auto-scroll, with the active cancel cue. The test
  verifies zero writes on cancel and one write on a subsequent valid drop.

Browser checks also cover the visible grip focus ring, reduced motion, keyboard
nesting, and reopening Organize with a tap. Physical iOS/Android contact, pen and
trackpad feel are not qualified by these captures.

## Earlier interaction evidence — 21 October 2026

- [Phone reader](compact-reader-mobile.png), 390 × 844: the writing region starts
  at y=134, versus y=280 in the [previous drawer](../note-workspace/note-drawer-mobile.png).
  Back, Save, status and Actions remain visible; secondary actions live in the menu.
  The saved control is neutral so the reading content carries the emphasis.
- [Narrow reader](compact-reader-320.png), 320 × 750: a single compact header,
  unchanged editor history after touch Bold/Undo, and no horizontal overflow.
  The pending draft retains a prominent explicit Save action.
- [Touch destinations](touch-destinations.png), 390 × 844: edge autoscroll reveals
  later notebooks within one panel, with an item-only preview above the contact and
  an integrated active cancel target. Rows remain quiet until targeted.
  Releasing over Cancel issues zero writes; a subsequent valid drop moves once.
- [Expanded graph](graph-touch-expanded.png), 390 × 844: in-app expansion, deliberate
  pan/pinch, selected-note reader and visible Fit/Zoom/Done controls. Optional
  **Controls** guidance and empty-state text sit below the canvas. The nested note
  drawer closes back to this graph without losing its viewport.
- [Narrow graph](note-graph-320.png), 320px wide: a composed two-row toolbar keeps
  the full filter label readable alongside Titles and Expand. The legend describes
  the sole visible connection type.
- [Shared feedback](feedback-stack-desktop.png), 1280 × 720: durable move Undo and
  transient copy feedback stack at the lower right of the active dialog, without
  overlapping each other or moving the writing area. The compact neutral surfaces
  preserve 44px actions. Undo still checks the returned mutation version.

Verification: 87 Chromium scenarios and eight focused iPhone/WebKit scenarios pass,
including accessibility, privacy, retry/draft/conflict behavior and keyboard
alternatives. All three graph checks pass after the final narrow-toolbar and
accessible-label adjustments, including disclosure focus and focal-point retention.
Physical software keyboards, OS selection handles, browser-edge
gestures and trackpad/pen feel need device qualification.
