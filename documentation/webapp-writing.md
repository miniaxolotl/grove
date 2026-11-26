# Writing checks in the webapp

The note editor and browser extension use Harper to check English spelling and grammar on your device. Both checks are on by default. There is nothing to install and no setup step: checks run
after a typing pause, and saving never waits for them.

## Reviewing suggestions

On the guest checker, you can start typing while the page loads. Once the
checker is ready, choose **Check writing** without having to edit the text again.

- Spelling issues use a red wavy underline; grammar uses a dotted green one.
  Color is never the only signal: every issue opens the same short explanation.
- Click an underline, or press **Alt+Enter** for the full list. The compact card
  shows the category, an explanation and up to three replacements, then
  **Ignore**, **Add word** (spelling only) and **All issues**.
- One click applies a replacement to that exact range only, with normal Undo.
  You can correct a word in Markdown image alt text without changing the image
  link. A suggestion whose replacement would cross masked inline code is omitted.
  If the text changed underneath, the card says so and asks for a fresh check
  instead of editing stale text. The quiet status in the editor footer shows
  the current count, or **Retry writing checks** when the local checker could not
  load. When checks are off or the note is empty, it shows nothing rather
  than a success panel.
- The editor checks visible prose against its Markdown source. You can correct a word inside a heading, formatted link label, or table cell without rewriting the surrounding Markdown. Code, link destinations and markup are protected. Suggestions arriving after a newer edit cannot replace the newer text.
- **No issues found by spelling and basic grammar checks** means exactly that:
  it is not a complete grammar guarantee.

## Settings → Writing

Writing is under **Settings → Writing**. Open **More writing options** for
typing, highlighting, and individual rule preferences. Each control applies
immediately and stays on this device:

- **Writing assistance** master switch, **Spelling**, **Basic grammar**,
  **Check as I type** and **Inline highlights** (off keeps the accessible issue
  list while removing underlines).
- Turning off **Check as I type** discards a pending automatic check. Use
  **Check writing** when you want results in manual mode.
- **Advanced rules**: ten independent rule switches. Turning a parent off keeps
  the individual choices for when it returns.
  Local child controls are nested under the master and paused while it is off;
  a checked child records the saved choice, not an effective running check.
- **Personal dictionary**: save up to 1,000 names, brands and terms. Case,
  straight or curly apostrophes, and equivalent forms of accented letters count
  as the same entry. A saved name also covers its possessive.
  This list is separate from the browser extension’s dictionary until a shared
  store lands; adding the same word in both places is expected for now.

## Privacy and limits

- Guests can use the [web writing checker](https://grovenote.app/writing)
  without an account. **Check writing** pairs each explanation with the word or
  phrase it refers to. For a spacing issue, it names the gap and shows the
  text that follows it. Text is checked locally and
  is not saved; note storage, account preferences and Ask Grove still require
  sign-in.

- Local checks never send keystrokes, prose, dictionary words or results
  anywhere. The web app loads its own Harper worker and WebAssembly assets. An initialized worker is reused across edits.
  Spelling and grammar checks are unlimited on every plan.
- Only English is supported. Protected Markdown spans are excluded from edits.
- Sentence rewrites with AI alternatives stay in the browser extension for now:
  they need an explicit consent and a connection-scoped authorization the
  website session does not carry yet. There they use a monthly writing
  allowance — 100 a month on Free (up to 30 a day), 1,000 a month on Pro (up
  to 200 a day) — with the same local checks staying unlimited.

## Enhanced grammar in signed-in notes

Where the private LanguageTool service is configured, signed-in writers can enable **Enhanced grammar** in Writing settings. It is off by default. An enhanced check sends one eligible paragraph to Grove's private checker; it never sends the complete note, a link destination or the personal dictionary. Masking Markdown is not anonymization: the words you wrote in the paragraph are still sent. Guests and the extension use local checks only.

When the private service is not configured, enhanced checks are unavailable and existing opt-ins can still be revoked in Settings.

Manual and automatic checking are separate choices. Corrections from both engines use the same editor underlines, issue list and Undo history. Saving does not depend on either engine. If hosted checking is busy or unavailable, local feedback remains available. Turn off Enhanced grammar to stop sending paragraphs.

## No double checking

When the webapp’s proofing is active, the page advertises it and the installed
browser extension stands down on Grove pages: exactly one writer owns the
editor, so underlines, cards and replacements never appear twice or fight over
the caret. If webapp checks are off, the page stays quiet — the extension still
stays out on Grove pages rather than injecting a second layer.
