# Your Grove notebook

Grove is a place for notes, ideas, and everyday writing. **Notes**, **Journal**,
**Ask Grove**, **Notebooks**, and **About me** are the main destinations. Connected
agents use the same notes and permissions; their references live in **Agent details**.

## Write, find, and organize

- Open a note to read it in a drawer or on its own page. **Edit note** supports
  Markdown, formatting buttons, `Ctrl`/`Cmd` + `B` / `I`, undo/redo, and preview.
- Press `/` to search. Results update after a short pause as you type. Combine
  notebook, note type, topic, source, updated date, and retention filters. Queries
  stay in POST bodies. Sorting and filtering apply to the entire matching library.
- Create a notebook with just a name. Its optional repository identity connects
  it to an agent's project. Renaming preserves that reference.
- Select up to 50 loaded notes to move, archive, or restore. Drag a handle into a
  notebook, or press Space, choose a destination with the arrows, and press Space
  again. Escape cancels. On touch screens, a swipe reveals ordinary action buttons;
  a long press on the handle starts dragging.
- **Undo** checks the version produced by the original action. It never overwrites
  someone else's later edit. Partial failures identify the affected notes.

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
