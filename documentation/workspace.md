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
   **Linked notes** is a collapsed accordion below your writing. **Note actions**
   holds Copy Markdown, Move, Archive and Delete. Action confirmations appear as
   toasts without moving the page; autosave status stays in the toolbar.
   On phones, **Note actions** also holds History, properties, focus mode and
   previous/next note controls. The compact header keeps Back, Save and the note's
   save state visible while reading or writing.
- Press `Ctrl`/`Cmd` + `K` to search across your Grove, or `/` to filter the library.
  Results update after a short pause as you type. Combine
  notebook, note type, topic, source, updated date, and retention filters. Queries
  stay in POST bodies. Sorting and filtering apply to the entire matching library.
- Create a notebook with the sidebar **+** and just a name. **Manage** opens all
  notebook settings. Each notebook's action menu includes **New sub-notebook**;
  expand/collapse the tree in the sidebar to see notebooks and recent pages. Search retains
  matching notebooks' ancestors so you can see where they belong.
- **Rename** and **Move** share notebook settings. Choose a **Parent notebook**
  or **Top level** to reorganize it; sub-notebooks move with their parent. Breadcrumbs
  and notebook dropdowns show the full path. A notebook cannot move into itself or
  its descendants. Concurrent changes require reopening settings to review them.
- Each notebook keeps its own access scope: parent access does not include children.
  Notes/search/Ask Grove stay scoped to the chosen notebook. Moving a notebook
  preserves its notes, revisions, retention, and stable agent/repository references.
- Select up to 50 loaded notes to move, archive, or restore. Drag a handle into a
  notebook, or press Space, choose a destination with the arrows, and press Space
   again. Escape cancels. On touch screens, a horizontal swipe reveals ordinary
   action buttons for one note at a time; vertical gestures scroll. A long press
   on the handle starts dragging and reveals a scrollable list of destinations.
   Hold near the list's edge to scroll, or release over **Drop here to cancel**.
   Pens start from the same handles. Interrupted gestures do not move a note.
  Notebook handles also support drag or keyboard nesting; hover over a collapsed
  destination to expand it. Focus mode fills the viewport and hides secondary tools.
- **Undo** checks the version produced by the original action. It never overwrites
   someone else's later edit. Partial failures identify the affected notes.
   Move and bulk-action Undo stays available in the shared notification stack
   alongside later copy feedback, including inside an open dialog.

Dropdowns share keyboard, touch and focus behavior across filters, notebook choices,
note properties and settings. Use arrows, Home/End or typeahead, Enter to
choose, and Escape to dismiss; inside a dialog, the first Escape closes the menu.
An outside tap or click dismisses a dialog or drawer; scrolling or dragging across
its edge does not. Action menus follow their opener when scrolling/resizing and
scroll internally in short viewports. Confirmed mutations finish before
closing; background autosave retains its request and draft when you navigate away.

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

**Settings** groups Preferences, Account, Connections, Search & organization and
Your data under a persistent heading and navigation. Section content scrolls
independently, keeping navigation in place. Export includes
notes, revisions and conversations. Self-hosted administrators retain provider
configuration at [Model settings](models.md).

The interface uses self-hosted Space Grotesk and the [Sprout palette](design/grove-sprout.md).
Browser checks cover narrow layouts, keyboard and native touch interaction, graph,
cited chat, dated writing, history, concurrent edits, cancellation, and accessibility.
