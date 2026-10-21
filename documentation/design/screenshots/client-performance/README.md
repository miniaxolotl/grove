# Client loading and recovery

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
