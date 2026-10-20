# Your Grove notebook

Grove is a place for notes, ideas, and everyday writing. **Notes**, **Journal**,
**Ask Grove**, **Notebooks**, and **About me** are the main destinations. Connected
agents use the same notes and permissions; their references live in **Agent details**.

## Write, find, and organize

- **New note**, **New entry**, and a note page's **Edit note** open a full-page
  writing space. **Write** styles Markdown as you work; **Markdown** shows its
  source and **Preview** shows the reading view. Use the shared formatting toolbar,
  undo/redo, heading outline, and focus mode (Escape exits focus).
- Save with **Save note** or `Ctrl`/`Cmd` + `S`; the editor stays open and reports
  saved/unsaved state. Formatting supports `Ctrl`/`Cmd` + `B`, `I`, and `K`.
  Drawer editors can expand without losing their selection or undo history.
- Full-page drafts stay in account-scoped memory while navigating Grove, including
  their original revision and retry ID. They are not autosaved or stored on disk;
  reload/close prompts while drafts remain. Saving still checks concurrent changes.
  Reopening a draft during a save follows the same request rather than creating
  another note.
  **Read note and history** opens the reader and earlier revisions.
- Press `/` to search. Results update after a short pause as you type. Combine
  notebook, note type, topic, source, updated date, and retention filters. Queries
  stay in POST bodies. Sorting and filtering apply to the entire matching library.
- Create a notebook with just a name. Use **+** beside a notebook to create a
  sub-notebook; expand/collapse the tree in the sidebar or Notebooks. Search retains
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
  a long press on the handle starts dragging.
- **Undo** checks the version produced by the original action. It never overwrites
  someone else's later edit. Partial failures identify the affected notes.

Dropdowns share keyboard, touch and focus behavior across filters, notebook choices,
note properties and model settings. Use arrows, Home/End or typeahead, Enter to
choose, and Escape to dismiss; inside a dialog, the first Escape closes the menu.

## Journal and personal notes

**Journal** groups personal notes written on the website by their creation date.
**New entry** starts with today's date. Entries remain ordinary editable notes,
available in search and Ask Grove. **About me** offers prompts for preferences and
things you want Grove to know.

Notebook pages open to Notes, with Summary, In progress, and Ask Grove views.
Progress notes record where work stands. Agent task references are created
automatically and preserved when a note is edited or moved.

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

**Ask Grove** answers from your notes with exact-version source links. Choose all
notes, Personal, or a notebook; optionally include personal notes. **Search** finds
source pages automatically as you type. Conversation stays in tab memory. Questions
do not create notes. Stop or start a new conversation to cancel an answer. Changes
to permissions, sources, settings, or model profiles during generation discard the
answer. Opening a citation identifies when its note has since changed.

Cloud settings explain semantic search, organization, and cited summaries.
Self-hosted administrators retain configurable providers and diagnostics in
[Model settings](models.md). Periodic organization repairs missing derived data
without moving, merging, or rewriting notes.

The interface uses self-hosted Inter and the [Sprout palette](design/grove-sprout.md).
Browser checks cover narrow layouts, keyboard and native touch interaction, graph,
cited chat, journal, history, concurrent edits, cancellation, and accessibility.
