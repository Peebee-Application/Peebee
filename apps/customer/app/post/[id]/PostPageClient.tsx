"use client";

import type { PostView } from "@peebee/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PostCard } from "../../../components/channels/PostCard";
import { PublicFrame } from "../../../components/channels/PublicFrame";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

export function PostPageClient({ id }: { id: string }) {
  const { user } = useAuth();
  const [post, setPost] = useState<PostView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.getPost(id).then((r) => setPost(r.post)).catch((err) => setError(errorMessage(err)));
  }, [id, user?.id]);
  return (
    <PublicFrame returnTo={`/post/${id}`}>
      <div className="space-y-4 px-4 pb-24 pt-2">
        {error && <div className="space-y-3 p-8 text-center"><h1 className="text-lg font-bold text-ink">{error === "Currently Offline" ? error : "Post not found"}</h1>{error !== "Currently Offline" && <p className="text-sm text-ink-500">{error}</p>}</div>}
        {!post && !error && <div className="p-8 text-center text-sm text-ink-500" aria-busy="true">Loading…</div>}
        {post && <PostCard key={`${post.id}-${user?.id ?? "x"}`} post={post} />}
        {post?.publisher?.type === "channel" && post.publisher.handle && <Link href={`/c/${post.publisher.handle}`} className="block rounded-full bg-[rgb(var(--surface-muted))] py-3 text-center text-sm font-bold text-ink">More from {post.publisher.name}</Link>}
      </div>
    </PublicFrame>
  );
}
