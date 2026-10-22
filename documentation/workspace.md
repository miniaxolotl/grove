# Your Grove notebook

Grove is a place for notes, ideas, and everyday writing. Start in **Notes** to write
and organize, or **Ask Grove** to talk about your notes. Notebooks live in the sidebar;
on a phone, tap **Notebooks** to browse them. Connected agents use the same notes and
permissions; their references live in **Note properties → Agent details**. The sidebar
logo always returns to Notes.

## Write, find, and organize

- **New note**, **Today’s note**, and existing notes share one reading/writing
  workspace. **Edit note** and **Preview** switch modes in place, keeping your cursor,
  undo history and scroll position. **Write** styles Markdown as you work;
  **Markdown** shows its source. Use the shared formatting toolbar,
  undo/redo, heading outline, and focus mode (Escape exits focus).
  **New note** follows the notebook you are browsing, filtering, or editing.
  Notes outside a notebook appear in **Unfiled**.
- Notes save automatically after a short pause, including in the wider drawer. **Save note** or
  `Ctrl`/`Cmd` + `S` saves immediately. Formatting supports `Ctrl`/`Cmd` + `B`, `I`, and `K`.
  Drawer editors can expand without losing their selection or undo history.
- Drafts stay in account-scoped memory while navigating Grove, including
  their original revision and retry ID. Unsaved drafts are not stored on disk;
  reload/close prompts while drafts remain. Saving checks concurrent changes and
  preserves typing that happens during a request.
  Reopening a draft during a save follows the same request rather than creating
  another note.
  **History** opens earlier revisions without leaving the workspace.
  **Linked notes** is a collapsed accordion below your writing. **Export** and
  **Delete note…** are directly reachable in the toolbar, including focus mode.
  **Note actions** orders Move, Export, revision history/properties, Archive or
  Restore, then separated Delete. On phones it also holds focus mode and
  previous/next controls. Save state stays visible; feedback does not move the page.
  Save stays visually quiet until there are changes to save.
- Press `Ctrl`/`Cmd` + `K` to search across your Grove, or `/` to filter the library.
  Results update after a short pause as you type. Combine
  notebook, note type, topic, source, updated date, and retention filters. Queries
  stay in POST bodies. Sorting and filtering apply to the entire matching library.
- Create a notebook with the sidebar **+** and just a name. **Manage** opens all
  notebook settings. Each notebook's action menu includes **New sub-notebook**;
  expand/collapse the tree in the sidebar to see notebooks and recent pages. Search retains
  matching notebooks' ancestors so you can see where they belong.
- **Rename notebook** focuses the name; **Move notebook** focuses the destination
  and preserves the name. Choose a **Parent notebook** or **Top level**;
  sub-notebooks move with their parent. Breadcrumbs and dropdowns show full paths.
  A notebook cannot move into itself or its descendants. Concurrent changes keep
  your inputs and offer the current version for review. Unchanged actions are disabled.
  Single-note moves start at their current notebook; mixed selections ask for a destination.
- Agent grants keep each notebook's own scope: parent access does not include children.
  Notes/search/Ask Grove stay scoped to the chosen notebook. Moving a notebook
  preserves its notes, revisions, retention, and stable agent/repository references.
- Select up to 50 loaded notes to move, archive, or restore. Drag a handle into a
  notebook, or press Space, choose a destination with the arrows, and press Space
  again. Escape cancels. On touch screens, a horizontal swipe reveals ordinary
  action buttons for one note at a time; vertical gestures scroll. A long press
  on the handle starts dragging and reveals a scrollable list of destinations.
  Hold near the list's edge to scroll, or release over **Drop here to cancel**
  at the bottom of the same destination panel. The preview identifies the item;
  the current destination is highlighted as you move.
  Pens start from the same handles. Interrupted gestures do not move a note.
  Notebook handles also support drag or keyboard nesting; hover over a collapsed
  destination to expand it. Focus mode fills the viewport and hides secondary tools.
- **Undo** checks the version produced by the original action. It never overwrites
  someone else's later edit. Partial failures identify the affected notes.
  Move and bulk-action Undo stays available in the shared notification stack
  alongside later copy feedback, including inside an open dialog. Compact neutral
  confirmations sit at the lower right, clear of the chat composer.

