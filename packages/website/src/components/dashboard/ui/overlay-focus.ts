// Track inert separately from an overlay library's aria-hidden bookkeeping.
const locks = new WeakMap<HTMLElement, { count: number; original: boolean }>();

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
