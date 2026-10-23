# Notebook lifecycle visual review

Synthetic notebook data, 23 October 2026. Production CSS build
`SNzSojrolAZ8iGl5APqCz`; Node 24.22.1, pnpm 10.33.0, Playwright 1.64.1.
Captures use iPhone/WebKit in the Noble container at the stated CSS viewport widths.

- [Archived directory, 1440px](archived-notebooks-1440.png): quiet row list,
  active/archived navigation and shared action menus.
- [Archive confirmation, 390px](archive-notebook-390.png): explicit subtree counts,
  restore/sharing semantics and reachable confirmation/cancellation.
- [Soft-delete confirmation, 320px](delete-notebook-320.png): retained-data wording,
  wrapped controls and narrow manager action rows without horizontal overflow.

All three were visually reviewed. Chromium checks also cover 1440/390/320px,
WCAG A/AA, overflow, Cancel, restoration and all three action entry points. A first
320px run exposed the manager's extra touch action overflowing; narrow manager rows
now wrap actions below titles. The WebKit draft scenario opens mobile Notebooks
before using Manage, matching actual navigation. Physical-device keyboards are not
qualified by browser emulation.
