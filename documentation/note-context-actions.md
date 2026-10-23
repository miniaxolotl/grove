# Note context actions

Right-click anywhere in the editable note surface in Write, Markdown or Preview.
The menu uses the existing workspace colours and action rows, fits inside the
visible viewport and scrolls when space is short. It does not replace menus in
transcript text fields, sliders or selects, or in public/read-only reader pages.

- **Text:** Undo/Redo, copy selection, cut, paste plain text, select all and
  Bold/Italic/Code. Preview offers copying note Markdown and returning to editing.
  Add image uses the existing upload flow when the saved note is ready for media.
- **Images:** open or download the retained original, copy the authenticated media
  address or Markdown, select the exact reference in Markdown, or remove it from
  the note. Duplicate uses of the same image are targeted independently.
- **Recordings:** the same original/reference actions, plus play/pause, mute/unmute
  and show/hide transcript in Preview. Playback and transcript access remain lazy
  and use the existing controls, error handling and authorization.
- **Links:** open and copy the safe link address. Source links also expose their
  exact Markdown range. Source destinations use CommonMark entity/escape decoding
  before protocol validation, matching Preview. External images remain links until
  explicitly opened; no new automatic third-party requests are introduced.

Press **Shift + F10** or the context-menu key from the editor, image or recording.
Arrow keys and Home/End move through enabled actions; Enter/Space activates them.
Escape/Tab closes the menu and returns focus. Outside clicks, window blur and
actual scrolling of the note dismiss it. **Shift + right-click** keeps the browser's
native menu as an escape hatch. Existing toolbar and touch controls remain available;
no custom mobile long-press gesture is added.

Opening/copying/navigating does not save the note. Changes are normal CodeMirror
transactions with isolated Undo and existing autosave/conflict handling. Parsed
source ranges and CRLF-to-LF conversion avoid replacing the wrong repeated reference.
Document/mode/read-only changes invalidate the context; delayed cut/paste also
rechecks the captured document, selection and operation generation after the menu
closes. Changing note identity, Write/Markdown/Preview or read-only state cancels
pending edits even if the original state is restored before the clipboard responds.
Ordinary action dismissal does not cancel the chosen action. Clipboard failures leave
the draft intact and show keyboard/native-menu guidance. Paste is plain text and
normalizes CRLF/CR before calculating its caret and the 6,000-character growth limit.
Oversized drafts can still be shortened incrementally. Removing a Preview reference
focuses the persistent note surface, retaining keyboard context actions and Undo.

**Remove from note only removes the Markdown reference.** It never deletes retained
media, transcripts or historical revisions. Copied media addresses still require
the current account's authorization; they do not enable public sharing.

No backend, migration, provider configuration or deployment change is required by
this UI slice. Originally stacked on recordings (#95), it now integrates the landed
recordings and speech implementations on development, preserving both sets of controls.
[Reviewed captures](design/screenshots/note-context-actions/README.md).
