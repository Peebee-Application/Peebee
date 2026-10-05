"use client";
import type { RefObject } from 'react';

type Renderer = (parent: HTMLElement, options: Record<string, unknown>) => void;

/** Keep the Google SDK as the real mouse/keyboard control. Its transparent
 * layer fills the branded surface, so no synthetic click or One Tap fallback
 * is needed and the existing ID-token callback remains unchanged. */
export function mountGoogleButton(node: HTMLElement, renderButton: Renderer) {
  const scale = 54 / 40;
  let previousWidth = 0;
  function render() {
    const width = Math.round(node.parentElement?.clientWidth ?? 0);
    if (!width || width === previousWidth) return;
    previousWidth = width;
    const sdkWidth = Math.min(400, Math.floor(width / scale));
    node.style.width = `${sdkWidth}px`;
    node.style.transform = `scale(${width / sdkWidth}, ${scale})`;
    node.replaceChildren();
    renderButton(node, { type: 'standard', theme: 'outline', size: 'large',
      shape: 'rectangular', width: sdkWidth, text: 'continue_with' });
  }
  render();
  const observer = new ResizeObserver(render);
  if (node.parentElement) observer.observe(node.parentElement);
  return () => observer.disconnect();
}

export function GoogleButtonSurface({ buttonRef, ready, busy = false }: {
  buttonRef: RefObject<HTMLDivElement | null>; ready: boolean; busy?: boolean;
}) {
  return <div className="auth-google-button" aria-busy={busy || !ready} data-disabled={busy || !ready}>
    <div className="auth-google-face" aria-hidden="true">
      <img src="/brand/google-g.png" width={20} height={20} alt="" />
      <span>{busy ? 'Signing in…' : ready ? 'Continue with Google' : 'Loading Google…'}</span>
    </div>
    <div ref={buttonRef} className="auth-google-control" />
    {!ready && <span className="auth-google-loading" role="status">Loading Google sign-in</span>}
  </div>;
}
