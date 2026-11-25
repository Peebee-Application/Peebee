/** Normal Customer screens scroll in the content pane. Immersive screens keep document scrolling. */
export function customerScrollViewport(): HTMLElement | Window {
  return document.querySelector<HTMLElement>(".customer-content-pane") ?? window;
}

export function customerScrollTop(viewport = customerScrollViewport()): number {
  return viewport instanceof HTMLElement ? viewport.scrollTop : viewport.scrollY;
}
