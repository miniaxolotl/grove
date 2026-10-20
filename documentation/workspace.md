# Your Grove workspace

The dashboard is built around reading and managing your context. References and
processing metadata used by agents live under **Agent details**.

## Memories

- Open a memory to read it. Choose **Edit memory** to write Markdown, with
  formatting buttons, `Ctrl`/`Cmd` + `B` / `I`, undo/redo and a GFM preview.
  Headings, links, lists, checklists, tables and code are rendered in the reader.
- Press `/` to search by words or meaning. Combine project, kind and topic
  filters, and remove them individually. Topic text applies on submit; search
  text stays in request bodies rather than browser URLs.
- Select up to 50 loaded memories to move, archive or restore. Desktop users can
  drag the handle of a selected row onto a project or Personal. On touch screens,
  swipe horizontally to reveal actions; scrolling and cancellation never mutate
  a memory. Every action is also available with ordinary buttons and a keyboard.
- Move and lifecycle operations use the memory's current version. **Undo** checks
  the version produced by the original operation and refuses to overwrite a later
  change. Partial failures identify the affected memories; successful changes
  remain undoable. Restoring a handoff renews its active lifetime; undoing a restore
  archives it again, rather than reinstating an old expiry date.
- History, restoration as a new revision, permanent deletion and processing retry
  remain available in the reader. Save failures retain the draft and operation
  reference; in-flight saves keep the dialog open.

## Projects and handoffs

Create a project with a name. The optional repository identity connects it to
agents working in an existing repository; otherwise Grove generates a stable
workspace reference. Rename a project without changing that reference.

Each project has **Overview**, **Memories** and **Handoffs** views. Personal context
has the same views, scoped to personal memories. Pick handoffs by title or search
their content. A new handoff receives its task reference automatically; editing
or moving an existing handoff preserves its reference and source. Handoffs stay
in active recall for 30 days and are purged after 90 days.

Overviews cite source memories and their revisions. Refreshes report background
processing honestly and check for completion while the page is visible.

## Search and organization

Cloud settings explain the results of the three provider roles: semantic search,
automatic organization and source-linked summaries. Provider profiles and vector
dimensions are expandable technical details. Self-hosted administrators retain
the editable model configuration and diagnostics described in [models.md](models.md).

The interface uses self-hosted Inter for clear, professional headings and body
text, with the [Sprout palette](design/grove-sprout.md), neutral selection states
and no colored left-edge accents. Automated browser checks cover
version conflicts, partial failures, pagination cancellation, filtering, Markdown,
desktop drag/drop, native touch input, keyboard interaction and accessibility at
320px and desktop widths.
