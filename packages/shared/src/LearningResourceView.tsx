"use client";
import { useEffect, useState } from "react";
import type {
  LearningResource,
  learningCreatorMethods,
} from "./learn-creator.js";
type Api = ReturnType<typeof learningCreatorMethods> & { baseUrl: string };

export function LearningResourceView({
  resource,
  api,
}: {
  resource: LearningResource;
  api: Api;
}) {
  const [signed, setSigned] = useState<{ key: string; url: string } | null>(
      null,
    ),
    [problem, setProblem] = useState<{ key: string; message: string } | null>(
      null,
    ),
    [refresh, setRefresh] = useState(0);
  const privateResource = resource.url.startsWith("resource:"),
    requestKey = resource.url + ":" + refresh;
  const url = privateResource
    ? signed?.key === requestKey
      ? signed.url
      : ""
    : resource.url;
  const error = problem?.key === requestKey ? problem.message : "";
  useEffect(() => {
    if (!privateResource) return;
    let active = true;
    api
      .learningResourceUrl(resource.url.slice(9))
      .then((r) => {
        if (active)
          setSigned({ key: requestKey, url: new URL(r.url, api.baseUrl).href });
      })
      .catch(() => {
        if (active)
          setProblem({
            key: requestKey,
            message: "Reopen this resource to refresh access.",
          });
      });
    return () => {
      active = false;
    };
  }, [api, resource.url, privateResource, requestKey]);
  return (
    <figure className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
      <figcaption className="text-sm font-semibold text-ink">
        {resource.title}
      </figcaption>
      {resource.url.startsWith("resource:") && (
        <button
          type="button"
          className="min-h-10 text-xs text-gold underline"
          onClick={() => setRefresh((n) => n + 1)}
        >
          Refresh access link
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-ink-500">
          {error}
        </p>
      )}
      {url && (resource.kind === "image" || resource.kind === "gif") && (
        <ImageResource url={url} resource={resource} />
      )}
      {url &&
        resource.kind === "video" &&
        (resource.url.startsWith("resource:") ? (
          <video
            className="max-h-96 w-full rounded-lg"
            src={url}
            controls
            onError={() =>
              setProblem({
                key: requestKey,
                message:
                  "This playback link expired or the file is unavailable. Refresh access to try again.",
              })
            }
            preload="metadata"
            aria-label={resource.title}
          />
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gold underline"
          >
            Watch video on its source site
          </a>
        ))}
      {url && resource.kind === "audio" && (
        <audio
          className="w-full"
          src={url}
          controls
          preload="metadata"
          aria-label={resource.title}
        />
      )}
      {url && ["pdf", "document", "link"].includes(resource.kind) && (
        <a
          className="text-sm font-semibold text-gold underline"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open{" "}
          {resource.kind === "pdf"
            ? "PDF"
            : resource.kind === "document"
              ? "document"
              : "resource"}
        </a>
      )}
      {resource.description && (
        <p className="whitespace-pre-wrap text-sm text-ink-500">
          {resource.description}
        </p>
      )}
    </figure>
  );
}
function ImageResource({
  url,
  resource,
}: {
  url: string;
  resource: LearningResource;
}) {
  const [playing, setPlaying] = useState(false);
  if (resource.kind === "gif" && !playing)
    return (
      <button
        type="button"
        onClick={() => setPlaying(true)}
        className="min-h-11 rounded-lg border border-[var(--border-faint)] px-4 py-2 text-sm text-ink"
      >
        Play animation: {resource.title}
      </button>
    );
  return (
    <div className="space-y-2">
      <img
        className="max-h-96 max-w-full rounded-lg object-contain"
        src={url}
        alt={resource.description || resource.title}
      />
      {resource.kind === "gif" && (
        <button
          type="button"
          className="min-h-10 text-sm text-gold underline"
          onClick={() => setPlaying(false)}
        >
          Stop animation
        </button>
      )}
    </div>
  );
}
