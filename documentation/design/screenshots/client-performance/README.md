# Client loading and recovery

## Notes loading and ready states · PR #219

Captured from application source `351070d2f33951b1d67f156e9c827db8434da166`
using the Chromium dashboard fixture with production CSS from build
`rnq4IoRnmVbi0KTEDC1gw`. The same six synthetic notes were held and then
released in each viewport. These captures do not exercise live Clerk or Next
server rendering.

| Viewport | Held first read | Same view after response |
| --- | --- | --- |
| 1440 × 900 | [Desktop skeleton](workspace-notes-loading-1440.png) | [Desktop notes](workspace-notes-ready-1440.png) |
| 390 × 844, touch emulation | [Mobile skeleton](workspace-notes-loading-390.png) | [Mobile notes](workspace-notes-ready-390.png) |

The loading message sits in the selection header. The first row kept its
position and width in both pairs, with a 1 px height difference on desktop and
no height change in touch emulation. On phones, Today’s note and Import notes
sit together beneath the title; New note stays in the workspace header.

## Earlier client loading and recovery captures

Synthetic notes, real development Clerk sign-in and production Next routing.
Application source: `e20deb615c01ea061a1064aef18eb3269883e7ca`.
Build: `OpJqVPQE_A1t4l2TZW1a1`. Includes landed gesture, action and relationship work.

| Capture | State |
| --- | --- |
| [Notes](notes-desktop.png) | Fresh return to Notes; zero additional application reads. |
| [Initial loading](notes-loading.png) | Held first read; honest label and static decorative placeholders. |
| [Background retry](refresh-retry.png) | Deliberately failed refresh; notes remain in place with an inline retry. |
| [Drawer loading](drawer-loading.png) | Held real editor chunk; stable drawer bounds and reachable close control. |
| [Drawer ready](drawer-ready.png) | Successful retry into the compact toolbar. |
| [Mobile recovery](retry-mobile.png) | Deliberately failed chunk at 390px; in-place retry remains reachable. |
| [Mobile editing](editor-mobile.png) | Recovered editor, preserved compact actions and formatting controls. |

The failure captures are intentional fault injection. Production checks compare
drawer bounds and keyboard focus at 1440, 390 and 320px. Raw evidence is retained in
`~/.local/state/grove-client-performance/closeout-*`.
