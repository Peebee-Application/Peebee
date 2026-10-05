"use client";
import type { RefObject } from 'react';

type Renderer = (parent: HTMLElement, options: Record<string, unknown>) => void;

/** Render Google's real control visibly and without scaling. Android sign-in
 * ignores taps on an iframe that was initialized underneath an invisible
 * branded overlay. Keep its native hit area and ID-token callback. */
export function mountGoogleButton(node: HTMLElement, renderButton: Renderer) {
  let previousWidth = 0;
  let previousTheme = '';
  function render() {
    const width = Math.round(node.parentElement?.clientWidth ?? 0);
    const theme = document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline';
    if (!width || (width === previousWidth && theme === previousTheme)) return;
    previousWidth = width;
    previousTheme = theme;
    const sdkWidth = Math.min(400, width);
    node.style.width = `${sdkWidth}px`;
    node.replaceChildren();
    renderButton(node, { type: 'standard', theme, size: 'large',
      shape: 'pill', width: sdkWidth, text: 'continue_with' });
  }
  render();
  const observer = new ResizeObserver(render);
  if (node.parentElement) observer.observe(node.parentElement);
  const themeObserver = new MutationObserver(render);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => { observer.disconnect(); themeObserver.disconnect(); };
}

export function GoogleButtonSurface({ buttonRef, ready, busy = false }: {
  buttonRef: RefObject<HTMLDivElement | null>; ready: boolean; busy?: boolean;
}) {
  return <div className="auth-google-button" aria-busy={busy || !ready} data-ready={ready} data-disabled={busy || !ready}>
    {(!ready || busy) && <div className="auth-google-face" aria-hidden="true">
      <img src="/brand/google-g.png" width={20} height={20} alt="" />
      <span>{busy ? 'Signing in…' : ready ? 'Continue with Google' : 'Loading Google…'}</span>
    </div>}
    <div ref={buttonRef} className="auth-google-control" />
    {!ready && <span className="auth-google-loading" role="status">Loading Google sign-in</span>}
  </div>;
}
