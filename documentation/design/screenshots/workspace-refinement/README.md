# Workspace refinement

Reviewed browser-fixture captures using production CSS and synthetic notes. Source:
`e31e438` on `fix/workspace-refinement`, 22 October 2026. Production CSS build
`bb1JRm4mEIK8YwzqY7LrK`; Node 24.21.0 / pnpm 10.33.0 / Playwright 1.64.1.

## Navigation and controls

- [Desktop sidebar](sidebar-expanded-1440.png)
- [Phone sidebar](sidebar-expanded-390.png)
- [Narrow sidebar](sidebar-expanded-320.png)
- [Note drag preview and destination](sidebar-note-drag.png)
- [Desktop note controls](note-read-1440.png)
- [Phone note controls](note-read-390.png)
- [Narrow writing controls](note-write-320.png)

Folder/file icons serve as drag handles. Notebook titles have more room, Commands
and keyboard help share a baseline, and compact desktop controls retain separate
44px touch targets. Flat green/outlined buttons follow the public site's styling.

## Outline and focus

- [Content-sized outline](note-outline-1440.png)
- [Narrow outline](note-outline-320.png)
- [Focus mode with reachable modes and current section](focus-outline.png)

## Ask/Search

- [Desktop pending search](search-pending-1440.png)
- [Desktop results](search-results-1440.png)
- [Phone results](search-results-390.png)
- [Narrow results](search-results-320.png)

Mode and notebook controls align; the search field/status retain their positions
through loading, results, clearing and retry. The full browser suite also checks
short windows, enlarged text, reduced motion, keyboard/touch and accessibility.
