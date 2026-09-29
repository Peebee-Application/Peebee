"use client";

const loaded: Record<string, Promise<void>> = {};

/** Loads an external `<script>` once and caches the promise, so mounting
 * (and unmounting/remounting) a map picker never injects the same SDK
 * twice. Resolves immediately if a tag with this id is already present
 * (e.g. from a previous mount that hasn't been garbage-collected). */
export function loadScript(src: string, id: string): Promise<void> {
  const existing = loaded[id];
  if (existing) return existing;
  loaded[id] = new Promise((resolve, reject) => {
    if (document.getElementById(id)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.id = id;
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      // Forget the failed attempt so the next mount retries instead of
      // resolving against this dead tag or the cached rejection.
      s.remove();
      delete loaded[id];
      reject(new Error(`Failed to load script: ${src}`));
    };
    document.head.appendChild(s);
  });
  return loaded[id];
}

export function loadStylesheet(href: string, id: string): void {
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}
