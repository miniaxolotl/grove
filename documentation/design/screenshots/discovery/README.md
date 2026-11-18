# Maintained Grove references

## Task directory and setup

Local production build of the task-first guides based on `9ee71cc9`. Chromium,
1× scale, reduced motion, optional cookies declined. The 320px capture shows
keyboard focus after opening **In this guide**; the 390px capture shows arrow-key
selection of Claude web. Both phone checks request dark system preference; the
public site retains its paper palette. No account or live provider was used.

| Directory, 1440×900                               | Article focus, 320×760                      | Setup focus, 390×844                        |
| ------------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| ![Notebook and integration tasks](tasks-1440.png) | ![Focus on the CLI shortcut](tasks-320.png) | ![Focus on Claude web setup](tasks-390.png) |

## Earlier reference layout

Actual local production build of this PR, Chromium, 1× scale, JavaScript disabled
and reduced motion. The existing light theme and typography are retained. The hub
images are full-page at 1440×1000 and 390×844; the client image is a mobile viewport
scrolled to the CLI heading. No account, connection or real notebook data is used.

| Hub, 1440px                                   | Hub, 390px                                  | Client reference, 390px                       |
| --------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| ![Desktop documentation hub](hub-desktop.png) | ![Mobile documentation hub](hub-mobile.png) | ![Mobile CLI instructions](client-mobile.png) |

Reviewed navigation, readable text, code and overflow. Separate axe 4.14.0 audits
passed WCAG A/AA on all six docs routes at 390px. Browser regressions also check
320/390/768/1440px and no-JavaScript content. The audit used an explicit browser
context; axe rejected an initial single-page convenience context, which is not
counted as a completed audit.

These are source-build screenshots, not deployed website, native-device or hosted
chat acceptance. Existing brand/font licensing remains in the design kit.
