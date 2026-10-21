# Your Grove notebook

Grove is a place for notes, ideas, and everyday writing. Start in **Notes** to write
and organize, or **Ask Grove** to talk about your notes. Notebooks live in the sidebar;
on a phone, tap **Notebooks** to browse them. Connected agents use the same notes and
permissions; their references live in **Agent details**.

## Write, find, and organize

- **New note**, **Today’s note**, and a note page's **Edit note** open the same full-page
  writing space. **Write** styles Markdown as you work; **Markdown** shows its
  source and **Preview** shows the reading view. Use the shared formatting toolbar,
  undo/redo, heading outline, and focus mode (Escape exits focus).
  **New note** follows the notebook you are browsing, filtering, or editing.
  Notes outside a notebook appear in **Unfiled**.
- Full-page notes save automatically after a short pause. **Save note** or
  `Ctrl`/`Cmd` + `S` saves immediately. Formatting supports `Ctrl`/`Cmd` + `B`, `I`, and `K`.
  Drawer editors can expand without losing their selection or undo history.
- Full-page drafts stay in account-scoped memory while navigating Grove, including
  their original revision and retry ID. Unsaved drafts are not stored on disk;
  reload/close prompts while drafts remain. Saving checks concurrent changes and
  preserves typing that happens during a request.
  Reopening a draft during a save follows the same request rather than creating
  another note.
  **Read note and history** opens the reader and earlier revisions.
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
  again. Escape cancels. On touch screens, a swipe reveals ordinary action buttons;
  a long press on the handle starts dragging and reveals notebook destinations.
  Notebook handles also support drag or keyboard nesting; hover over a collapsed
  destination to expand it. Focus mode fills the viewport and hides secondary tools.
- **Undo** checks the version produced by the original action. It never overwrites
  someone else's later edit. Partial failures identify the affected notes.

Dropdowns share keyboard, touch and focus behavior across filters, notebook choices,
note properties and settings. Use arrows, Home/End or typeahead, Enter to
choose, and Escape to dismiss; inside a dialog, the first Escape closes the menu.
Clicking outside a dialog or drawer dismisses it unless a change is being saved.

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
to expand it. Pan, zoom, select a note, or press Enter on a focused node to read it.

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

**Settings** groups Preferences, Account, Connections and Your data. Export includes
notes, revisions and conversations. Self-hosted administrators retain provider
configuration at [Model settings](models.md).

The interface uses self-hosted Space Grotesk and the [Sprout palette](design/grove-sprout.md).
Browser checks cover narrow layouts, keyboard and native touch interaction, graph,
cited chat, dated writing, history, concurrent edits, cancellation, and accessibility.
