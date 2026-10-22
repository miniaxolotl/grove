# Note and notebook actions

Reviewed 21 October 2026 using synthetic notes and production-built CSS.

## Refined PDF design

- `pdf-focused-note.png`: the new one-page layout. Restrained monochrome hierarchy,
  vector checkboxes, a quiet quote rule, content-weighted table columns and padded
  JetBrains Mono code. A single page has no footer.
- `pdf-focused-table.png`: a dedicated landscape table sheet with its section
  heading. Ordinary rows remain intact, headers repeat, and the note returns to
  portrait after the table. Long words wrap at the measured column edge.

The original PDF captures below retain the before state for comparison.

## Original feature review

- `reader-desktop.png`: direct Export/Delete, persistent reader and copied feedback.
- `reader-390.png`: 44px controls; writing surface starts at y=174, within the
  176px target. Compare the prior [gesture reader](../gesture-polish/compact-reader-mobile.png).
- `reader-320.png`: narrow layout with a retained local draft and visible actions.
- `export-390.png`: Markdown/PDF/Copy chooser in focus mode.
- `rename-notebook.png` / `move-notebook.png`: focused name/destination flows,
  current location context, and disabled unchanged submissions.
- `pdf-first-page.png`: locally generated, selectable four-page PDF with headings,
  linked image references, task lists and code.
- `pdf-wide-table.png`: repeated header and wrapped cells on page two of a long,
  eight-column landscape PDF. Tests verify every cell and text bounds.

The previous [workspace captures](../note-workspace/) retain the pre-export action
layout. Chromium and iPhone/WebKit checks cover keyboard/focus behavior, 320–1440px,
short viewports, enlarged text, reduced motion and Axe. Downloads were captured in
both engines; actual physical iOS/Android file-app behavior was not exercised.
