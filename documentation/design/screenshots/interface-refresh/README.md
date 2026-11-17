# Grove interface refresh

Matched captures from the baseline `a30ec65f` and the UI refresh in
[PR #217](https://github.com/miniaxolotl/grove/pull/217). These show local
production website builds and the installed Chromium extension, not a deployed
release. The workspace and shared reader use synthetic fixtures, not live
accounts or real share links. Cookie prompts were dismissed in both sets.

## Final polish

These pairs compare the previous PR revision (`42f628a3`) with the lighter
reader and the corrected mobile workspace header. The full-size gallery below
compares the original baseline with the latest UI.

| Mobile Notes before | Mobile Notes after |
| --- | --- |
| ![Import and daily note buttons compete with the Notes heading](polish/notes-priority-before.webp) | ![New note, search, and Ask Grove remain visible while secondary actions move under More](polish/notes-priority-after.webp) |

| Mobile header before | Mobile header after |
| --- | --- |
| ![Actions cluster beside the logo](polish/header-before.webp) | ![Logo on the left and actions grouped on the right](polish/header-after.webp) |

| Shared quotation before | Shared quotation after |
| --- | --- |
| ![Quotation in a tinted box below two dividers](polish/quote-before.webp) | ![Nested quotation distinguished by indentation, without a box or divider](polish/quote-after.webp) |

## Full-size comparisons

| Area | Phone | Tablet | Desktop |
| --- | --- | --- | --- |
| Public landing page | [Before](before/home-390.webp) / [After](home-390.webp) | [Before](before/home-768.webp) / [After](home-768.webp) | [Before](before/home-1440.webp) / [After](home-1440.webp) |
| Signed-in Notes workspace | [Before](before/workspace-390.webp) / [After](workspace-390.webp) | [Before](before/workspace-768.webp) / [After](workspace-768.webp) | [Before](before/workspace-1440.webp) / [After](workspace-1440.webp) |
| Settings and writing checks | [Before](before/settings-390.webp) / [After](settings-390.webp) | [Before](before/settings-768.webp) / [After](settings-768.webp) | [Before](before/settings-1440.webp) / [After](settings-1440.webp) |
| Public setup | [Before](before/setup-390.webp) / [After](setup-390.webp) | [Before](before/setup-768.webp) / [After](setup-768.webp) | [Before](before/setup-1440.webp) / [After](setup-1440.webp) |
| Shared notebook | [Before](before/shared-390.webp) / [After](shared-390.webp) | [Before](before/shared-768.webp) / [After](shared-768.webp) | [Before](before/shared-1440.webp) / [After](shared-1440.webp) |
| Signed-out extension panel (390 px) | [Before](before/extension-welcome.webp) / [After](extension-welcome.webp) | | |

## Expanded pass previews

### Settings

| Before | After |
| --- | --- |
| ![Settings with section links clipped to a scrolling row](before/settings-390.webp) | ![Settings with wrapped section links and aligned writing controls](settings-390.webp) |

### Setup

| Before | After |
| --- | --- |
| ![Setup with a large introduction above the tool selection](before/setup-1440.webp) | ![Setup with direct AI tool and extension links above the tool selection](setup-1440.webp) |

### Shared notebook

| Before | After |
| --- | --- |
| ![Read-only notebook before the reader refresh](before/shared-390.webp) | ![Read-only notebook with clearly labelled sub-notebooks and notes](shared-390.webp) |

## Public landing page

| Before | After |
| --- | --- |
| ![Original desktop landing page](before/home-1440.webp) | ![Desktop landing page with a compact sample note and cited answer](home-1440.webp) |

## Signed-in workspace

| Before | After |
| --- | --- |
| ![Original empty Notes workspace](before/workspace-1440.webp) | ![Desktop Notes workspace with the first-note action](workspace-1440.webp) |

## Browser extension

| Before | After |
| --- | --- |
| ![Original extension welcome page focused on sign-in](before/extension-welcome.webp) | ![Signed-out extension with spelling and grammar first](extension-welcome.webp) |

![Editor showing proofing feedback next to character count](extension-notes.webp)

![Extension settings in dark mode](extension-settings-dark.webp)