Dropdowns share keyboard, touch and focus behavior across filters, notebook choices,
note properties and settings. Use arrows, Home/End or typeahead, Enter to
choose, and Escape to dismiss; inside a dialog, the first Escape closes the menu.
An outside tap or click dismisses a dialog or drawer; scrolling or dragging across
its edge does not. Action menus follow their opener when scrolling/resizing and
scroll internally in short viewports. Confirmed mutations finish before
closing; background autosave retains its request and draft when you navigate away.

## Share with a link

Open **Share note** in a saved note's toolbar, the phone's **Note actions** menu, or
Commands. **Share notebook** is
available in notebook options and sidebar actions; the notebook manager also has
a Share button. Choose **Anyone with the link**, then save the settings. Visitors
can read the latest saved content without an account; permission is **Can view**.
Notebook scope defaults to **This notebook only**; **Include sub-notebooks** also
includes current and future descendants. Newly saved or moved-in notes become
visible through the chosen scope.

Copy/open reuses the current link. Replace invalidates the previous link. Choose
**Restricted → Turn off direct link** to revoke. The dialog lists any notebook
links that still include the content, with access to their settings. Archived and
expired notes are hidden until restored; deleted notes are unavailable. Pending
saves prevent new or replacement links while revocation remains available.
See [public sharing](sharing.md) for lifecycle and permission details.

## Commands and keyboard shortcuts

Open **Commands** in the sidebar or press `Ctrl`/`Cmd` + `Shift` + `P`. Type an
action, use Up/Down to choose, and Enter to run it. The menu includes actions for
the current note, including after a new note's first save. Escape returns focus to
where you were. **Keyboard shortcuts**
in the sidebar/footer, or `Ctrl`/`Cmd` + `/`, opens the help menu.

| Shortcut             | Action                                     |
| -------------------- | ------------------------------------------ |
| Ctrl/Cmd + K         | Search notes (insert a link while writing) |
| Ctrl/Cmd + Alt + N   | New note in the current notebook           |
| Ctrl/Cmd + E         | Toggle edit / preview                      |
| Ctrl/Cmd + S         | Save now                                   |
| Ctrl/Cmd + Shift + F | Toggle focus mode                          |
| Ctrl/Cmd + comma     | Settings                                   |
| Up / Down            | Move between focused note rows or commands |
| Left / Right         | Previous / next note in the drawer         |
| Delete / Backspace   | Ask to delete the focused or open note     |

Arrow and Delete keys keep their normal behavior inside text fields and editors.
Deleting always requires confirmation. Drag handles retain their own Space/arrow
controls. Long notes scroll within the workspace while the mode switch stays visible.

## Export and delete notes

**Export** opens three choices: **Markdown (.md)**, **PDF (.pdf)** and
**Copy Markdown**. It uses the text you are reading or editing, including new and
unsaved drafts, without requiring a save. The chooser identifies unsaved changes.
From a row, Export uses a retained draft or fetches the latest saved note.
Files contain the note body; their names follow its current title.

Markdown and Copy preserve source text and Unicode. PDF produces searchable,
paginated text with links, headings, lists, code and tables. Images become labelled
links; raw HTML is omitted. It loads locally only when requested, without sending
your writing to a conversion service. Unsupported font characters appear as explicit
Unicode codes; Markdown retains the originals. Very wide tables become labelled records.
The PDF uses a quiet monochrome layout, real checkboxes, embedded monospace code,
and section bookmarks. Ordinary table rows stay together; six-to-eight-column
tables use landscape sheets while the rest of the note stays portrait. Page
numbers appear only on multi-page notes.
If an automatic PDF download does not start, use **Download PDF** in the chooser.
Closing it cancels preparation. Clipboard denial leaves selectable source text.

Drafts longer than 6,000 characters stay available for export; shorten them to save.
PDF supports up to 100,000 characters. **Settings → Your data → Export all account
data** is the separate backup containing notes, revisions and conversations.

**Delete note…** is also available under a row's Actions button, without opening
the note. Confirmation names the note and permanently removes its history. Cancel
keeps your draft. If you have unsaved edits, the confirmation explicitly discards
them; it pauses autosave and waits for an active save. An uncertain save must be
resolved with **Retry pending save** first. Concurrent edits require review rather
than deletion against an unseen version. Successful deletion has no Undo.

## Daily writing and personal details

**Today’s note** starts with today's date in your current notebook. It is an ordinary
note, available in the same library, search and Ask Grove. Choose **Date written**
under Sort to group all matching notes by day. Existing Journal links open this
dated view. There is no separate journal to manage.

