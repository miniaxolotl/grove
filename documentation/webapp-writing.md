# Writing checks in the webapp

The note editor checks spelling and basic grammar on your device, using the
same English engine as the browser extension — one shared implementation, not
a second opinion. There is nothing to install and no setup step: checks run
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
  If the text changed underneath, the card says so and asks for a fresh check
  instead of editing stale text. The quiet status in the editor footer shows
  the current count, or **Retry writing checks** when the dictionary could not
  load. When checks are off or the note is empty, it shows nothing rather
  than a success panel.
- Suggestions put the obvious fix first — keyboard transpositions (**teh** →
  **the**), missing apostrophes (**dont** → **don't**) and dropped doubled
  letters (**refered** → **referred**) outrank unrelated near-edits — then
  follow the original word's capitalization. Grammar covers the same ground
  as the extension: matching brackets/quotes, **a/an** sound exceptions,
  repeated words, spacing, sentence capitalization, wordy phrases, pronoun
  verb agreement, confused words and acronym plurals. Inverted questions
  (**does he have**) and mandative clauses (**I suggest he go**) are left
  alone rather than "fixed".
- **No issues found by spelling and basic grammar checks** means exactly that:
  it is not a complete grammar guarantee.

## Settings → Writing

Writing is under **Settings → Writing**. Open **More writing options** for
typing, highlighting, and individual rule preferences. Each control applies
immediately and stays on this device:

- **Writing assistance** master switch, **Spelling**, **Basic grammar**,
  **Check as I type** and **Inline highlights** (off keeps the accessible issue
  list while removing underlines).
- **Advanced rules**: ten independent rule switches. Turning a parent off keeps
  the individual choices for when it returns.
- **Personal dictionary**: names, brands and terms this device will not flag.
  This list is separate from the browser extension’s dictionary until a shared
  store lands; adding the same word in both places is expected for now.

## Privacy and limits

- Guests can use the [web writing checker](https://usegrove.cloud/writing)
  without an account. **Check writing** pairs each explanation with the word or
  phrase it refers to. For a spacing issue, it names the gap and shows the
  text that follows it. Text is checked locally and
  is not saved; note storage, account preferences and Ask Grove still require
  sign-in.

- Local checks never send keystrokes, prose, dictionary words or results
  anywhere. The 555 KB dictionary is fetched once from Grove itself on the first
  eligible edit and cached; no third-party dictionary download exists.
  Spelling and grammar checks are unlimited on every plan.
- Only English is supported. Code, link destinations, filenames and Markdown
  syntax are never flagged. Ambiguous rules abstain rather than guess.
- Sentence rewrites with AI alternatives stay in the browser extension for now:
  they need an explicit consent and a connection-scoped authorization the
  website session does not carry yet. There they use a monthly writing
  allowance — 100 a month on Free (up to 30 a day), 1,000 a month on Pro (up
  to 200 a day) — with the same local checks staying unlimited. The webapp
  never sends what you type for checking, and this page will name the release
  when that changes.

## No double checking

When the webapp’s proofing is active, the page advertises it and the installed
browser extension stands down on Grove pages: exactly one writer owns the
editor, so underlines, cards and replacements never appear twice or fight over
the caret. If webapp checks are off, the page stays quiet — the extension still
stays out on Grove pages rather than injecting a second layer.
