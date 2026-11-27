# Extension writing coverage and feedback

**Proposal only.** Broaden the desktop extension's eligible writing fields, add a
right-edge field control and redesign the sidebar and correction menu. Nothing in
this document is implemented or authorizes deployment, new services or store
submission. The [extension guide](../browser-extension.md#english-writing-checks)
remains the current support contract.

## Goal

Write naturally in a message, comment, subject or rich-text composer; see whether
Grove is checking, how many issues it found and how to pause it without leaving
the field. Follow LanguageTool's familiar interaction pattern, with Grove's own
visual identity and local-first privacy. Do not promise universal editor support
or copy LanguageTool's trial restrictions into free local checking.

### References and existing gaps

The [supplied reference crops](screenshots/browser-extension/writing-reference/README.md)
show the desired right-aligned status/power grouping and a clear disable tooltip.
They are reference images, not Grove after-screenshots or proof of a particular
LanguageTool release.

LanguageTool's official [add-on guide](https://languagetool.org/insights/post/add-on/)
describes default-active checks, underlines and a numbered issue overview. Its
[rule guide](https://languagetool.org/insights/post/enabling-and-disabling-rules/)
distinguishes ignoring an issue in a text from disabling a rule everywhere.
These are interaction references, not evidence of every framework's compatibility.

At the reviewed source, Grove binds only multiline textareas. Its button appears
below the left edge only for findings or an error, and can disappear when space is
tight. There is no field-level pause. Shared eligibility also excludes subject/title
fields. The sidebar has Notes, Search and Settings; the correction card already
supports scoped replacement, Ignore, Add word and native Undo. Preserve these
safeguards rather than rebuilding an independent checker.

## Field coverage

Classify purpose from bounded static metadata **before reading any field value or
editable text**. Inspect type, autocomplete tokens, inputmode, role, editability,
author opt-outs, labels and bounded ancestor context. Never classify a field by
examining its contents or scanning the whole page. Do not log excluded values.
Clear negative signals override positive prose hints, including an explicit user
request to check a sensitive field.

| Surface                                                                             | Proposed support                                                                                                      | Boundary                                                                                                           |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Textareas                                                                           | Messages, comments, descriptions, feedback and other prose, including one-row/autogrowing composers                   | Rows and rendered height are not privacy classifiers.                                                              |
| `input[type=text]` and omitted text type                                            | Ordinary prose fields; known message, subject, article-title, caption and description purposes                        | Ambiguous text inputs stay unbound. Do not treat every title or name as prose.                                     |
| `contenteditable=true`, empty attribute, inherited editability and `plaintext-only` | Qualified visible prose editing roots, single- or multiline                                                           | Use actual editability; do not require ARIA attributes that real editors omit. Exclude nested noneditable content. |
| Editable ARIA textboxes                                                             | Only when backed by a supported input/textarea/editable DOM root                                                      | `role=textbox` alone does not make a widget safely editable.                                                       |
| Common rich editors                                                                 | Qualify ProseMirror/Tiptap, Lexical, Slate, Quill and CKEditor fixtures, plus representative email/chat/CMS composers | Support depends on exact text projection, replacement and native Undo, not framework-name detection alone.         |
| Open shadow roots                                                                   | Qualified focused editors discovered through composed focus paths                                                     | Observe only entered/authorized roots. Closed roots remain unsupported; no main-world prototype interception.      |
| Frame editors                                                                       | Separate checkpoint for ordinary authorized HTTP(S) child documents                                                   | Admit each frame's own origin/document identity; never inherit a parent's access or source identity.               |

**Always exclude:** passwords and credentials, usernames/login, email/phone/contact
identity, names, postal/street/billing/shipping addresses, payment/bank/tax or
government identifiers, verification/OTP codes, search/filter/query boxes, tags,
URLs, numeric/date/time controls, code/terminal editors, hidden/inert/disabled/
readonly controls, author-disabled spellchecking and Grove-owned UI. Respect
ancestor/inherited opt-outs and release the field immediately if its purpose changes.
Purpose matching must distinguish **Article title** from **Job title**, and **Message**
from **Email address**. `autocomplete=off` is not proof a field is safe; a placeholder
or long value is not sufficient positive evidence.

For unresolved ordinary text inputs, a user-invoked **Check this field** may establish
prose intent only after the metadata safety gates pass. Keep that choice local to
the current editor session. Do not offer this override for explicit exclusions or
an unsupported editor adapter.

No canvas/document-model editor (including Google Docs), closed-shadow editor,
browser-internal page, private window or ungranted origin is claimed supported.
Cross-origin HTTP(S) frames can be supported only with their own native host grant
and reviewed sender admission; sandboxed opaque-origin and special-scheme frames
remain out. A canvas integration needs a separate design, not DOM scraping.

## Field indicator

Use one stable two-part control for the focused eligible field: a **power toggle**
and a **status/count button**. Keep it visible while its popup/sidebar is in use.
Do not attach a collection of distracting badges to every field on the page.

- Single-line input: physical right edge, vertically centered.
- Textarea or multiline rich composer: physical bottom-right, inset from borders,
  scrollbars and resize grip. A single-line editable uses the input placement.
- Default visible label: **3 issues**, not a tiny unexplained dot. Count opens the
  anchored issue overview; **Open in sidebar** opens the same results in Writing.
  Power toggles that field in one click without opening settings.
  Hover and keyboard focus explain **Disable checking in this field** or **Enable
  checking in this field**. Screen-reader names include the scope and state.
- Keep the power control available for clean, empty, manual and paused eligible
  fields. A local field pause must not disable Notes, other fields or the extension.
- Use a high-contrast filled issue signal, distinct spelling/grammar underline
  patterns and readable count text. Do not depend on colour, hover or animation
  alone. No pulsing, trial warning or upsell in the indicator.

### Honest states and counts

| State                           | Visible status   | Interaction/detail                                                                       |
| ------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| Empty/not checked               | Check writing    | Start a bounded check; no fabricated zero.                                               |
| Automatic check pending/running | Checking…        | Keep the badge geometry stable; results belong to the current text only.                 |
| Complete with findings          | 3 issues         | Overview states **2 spelling · 1 grammar**; use singular when appropriate.               |
| Complete without findings       | No issues        | Means no findings from enabled checks, not guaranteed correct writing.                   |
| Partial with findings           | 3+ issues        | **Checked first 6,000 characters. More text is unchecked.** No whole-field total.        |
| Partial without findings        | Partly checked   | Show the same coverage explanation; never a clean success checkmark.                     |
| Field pause                     | Off here         | Power re-enables only this field, if stronger settings permit it.                        |
| Both check categories off       | Checks off       | Offer Writing settings; do not silently re-enable either category.                       |
| Manual mode after edits         | Check writing    | The old result is no longer current.                                                     |
| Check failure                   | Check failed     | **Writing check failed. Try again.** with a Retry action and optional detail.            |
| Partial service availability    | Local check only | Only if an already-enabled enhanced path failed; keep local findings and label coverage. |

Numbers come from the active field's latest valid, deduplicated, nonignored issues
after effective spelling/grammar/rule/dictionary settings. They are not counts of
replacement alternatives, underlined DOM nodes, other fields or unchecked text.
Edits immediately mark results out of date; old counts must not look current while
rechecking. A correction/ignore updates the same overview and badge. If a check or
UI result is capped, disclose that separately instead of printing an exact total.

Keep the existing 6,000 UTF-16-unit proofing budget; note capacity is unrelated.
The initial expansion does not silently check the rest of a long field. Explicit
coverage wording is required even when the count is zero.

### Placement and focus safety

The indicator must never cover typed text, caret, host send/reveal/clear controls,
scrollbars or resize handles. Place in proven clear trailing space; otherwise use
a right-aligned outside gutter immediately adjacent to the field, clamped to the
visible viewport. Do not change host value, padding, dimensions, scroll or layout
to manufacture room. If no safe gutter exists, collapse to accessible minimum-size
controls only when they fit safely; otherwise use the sidebar and Alt+Enter and
report the placement limitation there. Safety wins over drawing on a host action.

Reposition on nested scrolling, input horizontal scrolling, resize, zoom, viewport
changes and layout changes. Hide when clipped/occluded/offscreen, disconnected or
ineligible; never leave a floating orphan. Preserve the selection when moving to
the controls. Split buttons must be real `type=button` controls, not submit triggers
or nested buttons. Minimum 24px targets with separation; prefer 32px desktop and
44px where space/touch warrants it. Test RTL: physical right placement must still
respect the editor's direction, caret and native trailing controls.

### Toggle scope and precedence

Browser grants/restricted-page rules and author/sensitive exclusions win first;
Grove Off, browser-wide writing Off, domain exceptions and category/rule settings
remain authoritative. A field toggle never overrides them. Explain **Off on this
site** or **Writing checks are off** with the correctly scoped settings action;
do not display a working-looking enable switch that cannot take effect.

Field pause lasts for the current DOM editor session, including blur/refocus; page
reload ends it. Track it by local editor identity, not URL, typed text or a guessed
selector. A replacement node is a new field; a reused editor whose document identity
cannot be established must stay paused rather than be silently resumed. Global and
domain settings retain existing persistence and cross-panel propagation. Pausing
invalidates pending results and clears text snapshots/highlights; late results
cannot repopulate the field. Nothing is replayed on resume without a current check.

## Sidebar redesign

Proposed order: **Writing · Notes · Search · Settings**. Writing is a real destination
for reviewing the active field, not a settings link hub. This intentionally extends
the current three-tab layout: signed-out users can work with issues directly rather
than being sent to sign in. Local checks remain usable offline and without an account.
Keep an existing user's selected destination; open Writing only through an explicit
**Open in sidebar** action. If opening the native panel is refused, keep the in-page
overview working. Do not open both review surfaces on a count click.

Use Grove's existing system type, Sprout/wordmark, sage identity and light/dark
tokens, with neutral chrome and colour on actionable issues. No framework migration.

| Region                  | Layout and behavior                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Persistent header       | Grove identity and the one existing device-wide On/Off switch. Do not confuse it with **Off here**.                                                                                                          |
| Writing scope row       | **This field**, current site, English and a field-scoped pause control. Site identity is local display context, not new telemetry.                                                                           |
| Summary and controls    | Current status/coverage first, then **All**, **Spelling**, **Grammar** filters with actual counts. Filters precede results.                                                                                  |
| Results                 | One ordered issue list in source order. Each row shows type, short explanation, exact affected wording in bounded context and primary correction. Selecting it highlights/reveals the corresponding range.   |
| Issue detail            | Inline disclosure or the anchored card; replacement first, explanation next, Ignore/Add word/Rule options secondary. Return preserves filters, scroll and selection.                                         |
| Empty/unavailable state | Inside the result surface: **Choose a text field to check**, **No issues found**, **Off here**, or a specific unsupported/access state. No fake result list or full-panel spinner.                           |
| Notes                   | Editor leads; notebook/source stay collapsed together, Save and its reserved feedback stay near the editor. Preserve unsent drafts, source pinning, uncertain-save recovery and current autosave safeguards. |
| Search                  | Retain one debounced search, stable mounted results, pagination, reader and per-note menu. Do not proofread search input.                                                                                    |
| Settings                | Last destination. Group Writing, dictionary/rules, skipped sites, appearance, account/access and privacy. Keep useful controls here, not more onboarding.                                                    |

Keep one independently scrolling content region between stable header/navigation.
Use a 4px spacing base: 16px outer gutter at narrow widths, 12–16px section gaps,
8px related-control gaps; align labels, issue text and actions to shared edges.
Use 14px body text and 18–22px titles, wrapping important copy rather than shrinking
it. Avoid repeated nested boxes and oversized empty status regions. Reserve a
compact status lane so checking, failure and correction feedback do not move the
editor or issue controls. Check 280/320/390/768px panels, short 480px windows,
light/dark, forced colours and 200% zoom. These are desktop panel widths, not a
claim of mobile extension support.

Changing active tabs/documents must change scope explicitly and fence stale actions,
not silently apply an old correction to the newly focused field. Retain only bounded
current-session issue context. Never populate the sidebar by scanning every editor
or retain website drafts as a note without an explicit save.

## Correction/context menu redesign

The spelling/grammar menu is Grove's anchored in-page correction popup, not a
replacement for the browser's native right-click menu. Keep native Undo, paste,
spellchecking and existing Grove capture entries. Do not suppress right-click
globally or read an excluded field to populate a menu.

- Open on an underline or Alt+Enter; the count opens the all-issues overview.
- Header: **Spelling** or **Grammar**, issue position (**2 of 5**) and Close.
- Lead with **Replace with “…”** (or **Remove extra space**) as the primary action.
  Show affected wording and one plain explanation; optional longer help is disclosed.
- Keep alternatives readable as rows, not an undifferentiated wrap of buttons.
  Secondary actions: **Ignore this issue**; **Add to dictionary** for spelling;
  **Rule options** for a supported rule. Permanent actions name **everywhere** and
  reuse existing settings. Do not conflate one occurrence, this field and all sites.
- Keep Previous/Next and **All issues** in a stable footer. Counts and navigation
  follow the current filter/snapshot. Never offer Apply all without a separate design.
- Anchor beside the relevant range; flip/clamp around viewport and host controls.
  A review card must not cover the selected word or block the host's submit action.
- Escape/outside click closes; Escape returns to the invoking field/control without
  scrolling. Keyboard opening focuses a useful action, not always Close. Preserve
  selection, caret, host formatting, maxlength enforcement and native Undo/Redo.
- If safe replacement is unsupported, show **Copy correction** and explain that
  manual editing is needed. Do not partially mutate an editor or replace its HTML.
  Clipboard failure cannot be reported as success. Preserve current copy-on-apply
  behavior unless separately changed, without making an edit depend on clipboard access.

More visible and verbose means a named issue, a visible count/category and a useful
failure message, not raw exceptions, provider diagnostics or repeated toasts. Follow
[product copy](../development/product-copy.md). AI menus stay separate and explicit;
opening Writing or enabling checks never invokes a rewrite.

## Implementation architecture and safety gates

1. **Purpose classifier:** evolve `lib/shared/src/writing-settings.ts` and the DOM
   metadata reader in `packages/browser-extension/src/writing/editor.ts`. Return
   bounded eligibility/reason metadata for UI/tests without field text. Shared
   eligibility changes also need webapp regressions; do not broaden website-native
   behavior accidentally.
2. **Editor adapters:** replace the textarea-only assumptions in content/controller
   and audit `writing/tools-controller.ts`. Define eligibility, bounded plain-text
   snapshot/revision, selection mapping, range rectangles, guarded replacement,
   subscribe and teardown capabilities. An adapter can check without claiming safe
   replacement. Do not widen AI support implicitly with local adapter support.
3. **Rich-text projection:** map UTF-16 offsets to text nodes/DOM ranges, preserving
   paragraph/BR boundaries, Unicode, formatting and noneditable islands. Exclude code,
   hidden text, nested independent editors and quoted/non-authored regions where the
   adapter can establish them safely. Never use unrestricted `innerText`, serialize
   the whole page, assign `innerHTML` or dispatch fake events and call that native Undo.
   Framework-controlled editors require installed-browser round-trip evidence.
4. **One issue/status model:** derive badge, overview, category filters and correction
   navigation from the same versioned result. Reuse local Harper workers and current
   dictionary/rule merging; avoid duplicate checks when switching UI surfaces.
5. **Scoped sidebar bridge:** bind opaque editor IDs to tab, frame, document and
   revision. Validate sender, native grants, eligibility, foreground ownership and
   expected text at read and apply time. Only trusted panel actions can request a
   scoped correction; page messages cannot invoke panel APIs or arbitrary DOM edits.
   Keep issue snippets in bounded process memory, clear on navigation/pause/teardown/
   sign-out as appropriate, and never put website text/results in browser storage or
   logs. A worker restart may lose this disposable review state: reconnect to the
   current eligible editor and recheck rather than replay an old correction.
6. **Frames/open shadow DOM:** current manifests and sender rules are top-level.
   Add each capability only with corresponding trusted-origin/document binding,
   event/observer teardown, permission-removal and stale-frame tests. Do not simply
   enable `all_frames` or trust a root tab's origin for a different child origin.
7. **Privacy and work execution:** broader eligibility remains local checking.
   No new automatic remote text transmission, permissions, provider, quota or checker
   hosting. Existing explicit AI and consented enhanced proofing keep their separate
   grants/disclosures. Remote jobs must reuse Grove's durable command/outbox/worker
   stack, scoped encrypted staging, authorization/lease fences and uncertain-outcome
   reconciliation; never use detached request promises or browser polling as execution.
   Bounded interactive local-worker checks need no server queue.
8. **Lifecycle/performance:** inspect the focused candidate, not every field's text;
   bound DOM metadata/projection work and coalesce geometry updates. Keep local checks
   off the editor thread, debounce committed edits, wait through IME and invalidate
   stale results. Native first-party proofing retains ownership without duplicate
   underlines/badges. Observers/listeners must release disconnected roots and BFCache
   navigation cleanly. No background page-content harvesting or mutation loops.

## Implementation sequence and acceptance

One future feature PR, with independently verifiable commit groups. Implementation
requires a later owner go-ahead. No migration or new service is expected.

| Checkpoint                   | Required evidence before proceeding                                                                                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Eligibility and adapters  | Failing-then-passing metadata tests; prose inputs/one-row textareas supported; getter/DOM-read canaries prove sensitive and opted-out fields are not read, including after metadata mutation.                                             |
| B. Indicator/state model     | Exact count/category/ignore/dictionary tests; per-field pause isolation; no stale success during edits, partial checks, failure, composition or stronger opt-outs.                                                                        |
| C. Rich editors and roots    | Formatted replacement + native Undo/Redo in each claimed framework; cross-node/emoji/CRLF/BR/paste/controlled rerender tests; unsupported editors fall back honestly. Frame/shadow identity and permission tests before claiming support. |
| D. Sidebar and correction UI | Current-field navigation, revision fencing, keyboard/screen-reader journeys and stable draft/filter/focus/scroll during check success/failure, tab changes, pause and worker restart.                                                     |
| E. Integrated qualification  | Installed Chrome/Edge/Firefox journeys, docs/screenshots, local full gates and exact-head hosted checks. Browser/store release acceptance remains separate.                                                                               |

Test multiple eligible fields and tabs, hidden-to-visible editors, dynamic SPA
mount/unmount, label changes, `spellcheck=false`, sensitive autocomplete tokens,
search roles, shadow focus, frame navigation/removal, native proofing ownership,
signed-out/offline use and real permission withdrawal. Prove no local proofing text
leaves the browser. Exercise every claimed editor in light/dark and RTL; test nested
scrolling, fixed chat composers, host send buttons, scrollbars, resizing, zoom and
long fields. Measure geometry/focus/scroll and request counts, not just screenshots.

Run root lint/types/build/artifacts/docs, `pnpm test:writing`, `pnpm test:extension`
and installed browser tests; include service tests with disposable real services if
trusted messages, consent or worker paths change. Audit relevant website-native
writing tests after shared edits. Report unsupported versions and unavailable native
hosts honestly; Chromium alone is not three-browser acceptance. Measure first useful
local feedback without a setup wizard; never claim timing from source wiring.

### Documentation and delivery

When implemented, update the owning extension guide's field matrix, toggle scopes,
count/coverage states, navigation, shortcuts and qualification limits together.
Remove the blanket input/subject/title/rich-editor exclusions only for adapters
actually verified. Correct stale **Capture** navigation references to **Notes** and
the old **Home** sign-in instruction in `panel.html` while changing the sidebar.
Audit `design/browser-extension.md`'s old deferred-rich-editor/three-tab statements;
retain clearly labelled historical evidence rather than presenting it as current.
Do not advertise new fields in store/website copy before compatible packages exist.

Keep real synthetic before/after captures in the
[extension gallery](screenshots/browser-extension/README.md), labelled with source,
package/browser, viewport, states and limits. Include input/textarea placement,
rich-text correction, Writing sidebar and visible failure/partial states. Embed at
most four preview images per PR row; the rest stay embedded in docs. Reference
crops are not implementation evidence. Use a concise feature PR assigned to
`miniaxolotl`, minimal labels and exact-head checks. Merge, release, store updates
and removal of the stale clean task worktree follow their normal separate approvals.
