# Files & storage

Open **Settings → Files & storage** to browse your uploaded documents, note images
and original recordings. The same view is linked from Ask Grove's attachment area,
Import notes, note actions and notebook actions. Context links filter to that note,
chat or the notes directly in that notebook; **All uploads** clears the context.
Sub-notebooks are not implicitly included.

Search by filename or filter documents, images and recordings. Each row shows its
size, upload state and number of accessible locations. Expand it for note and
notebook links, chat links and authorized original downloads. Locations and files
page independently in batches of30. Earlier-version media is labelled explicitly;
original filenames were not stored for images/recordings, so those have generated
names. Unconfirmed imports have no saved notebook yet. Uploads in Ask create no
notes unless you explicitly save them.

## Storage numbers

- **Retained upload budget** is the existing account safety counter: up to1GiB and
  1,000 write attempts across documents, images and original WAV recordings.
  It includes uncertain/retried writes and privately retained sources, even when
  the app can no longer open them. It is not a measured physical-object invoice.
- **Temporary staging** counts actual staged document bytes in both import and
  chat flows, under the shared75MiB ceiling. Unaccepted uploads expire after24h;
  their bytes count until cleanup actually releases them.
- **Accessible uploads** counts currently visible source records, including drafts
  and failed/pending media reservations; the secondary byte figure includes only
  originals with an authorized download. Full-text chat conversion reuses and
  displays the same accepted original once, merging its saved-note locations.

Removing a chat attachment or deleting notes/chats revokes that access path; it
does **not** delete retained originals or refund retained budget. A separately
saved source can remain available through its note. Deleted/expired notes and
deleted chats are never reopened by this view. It is read-only: no permanent
deletion, bulk detach, reparenting or sharing changes. Read-aloud audio and export
archives are separate temporary data, not uploaded files.

The view refreshes on entry, periodically while visible, and on **Refresh files**.
Downloads reauthorize against the original route at request time. Account/session
switches discard the private workspace cache; data is not persisted in the browser.

## API and privacy

Owning website session only (agents, API keys and public-share visitors cannot use
these routes):

| Route                      | Result                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /v1/files/storage`    | Conservative account budget, actual staging bytes, accessible-original bytes and visible file count              |
| `POST /v1/files/search`    | `{ query?, kind?, memoryId?, projectId?, conversationId?, after? }`; at most30 metadata rows and `nextCursor`    |
| `POST /v1/files/locations` | `{ source: 'chat' \| 'import' \| 'media', id, after? }`; at most30 current authorized locations and `nextCursor` |

Cursors bind the account, filters/source and keyset position with a signature.
The read projection uses existing tenant RLS, source and note visibility; no schema
or storage-policy migration is added. Object keys, hashes, raw staged bytes,
document quotations, unrelated chat content and foreign metadata are not returned.
Existing original readers remain the only content-download path. See
[documents](imports.md), [media](media.md) and [delivery evidence](delivery.md).
