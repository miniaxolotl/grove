# One notes workspace

Browser captures from the isolated dashboard fixture using the production build's
CSS and local fonts. All notes and account details are synthetic.

- [Dated notes](notes-by-date.png), desktop Chromium 1280 × 720: Today’s note saves
  into the normal library; Date written groups notes by day.
- [Notebook](notebook-desktop.png), desktop Chromium 1280 × 720: a notebook opens to
  its notes, with summaries, progress notes and scoped chat in its action menu.
- [Mobile notebooks](notebooks-mobile.png), Chromium 390 × 844 viewport, full page:
  the notebook disclosure exposes navigation, note links, creation and management.

All 68 Chromium browser scenarios pass, including the simplified workflows,
320px overflow/WCAG A/AA checks, keyboard dragging, autosave, focus mode and chat
history/preview/composer regressions. These are browser screenshots, not native
application captures.

Four iPhone/WebKit scenarios also pass through the Playwright 1.64.1 Ubuntu browser
container: mobile notebook browsing, dated writing, composer formatting/selection,
and touch-scrolling long notebook menus.

### Daily-note identity — November 2026

Synthetic Chromium dashboard fixture (`daily-note.spec.ts`), using the
daily-note fix and production CSS:

- [Reopen from Notes](reopened-daily-note.png), 1280 × 720: the same saved draft
  opens in its original notebook after being given a different title.
- [Concurrent first save](daily-note-conflict.png), 390 × 844: the losing draft
  stays editable until the writer chooses **Discard draft and open saved note**.

These fixtures simulate API responses; they do not qualify live Clerk or a
physical device. Disposable PostgreSQL tests separately exercise persistence.
