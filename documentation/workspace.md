# Your Grove notebook

Start in **Notes** to write and browse, or **Ask Grove** to work with your notes.
The sidebar puts **Notes** and **Ask Grove** first, then **Notebooks** (Unfiled
and your notebook tree), with **Settings** last. On phones, open **Notebooks**
beneath Notes and Ask Grove. The Grove logo returns to Notes. Connected agents
share these notes and their approved permissions; technical references stay in
**Note properties → Agent details**.

In **Settings → Connections**, each connection shows its last recorded use in your local time. This is authenticated client activity, not necessarily a note edit. **Hide** only tidies this browser’s list. **Revoke** names the connection and asks you to confirm before stopping access. A revoked API key cannot be used again. In the access dialog, **Approve access** saves the checked permissions. **Approve all scopes** grants every note permission for personal notes and all current and future notebooks, plus writing and sharing for OAuth clients.

Workspace search and the **Search** view in Ask Grove keep your query when you cancel a slow lookup. Choose **Search again** to retry it, or edit the query to start another. [See the search and connection previews](design/screenshots/connections-search/README.md).

## Your first saved note

You only need a Grove account and a browser. No CLI, agent plugin or personal
model-provider key is needed for the Cloud notebook.

1. [Create an account](https://grovenote.app/sign-up), then open **Notes**.
2. Choose **New note**, or **Write your first note** if the library is empty.
   You can file it in a notebook later.
3. Write a short title and something you will want to find,
   such as a packing list. Save the note and wait for the saved confirmation.
4. Return to Notes and reopen your note. Seeing the saved text
   there verifies the browser workflow; typing alone does not establish a save.
5. Open **Ask Grove**, choose **Sources**, select that note and choose **Done**.
   Ask a specific question about its text, then open the answer's citation to
   compare it with your original note.

Start with non-sensitive sample text while trying a feature. Keep an unsaved or
failed draft open: reloading is not a recovery step. The sections below explain
editing, search, sharing and recovery. [Connect an AI tool](https://grovenote.app/install)
only if you want to use the notebook outside the browser; that separate guide
owns connection commands and approval.

## Write, find, and organize

- **New note**, **Today’s note** and existing notes use the same workspace.
  Find **Today’s note** under **More** in Notes or **Notebook options** in a
  specific notebook.
  **Edit note** / **Preview** switch in place, preserving cursor, Undo and reading
  position. **Write** styles Markdown; **Markdown** exposes source. Formatting,
  outline and focus mode remain available while writing.
- Autosave starts after a 450ms typing pause; viewer checklist changes start saving
  immediately. **Save note** or Ctrl/Cmd+S saves now. First-save routing retains
  the editor, focus, scroll and Undo. Another New note starts a separate document.
- [Spelling and basic grammar](webapp-writing.md) are checked on your device as
  you write, with the same engine as the browser extension and no double
  underlines when both are present. Open an underline or press **Alt+Enter**;
  one click applies a replacement with normal Undo.
  Existing notes send precise source edits, preserving unedited passages. Revision
  history groups nearby small autosaves from one editing session instead of listing
  each keystroke save. Large/structural changes and explicit Save stay separate.
  Comparisons show highlighted additions/removals; **Full versions** expands both
  complete documents. See [structured notes](structured-documents.md).
- Drafts/retry identities stay in account/session-owned memory by default. Optional
  **Settings → Account → Recover drafts on this device** keeps encrypted checkpoints
  for this account/browser, up to 32 drafts/1 MiB for seven days. Read its privacy
  explanation before enabling. Recovery needs current online authorization and
  explicit retry; a device checkpoint is not Saved. Sign-out, account changes and
  disabling recovery erase it. Unsupported storage leaves text in memory: keep the
  tab open and export/copy it. See [device recovery](development/client-cache.md#device-draft-recovery).
  Saves retain newer typing and require review of concurrent edits. Opening a draft
  during its save follows that request, not a duplicate create. Transient session
  recovery keeps drafts mounted; terminal denial clears private state.
- Search with Ctrl/Cmd+K; `/` opens library filtering. **Filters** groups notebook,
  kind, topic, source, date, lifetime and sorting. They apply to the entire matching
  library, not just loaded rows. Queries remain in POST bodies. See
  [search](search.md) for relevance, typo/prefix matching and partial evidence.
- Scroll to the end of Notes, Archive, a notebook’s list, or the notes in an
  expanded sidebar notebook to load the next page. **Load more notes** is also
  available to screen readers and appears on keyboard focus. If your browser
  can’t load on scroll, the button stays visible. Loaded rows stay in place;
  if a page adds no new notes, use **Continue loading notes**. A repeated page
  cursor offers **Refresh notes** instead. Retry a failed load at the end of the
  list, or use **Refresh search results** to restart a changed search with the
  same filters.
  Graph expansion remains manual.
- **New note** follows your current notebook; notes without one are **Unfiled**.
  Sidebar expansion, notebook collapse, list scroll and outline pinning can be
  remembered per account
  in this browser without storing note text, names, queries or drafts.
- Create with the sidebar **+**; **Manage notebooks** browses the catalog. Use
  **Organize** for sibling order and **Move notebook** for a searchable destination
  and explicit placement. Notebook grips drag with mouse/pen or a deliberate touch
  hold; tapping or clicking a grip opens Organize for exact placement. The
  [organization guide](notebook-organization.md) owns full move/retry/Undo behavior
  and device qualification limits. Parent access never grants child access.
- Select up to 50 loaded notes for batch move/archive/restore/**Delete**.
  Confirmations apply instantly: rows move the moment you confirm while the
  request settles in the background, and only that note's controls lock during
  its own request. A row with a request in flight dims without moving the list.
  If a request fails, that note alone snaps back and the failure is reported;
  every other row keeps its new state. Note handles support
  mouse/pen, keyboard Space/arrows/Escape and deliberate touch drag; horizontal
  swipe reveals ordinary note actions while vertical input scrolls. Notebook grips
  share the same hold-to-lift gesture. Partial failures identify notes;
  Undo never overwrites a later edit.

Full-page phone notes use **Back to notes** instead of the sidebar. **Note actions**
keeps compact secondary tools together. Menus/dialogs dismiss on outside press,
not a drag crossing their edge; library confirmations apply instantly while the
request settles in the background (failures roll back and are reported), while
autosave retains its draft/request when you navigate away.

## Archive and delete notebooks

Notebook options and manager actions offer whole-subtree Archive/Delete. Review
descendant/note counts and resolve local drafts before confirmation. **Manage
notebooks → Archived** offers Restore/Delete; restore the parent first. The
archived list also supports multi-select bulk Restore/Delete (up to 50):
previews load per notebook, descendants covered by another selected root are
handled once, and each notebook commits on its own so one failure rolls back
only that notebook. Independently
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

Choose **Note actions → Share note** or **Notebook options → Share notebook** to
create a live read-only link. Anyone with the URL can read the shared content.
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

Open **Note actions** beside the save control for **Revision history**, **Share
note**, **Export**, and **Delete note**. The same menu works on desktop and phone.
**Export** offers Markdown, PDF and Copy Markdown using the current reading/editing
text, including unsaved drafts. Row export uses a retained draft or latest saved
content. Oversized drafts remain exportable even when they cannot be saved.
PDF is local/on-demand, searchable and paginated, with code/tables/links; unsupported
characters get explicit Unicode fallbacks. Authorized owned raster images can be
embedded; external images stay links. Audio is a textual reference, not embedded
playback. [Media exports](media.md#exports-and-recovery) own image limits, portable
original-byte TARs and media-complete account exports.

To see archived notes and notebooks, choose **Notes → More → Archive**. Use
**Back to notes** to return to the active library.

**Settings → Your data** prepares a background account export; notebook export can
include descendants. Progress/retry/cancel/download survive navigation; see
[jobs](jobs.md#exports-and-storage) for format, expiry and source-change fencing.

**Delete note…** confirms by name, hides the note/history and has no ordinary Undo.
Select several notes to delete them with one confirmation (up to 50); the rows
leave instantly and any note whose version changed snaps back with a report.
It can discard a dirty draft, but waits for a running save and requires resolving
an uncertain save first. A concurrent edit requires review, never unseen deletion.

## Daily writing and personal details

**Today’s note** uses the regular note editor. To group notes by creation day,
choose the creation-date order in **Filters**. See [note sorting](search.md).
**Progress notes** are handoffs whose references survive editing/moving. **Settings →
Account → About you** records preferences and things you want Grove to know.

### Returning to a daily note

**Today’s note** opens one ordinary note per account and local calendar date,
regardless of the notebook you open it from. Nothing is created until the first
save, which uses the selected notebook by default. Older notes with similar
titles aren’t linked automatically. Editing or moving the note leaves its daily
identity intact; an archived note opens in its archived view, and deleting it
does not free the date for a replacement. A draft stays on the date it was opened
for, even past midnight; open **Today’s note** again for the new day. Devices in
different time zones can show different dates at the same instant.

If the first save is interrupted, returning to the date in the same workspace
session resumes the draft and retries the original save. If another device saved
first, the local draft stays available through navigation and background refresh.
Copy any text you want to keep before choosing **Discard draft and open saved note**.

The legacy `/app/journal` URL opens Notes sorted by creation date.

Self-hosted rollout requires the `20261117_042_daily_notes` migration before
the updated app. API and worker startup and API readiness check that the daily
note bindings are readable. `tests/src/daily-note-migration.test.ts` checks both
service roles before and after migration. `tests/src/daily-note.test.ts` exercises isolation, first-save
races and lifecycle against disposable PostgreSQL; `daily-note.spec.ts` covers
workspace entry and midnight behavior with synthetic browser fixtures.

## History and how long notes stay

Ordinary notes stay until removed. Any kind can use a 1–365-day lifetime; progress
notes default to 30 days. Ordinary editing/moving preserves expiry; changing lifetime
restarts it. Expired notes leave recall/search and remain restorable for 60 days
before soft deletion. Restore renews the duration. Archive is available from navigation.
**History → Restore as a new revision** preserves prior versions and checks concurrent
edits. [API contracts](server.md#memory-and-notebook-tools) define exact semantics.

## Linked notes and Ask Grove

Use **List / Graph** beside **More** in Notes, or beside the note count in an
open notebook. Switching views keeps your notebook scope, filters and loaded
notes. The direct `/app/graph` link opens with Graph selected.

The graph explores loaded current notes/notebooks; load earlier pages for broader
coverage. Ordinary wheel input scrolls the page; Ctrl/Cmd+wheel zooms. Touch users
expand for pan/pinch; keyboard users can focus/select/read nodes and return focus.
Linked-note explanations cite current excerpts; see [relationships](relationships.md).

**Ask Grove** has cited saved-note answers, optional web tools and explicit reviewed
note changes. [Ask tools](ask-tools.md) owns tools/history/composer behavior;
[selected sources](explicit-context.md) owns Sources/@mentions and strict scope;
[document imports](imports.md) owns attachments/full-text review. Uploading or asking
does not implicitly create a library note. Drafts remain private session memory.

**Settings** keeps section links visible while the selected page scrolls. On narrow
screens the links wrap instead of scrolling sideways. Writing checks apply immediately
on this device. Account preference drafts survive section changes; Save submits changed
controls and retains newer typing, and Discard restores saved values. Availability is
separate from preferences and provider health. See
[models](models.md), [billing](billing.md) and [files/storage](files-storage.md).
Original images/audio, [manual transcripts](recordings.md) and editing remain usable
without inference; [speech](speech.md) requires separate explicit actions.

## When something does not work

- **A note has not saved:** keep the editor open, read its save feedback and retry
  the failed save. Copy or export the draft before closing the page if you need a
  separate recovery copy. Do not assume a refresh will restore unsaved text.
- **Search does not find a note:** check notebook and filter scope, then look for
  the note directly. Archived or expired notes are not ordinary active results.
- **Ask misses a detail:** use the Sources chooser and inspect the provided
  evidence. Follow the [source-selection guide](explicit-context.md); a reply is
  not proof that every note was considered.
- **An AI action is unavailable:** check the account's AI preference and displayed
  allowance. Provider availability is separate from the switch being enabled;
  saved writing remains usable without inference.
- **A connected tool is missing:** use the [client diagnosis](client.md#diagnose-installation-and-startup)
  rather than reinstalling the notebook or deleting credentials.

For help, include the page, action, approximate time and redacted error in a
[support request](https://grovenote.app/support). Do not include note contents,
private sharing links, API keys or sign-in tokens unless you deliberately choose
to share a safe reproduction.
