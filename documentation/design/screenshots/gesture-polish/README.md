# Gesture and interaction polish

Reviewed Chromium captures from the isolated dashboard fixture, using production
CSS, local fonts and synthetic notes/notebooks. Touch scenarios use trusted CDP
events; these are browser-emulated device captures.

- [Phone reader](compact-reader-mobile.png), 390 × 844: the writing region starts
  at y=134, versus y=280 in the [previous drawer](../note-workspace/note-drawer-mobile.png).
  Back, Save, status and Actions remain visible; secondary actions live in the menu.
- [Narrow reader](compact-reader-320.png), 320 × 750: a single compact header,
  unchanged editor history after touch Bold/Undo, and no horizontal overflow.
- [Touch destinations](touch-destinations.png), 390 × 844: edge autoscroll reveals
  later notebooks, with the preview above the contact and an active cancel target.
  Releasing over Cancel issues zero writes; a subsequent valid drop moves once.
- [Expanded graph](graph-touch-expanded.png), 390 × 844: in-app expansion, deliberate
  pan/pinch, selected-note reader and visible Fit/Zoom/Exit controls. The nested note
  drawer closes back to this graph without losing its viewport.
- [Shared feedback](feedback-stack-desktop.png), 1280 × 720: durable move Undo and
  transient copy feedback stack inside the active dialog without overlapping or
  moving the writing area. Undo still checks the returned mutation version.

Verification: 87 Chromium scenarios and eight focused iPhone/WebKit scenarios pass,
including accessibility, privacy, retry/draft/conflict behavior and keyboard
alternatives. Physical software keyboards, OS selection handles, browser-edge
gestures and trackpad/pen feel need device qualification.
