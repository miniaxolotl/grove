# Unified note workspace

Reviewed browser captures from the isolated dashboard fixture, with production
CSS and local fonts. Notes, notebooks and account details are synthetic.

- [Desktop drawer](note-drawer-desktop.png), Chromium 1440 × 1000: the wider
  persistent workspace, reading/editing toggle, collapsed connections and copy
  toast. The test verifies unchanged content geometry after copying.
- [Mobile drawer](note-drawer-mobile.png), Chromium 390 × 844: contained drawer
  bounds, accessible actions and mode switch, with no horizontal overflow.
- [Settings](settings-mobile.png), Chromium 320 × 750: persistent heading and
  horizontally scrollable section navigation, with independently scrolling content.
- [Revision comparison](revision-history.png), desktop Chromium: version-fenced
  history remains available from the same workspace.

All 75 Chromium scenarios passed, including the scrollbar-gutter drawer correction
and first-save modal focus/command regressions. Seven iPhone/WebKit scenarios passed: settings
navigation and toast geometry, long-note scrolling and mode-position restoration,
mobile notebook creation, formatting/history/preview, long notebook menus, and
first-save command and shortcut-help focus/preview retention.
Responsive captures and WCAG A/AA checks passed. These are browser captures.

## Note form and notebook picker

Synthetic Chromium captures from the local dashboard fixture with the production
website CSS, based on `9ee71cc9`:

- [Desktop form, 1440 × 900](note-form-desktop.png): note type and retention sit in separate groups. Save and Cancel stay below the scrolling fields.
- [Mobile form, 390 × 844](note-form-mobile.png): the options stack, with keyboard focus on automatic typing and Save still visible.
- [Parent notebook picker, 320 × 640](note-parent-picker.png): New notebook starts with the note’s selected notebook as its parent. You can change it or cancel to return focus to New notebook with the draft intact.
- [Saved note properties, desktop detail](note-properties.png): generated tags are labeled separately from editable options.

The mobile checks used a dark OS preference; the workspace retains its light palette.
These viewport checks do not exercise a physical phone or its software keyboard.
