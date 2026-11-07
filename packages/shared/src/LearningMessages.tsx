"use client";
import { useEffect, useState } from "react";
import type { learningCreatorMethods } from "./learn-creator.js";
type Api = ReturnType<typeof learningCreatorMethods>;
export function LearningMessages({ api }: { api: Api }) {
  const [messages, setMessages] = useState<
      Awaited<ReturnType<Api["learningSharedInbox"]>>["messages"]
    >([]),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .learningSharedInbox()
      .then((r) => {
        if (active) setMessages(r.messages);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Messages could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [api]);
  return (
    <section className="space-y-4 text-ink">
      <h1 className="text-2xl font-semibold">Learn messages</h1>
      <p className="text-sm text-ink-500">
        Courses and paths people shared with you. Opening a card respects its
        current access and purchase rules.
      </p>
      {error && <p role="alert">{error}</p>}
      {loaded && !messages.length && !error && (
        <p>No learning journeys shared yet.</p>
      )}
      {messages.map((m) => (
        <article
          key={m.id}
          className="space-y-2 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4"
        >
          <p className="text-xs text-ink-500">
            From {m.sender} · {m.createdAt}
          </p>
          <a
            className="text-lg font-semibold text-gold underline"
            href={`/learn/study/${encodeURIComponent(m.courseId)}`}
          >
            {m.title}
          </a>
          <p className="whitespace-pre-wrap text-sm">{m.note}</p>
        </article>
      ))}
    </section>
  );
}
