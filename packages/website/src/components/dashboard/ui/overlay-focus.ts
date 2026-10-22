// Track inert separately from an overlay library's aria-hidden bookkeeping.
const locks = new WeakMap<HTMLElement, { count: number; original: boolean }>();
let scrollLocks = 0;
let previousOverflow = "";

/** Keep search dialogs inside the visible viewport during keyboard/zoom changes. */
export function fitPaletteViewport(element: HTMLElement) {
  const viewport = window.visualViewport;
  const place = () => {
    for (const [name, value] of Object.entries({
      top: viewport?.offsetTop ?? 0,
      left: viewport?.offsetLeft ?? 0,
      height: viewport?.height ?? window.innerHeight,
      // The visual viewport includes a reserved scrollbar gutter in Chromium.
      width: Math.min(
        viewport?.width ?? window.innerWidth,
        document.documentElement.clientWidth,
      ),
    }))
      element.style.setProperty(`--palette-viewport-${name}`, `${value}px`);
  };
  place();
  window.addEventListener("resize", place);
  viewport?.addEventListener("resize", place);
  viewport?.addEventListener("scroll", place);
  return () => {
    window.removeEventListener("resize", place);
    viewport?.removeEventListener("resize", place);
    viewport?.removeEventListener("scroll", place);
  };
}

/** Nested dialogs and expanded canvases release only their own scroll lock. */
export function lockPageScroll() {
  if (scrollLocks++ === 0)
    previousOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  return () => {
    if (--scrollLocks === 0)
      document.documentElement.style.overflow = previousOverflow;
  };
}

/** Disable background focus while a portalled modal control is mounted. */
export function isolateOverlay(element: HTMLElement) {
  const affected: HTMLElement[] = [];
  let current = element;
  while (current.parentElement) {
    const parent = current.parentElement;
    for (const sibling of parent.children) {
      if (sibling === current || !(sibling instanceof HTMLElement)) continue;
      const lock = locks.get(sibling) ?? { count: 0, original: sibling.inert };
      lock.count++;
      locks.set(sibling, lock);
      sibling.inert = true;
      affected.push(sibling);
    }
    if (parent === document.body) break;
    current = parent;
  }
  return () => {
    for (const sibling of affected) {
      const lock = locks.get(sibling)!;
      if (--lock.count === 0) {
        sibling.inert = lock.original;
        locks.delete(sibling);
      }
    }
  };
}
