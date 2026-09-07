/** Layout scrolls its main element; the isolated fixture scrolls the document. */
export function workScrollHost(element: HTMLElement | null): HTMLElement {
  let parent = element?.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    if (/auto|scroll/.test(style.overflowY)) return parent;
    parent = parent.parentElement;
  }
  return document.scrollingElement as HTMLElement;
}
