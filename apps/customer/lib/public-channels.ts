/**
 * Server-side data for channel, cause and post pages: what search engines and link previews read, and
 * the first thing a person sees when they open a shared link without an account. Public endpoints only.
 */
import type { CauseView, ChannelView, PostView } from "@peebee/shared";
import { SITE_URL } from "./public-share";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:10000").replace(/\/$/, "");

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}/v1${path}`, { next: { revalidate: 60 } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const channelPath = (handle: string) => `/c/${encodeURIComponent(handle)}`;
export const causePath = (slug: string) => `/give/${encodeURIComponent(slug)}`;
export const postPath = (id: string) => `/post/${encodeURIComponent(id)}`;

export async function fetchPublicChannel(handle: string): Promise<{ channel: ChannelView } | null> {
  return getJson<{ channel: ChannelView }>(`/public/channels/${encodeURIComponent(handle)}`);
}
export async function fetchPublicCause(slug: string): Promise<{ cause: CauseView } | null> {
  return getJson<{ cause: CauseView }>(`/public/causes/${encodeURIComponent(slug)}`);
}
export async function fetchPublicCauses(): Promise<{ causes: CauseView[] } | null> {
  return getJson<{ causes: CauseView[] }>(`/public/causes`);
}
export async function fetchPublicPost(id: string): Promise<{ post: PostView } | null> {
  return getJson<{ post: PostView }>(`/posts/${encodeURIComponent(id)}`);
}

export function clipText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : cut.length)}…`;
}

export const siteUrl = (path: string) => `${SITE_URL}${path}`;
