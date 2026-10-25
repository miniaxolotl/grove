# Hosted-chat reviewer evidence

Recorded 24–25 October 2026 against production Grove **1.11.3**, using only a
dedicated account with labelled synthetic fixtures. This evidence does not claim
directory approval or publication.

## ChatGPT

[Watch the three-minute walkthrough](chatgpt-walkthrough.webm).

The recording contains excerpts of real executed browser tests, with idle waiting
trimmed. No tool results, messages or account data were manufactured. The test-only
personal connector uses the same production MCP endpoint and ordinary OAuth; it
is separate from the single official directory submission. Reviewer credentials
are provided privately in the portal, never in this recording or repository.

1. Explicitly save a synthetic Personal preference: actual ID
   `aba52c33-0dc7-4d83-9388-0a28ff9707ea`, version 1, indexing ready on readback.
2. In a fresh conversation, recall and read that same note without mutation.
3. Find its exact ID and current version through `memories`.
4. Correct only that note through `update_memory` with expected version 1,
   retaining metadata and its synthetic warning; verify version 2.
5. Refuse ungranted cross-account access, self-approval/admin-key issuance and
   blanket background transcript capture. These are three separately answered
   scenarios in one host turn; no content was accessed or changed for them.
6. Soft-delete only that exact synthetic note at expected version 2; verify
   subsequent `get_memory` returns `not_found`. Retained history is hidden, not
   physically erased, and previously displayed copies are not retracted.

Before approval, an actual host `recall` returned `connection_required` and no
note content. Grove approval was performed separately by the synthetic account
owner. A website readback independently confirmed the initial saved note.

## Claude

An actual preapproval `recall` likewise returned `connection_required`, with the
correct OAuth client and approval link. After separate owner approval, Claude
recalled and read the same ChatGPT-created/corrected note at version 2. Further
synthetic write/history and permission checks are recorded separately as completed.

## Boundaries

OAuth sign-in and identity-email consent grant no note access. The reviewed
dynamic-client policy permits requesting identity `email` with fresh consent;
default scopes remain `openid offline_access`. PKCE, opaque tokens, exact audience
and owner-controlled note grants remain enforced. No real private notes, raw chat
transcript import, billing activation, new migration or application rollout is
part of this evidence update.

The directory scanners still report advisory metadata findings: Claude requests
`annotations.title` in addition to top-level titles; OpenAI flags the owner-only
`notebook_lifecycle` operation selector. That tool remains denied to agent OAuth.
These findings are disclosed for review, not bypassed by widening authorization.