Notebook pages open directly to their notes. **Notebook options** offers **Ask about
these notes**, **Summarize notebook** and **Progress notes**, alongside rename,
move and sub-notebook creation. Progress notes record where work stands; their
agent references survive edits and moves.

**Settings → Account → About you** offers prompts for preferences and things you
want Grove to know.

## History and how long notes stay

Ordinary notes stay until you remove them. Under **Note options**, any kind of note
can instead be kept for 1–365 days. Progress notes default to 30 days. Editing or
moving preserves the expiry date; changing the duration starts it again. Expired
notes leave search and recall, and remain restorable for 60 more days before deletion.
Restoring renews their duration. Archive is available in the footer.

**History** keeps readable versions, side-by-side comparison, and **Restore as a new
revision**. A concurrent edit preserves your draft and presents the newer saved
version for review. Replacing or restoring always creates another version.

## Linked notes and Ask Grove

Choose **Graph** within Notes to explore recorded related, duplicate, or conflicting
ideas. It uses the loaded, current notes in the selected scope. Load earlier pages
to expand it. Drag to pan, or hold Ctrl/Cmd while scrolling to zoom; ordinary wheel
input scrolls the page. On touch screens, tap notes in the embedded graph and use
**Expand graph** for one-finger pan and pinch zoom. Expansion also works without
browser fullscreen. Zoom and the central view stay stable when selecting, reading,
editing or resizing; **Fit View** deliberately brings all loaded nodes into view.
Space selects a focused node; Enter reads it. Escape clears a focused selection or
leaves expanded exploration.
**Controls** reveals pointer, touch and keyboard guidance when needed. **Done**
returns from expanded exploration. Connection legends describe the visible edges;
empty-state guidance stays below the canvas.

Select a row in **Linked notes** or an edge in the graph for a compact explanation.
Expand **Supporting notes** for current excerpts. **Compare notes** opens both
originals read-only; **Dismiss suggestion** and version-checked **Undo dismissal**
review the connection from either endpoint. Automatic note comparisons stay within
their notebook or Unfiled.

**Notebook options → Connected notebooks** and **Graph → Notebooks** explain how
collections relate. Partial coverage is flagged in the summary; supporting notes
include source links and explicit **X of Y notes** coverage. A limited shared thread
is distinguished from broad shared context.
Sub-notebooks are assessed separately. See [connections](relationships.md) for
evidence, processing, API and migration details.

**Ask Grove** finds, explains and helps change your notes. Follow-ups such as
“shorten that note” use the conversation's context. Choose all notes, Unfiled, or
a notebook; optionally include unfiled notes. **Search** finds pages as you type.
Source links open the cited note and identify when it has since changed.

Use **History** to reopen or delete saved conversations across visits. Changing the
scope starts a new conversation. Stop cancels the current reply; interrupted replies
can be retried. Explicit edit, create and merge requests show a preview with **Apply**
and version-checked **Undo**. Merges archive the originals and keep earlier revisions.
If a note changes after the preview, ask for an updated preview before applying it.

The message box grows with your writing. The formatting toggle reveals Markdown tools and a
preview; switching modes keeps your text and selection. Plain text uses Enter to send
and Shift+Enter for a new line. Markdown uses Enter for new lines and Ctrl/Cmd+Enter
to send. The send button works in either mode, including touch keyboards.
Replies follow the conversation only while you are near its latest message. Scroll
up to keep reading older messages, even as a reply arrives or the composer grows.
**Latest reply** returns to the bottom and resumes following. Sending a new question
also resumes following.

**Settings** groups Preferences, Account, Connections, AI & search and
Your data under a persistent heading and navigation. Section content scrolls
independently, keeping navigation in place. AI preference drafts survive visits to
other settings tabs; **Discard changes** restores saved choices. Save submits only
changed controls and retains edits made while saving. A dot marks unsaved
preferences, and clean forms follow changes saved in another tab. **AI & search**
shows service availability separately from your feature preferences. Export includes
notes, revisions, conversations and relationship review state. Self-hosted administrators retain provider
configuration at [Model settings](models.md).

The interface uses self-hosted Space Grotesk and the [Sprout palette](design/grove-sprout.md).
Browser checks cover narrow layouts, keyboard and native touch interaction, graph,
cited chat, dated writing, history, concurrent edits, cancellation, and accessibility.
