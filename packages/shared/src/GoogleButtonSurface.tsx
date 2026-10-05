"use client";
import type { RefObject } from 'react';

type Renderer = (parent: HTMLElement, options: Record<string, unknown>) => void;

/** Keep Google's real mouse/keyboard/touch control at its native size.
 * Scaling its iframe breaks Android taps. Center the SDK control inside the
 * branded surface and leave the existing ID-token callback unchanged. */
export function mountGoogleButton(node: HTMLElement, renderButton: Renderer) {
  let previousWidth = 0;
  function render() {
    const width = Math.round(node.parentElement?.clientWidth ?? 0);
    if (!width || width === previousWidth) return;
    previousWidth = width;
    const sdkWidth = Math.min(400, width);
    node.style.width = `${sdkWidth}px`;
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
