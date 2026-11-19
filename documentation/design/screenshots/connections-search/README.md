# Connections, search and import

The examples in this gallery use synthetic workspace data. See the [workspace guide](../../../workspace.md) for the corresponding actions.

### Connections

- [Desktop setup](setup.png) — Settings at 1440 × 900, with direct actions for the extension, agents and API keys.
- [Last use](last-use.png) — detail from the same viewport showing a recorded local timestamp and a key with no use recorded. Neither requires opening Connection details.
- [Phone setup](setup-mobile.png) — setup actions at a 390 × 844 touch viewport, cropped to the action list. Both dialogs opened and closed by touch.

Captured in Playwright Chromium from the local dashboard fixture and compiled website CSS, using the Connections changes based on `49022855`. Store installation, live providers and physical devices were not exercised.

### Search

- [Recent notes](search-recent.png) and [loading](search-loading.png) — the desktop palette stays anchored while looking up a phrase (1440 × 800).
- [Cancelled](search-cancelled.png) and [empty](search-empty.png) — cancelling keeps the phrase and scope; resuming can return no matches (390 × 800, empty state cropped to the dialog).
- [Retry](search-error.png) — an unavailable search keeps the selected notebook and offers a keyboard-operable retry (390 × 700).
- [Matching passage](search-results.png), [Ask results](search-ask.png) and [library results](search-library.png) — the matching note is reachable by keyboard in each view (390 × 850, 390 × 900 and 1280 × 720 respectively).

Captured from the synthetic Playwright Chromium dashboard fixture on `49022855` plus the search changes, with compiled website CSS from build `fjiHs0Lc4h5cm4Kx44M0v`. The fixtures exercise browser requests and UI recovery, not live ranking or provider latency. See [note search](../../../search.md).

## Preview gallery

| Setup | Last use | Import destination | Notebook search |
| --- | --- | --- | --- |
| ![Connection setup actions](setup.png) | ![Recorded and never-recorded use](last-use.png) | ![Choose where to import notes](import.png) | ![Filter nested notebook paths](../dropdown-contrast/ask-notebook-filter.png) |

| Searching | Cancelled | Retry | Results |
| --- | --- | --- | --- |
| ![Search in progress](search-loading.png) | ![Resume a cancelled query](search-cancelled.png) | ![Retry a failed search](search-error.png) | ![Matching passages](search-results.png) |
