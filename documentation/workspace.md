# Your Grove notebook

Start in **Notes** to write and browse, or **Ask Grove** to work with your notes.
Notebooks live in the sidebar; on phones, open **Notebooks** beneath navigation.
The Grove logo returns to Notes. Connected agents share these notes and their
approved permissions; technical references stay in **Note properties → Agent details**.

## Write, find, and organize

- **New note**, **Today’s note** and existing notes use the same workspace.
  **Edit note** / **Preview** switch in place, preserving cursor, Undo and reading
  position. **Write** styles Markdown; **Markdown** exposes source. Formatting,
  outline and focus mode remain available while writing.
- Autosave starts after a 450ms typing pause; viewer checklist changes start saving
  immediately. **Save note** or Ctrl/Cmd+S saves now. First-save routing retains
  the editor, focus, scroll and Undo. Another New note starts a separate document.
- Drafts/retry identities stay in account/session-owned memory during navigation,
  not on disk. Saves retain newer typing and require review of concurrent edits.
  Opening a draft during its save follows that request, not a duplicate create.
  Reload cannot restore it. Signing out, account/session replacement or terminal
  refreshed-session denial clears private drafts; transient recovery keeps them
  mounted with retry feedback. See [session recovery](development/client-cache.md#session-readiness-and-recovery).
- Search with Ctrl/Cmd+K; `/` opens library filtering. **Filters** groups notebook,
  kind, topic, source, date, lifetime and sorting. They apply to the entire matching
  library, not just loaded rows. Queries remain in POST bodies. See
  [search](search.md) for relevance, typo/prefix matching and partial evidence.
- **New note** follows your current notebook; notes without one are **Unfiled**.
  Sidebar expansion, list scroll and outline pinning can be remembered per account
  in this browser without storing note text, names, queries or drafts.
- Create with the sidebar **+**; **Manage notebooks** browses the catalog. Use
  **Organize** for sibling order and **Move notebook** for a searchable destination
  and explicit placement. Touch notebook folder controls open Organize rather than
  requiring long-press drag. Mouse and keyboard paths remain available. The
  [organization guide](notebook-organization.md) owns full move/retry/Undo behavior
  and device qualification limits. Parent access never grants child access.
- Select up to 50 loaded notes for batch move/archive/restore. Note handles support
  mouse/pen, keyboard Space/arrows/Escape and deliberate touch drag; horizontal
  swipe reveals ordinary note actions while vertical input scrolls. Notebook touch
  controls follow the separate Organize path above. Partial failures identify notes;
  Undo never overwrites a later edit.

Full-page phone notes use **Back to notes** instead of the sidebar. **Note actions**
keeps compact secondary tools together. Menus/dialogs dismiss on outside press,
not a drag crossing their edge; confirmations wait for mutations, while autosave
retains its draft/request when you navigate away.

## Archive and delete notebooks

Notebook options and manager actions offer whole-subtree Archive/Delete. Review
descendant/note counts and resolve local drafts before confirmation. **Manage
notebooks → Archived** offers Restore/Delete; restore the parent first. Independently
archived descendants remain archived. Deletion hides retained source/history and
has no in-app Undo. Direct revoked links never reactivate on restore. See
[lifecycle](notebook-lifecycle.md) for scope, concurrency and recovery.

## Notebook assistance

Use cited notebook summaries, filing suggestions, action-list previews, change
digests and cleanup review through [notebook assistance](notebook-assistance.md).
Each has independent AI preferences. Proposed changes need explicit review/Apply;
generation does not silently rewrite notes. [Connected notebooks and linked notes](relationships.md)
explain current evidence, partial coverage and retained Dismiss/Undo decisions.

## Share with a link

### Private section links

Copy a heading link from **Note outline** after saving. It grants no access or public
sharing. Links reopen that section in reading/writing, including reload/Back/Forward.
Heading names generate anchors; renaming/reordering duplicate headings may change
links. A missing section leaves the note usable without altering text.

### Public read-only links

**Share note/notebook** creates a live read-only capability for anyone with its URL.
Choose direct versus descendant scope and optional expiry; review before saving.
Unshared drafts/history/agent metadata are not published. Revoking one direct link
does not remove independently covering links. [Public sharing](sharing.md) owns
controls, permissions, expiry and privacy limits.

## Commands and keyboard shortcuts

Open **Commands** from sidebar utilities, compact Note actions, or Ctrl/Cmd+Shift+P.
Search, choose with arrows and Enter, Escape to return focus. Shortcut help is
Ctrl/Cmd+/. Text fields retain their normal editing behavior.

| Shortcut         | Action                                  |
| ---------------- | --------------------------------------- |
| Ctrl/Cmd+K       | Search notes; insert link while writing |
| Ctrl/Cmd+Alt+N   | New note in the current notebook        |
| Ctrl/Cmd+E       | Toggle edit/preview                     |
| Ctrl/Cmd+S       | Save now                                |
| Ctrl/Cmd+Shift+F | Toggle focus mode                       |
| Ctrl/Cmd+Alt+O   | Find/jump to heading                    |
| Ctrl/Cmd+comma   | Settings                                |
| Up/Down          | Navigate focused rows or commands       |
| Left/Right       | Previous/next note in the drawer        |
| Delete/Backspace | Confirm deletion of focused/open note   |

Outline pinning uses wide screens; phones/narrow drawers retain the dialog. Focus
mode hides secondary navigation without replacing the document or losing history.

## Export and delete notes

**Export** offers Markdown, PDF and Copy Markdown using the current reading/editing
text, including unsaved drafts. Row export uses a retained draft or latest saved
content. Oversized drafts remain exportable even when they cannot be saved.
PDF is local/on-demand, searchable and paginated, with code/tables/links; unsupported
characters get explicit Unicode fallbacks. Authorized owned raster images can be
embedded; external images stay links. Audio is a textual reference, not embedded
playback. [Media exports](media.md#exports-and-recovery) own image limits, portable
original-byte TARs and media-complete account exports.

**Settings → Your data** prepares a background account export; notebook export can
include descendants. Progress/retry/cancel/download survive navigation; see
[jobs](jobs.md#exports-and-storage) for format, expiry and source-change fencing.

**Delete note…** confirms by name, hides the note/history and has no ordinary Undo.
It can discard a dirty draft, but waits for a running save and requires resolving
an uncertain save first. A concurrent edit requires review, never unseen deletion.

## Daily writing and personal details

**Today’s note** is an ordinary dated note in the current notebook. **Filters →
Sort notes → Date written** groups notes by day; there is no separate journal store.
**Progress notes** are handoffs whose references survive editing/moving. **Settings →
Account → About you** records preferences and things you want Grove to know.

## History and how long notes stay

Ordinary notes stay until removed. Any kind can use a 1–365-day lifetime; progress
notes default to 30 days. Ordinary editing/moving preserves expiry; changing lifetime
restarts it. Expired notes leave recall/search and remain restorable for 60 days
before soft deletion. Restore renews the duration. Archive is available from navigation.
**History → Restore as a new revision** preserves prior versions and checks concurrent
edits. [API contracts](server.md#memory-and-notebook-tools) define exact semantics.

## Linked notes and Ask Grove

**Graph** explores loaded current notes/notebooks; load earlier pages for broader
coverage. Ordinary wheel input scrolls the page; Ctrl/Cmd+wheel zooms. Touch users
expand for pan/pinch; keyboard users can focus/select/read nodes and return focus.
Linked-note explanations cite current excerpts; see [relationships](relationships.md).

**Ask Grove** has cited saved-note answers, optional web tools and explicit reviewed
note changes. [Ask tools](ask-tools.md) owns tools/history/composer behavior;
[selected sources](explicit-context.md) owns Sources/@mentions and strict scope;
[document imports](imports.md) owns attachments/full-text review. Uploading or asking
does not implicitly create a library note. Drafts remain private session memory.

**Settings** keeps navigation while section content scrolls. Preference drafts survive
tab switches; Save submits changed controls and retains newer typing, Discard restores
saved values. Availability is separate from preferences and provider health. See
[models](models.md), [billing](billing.md) and [files/storage](files-storage.md).
Original images/audio, [manual transcripts](recordings.md) and editing remain usable
without inference; [speech](speech.md) requires separate explicit actions.
