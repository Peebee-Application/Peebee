"use client";

import { Copy, Info, Reply, Share2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

export type MessageInfoRow = { label: string; value: string };

type View = "menu" | "delete" | "info";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Whether the viewer sent this message — "delete for everyone" is only
   * ever offered on your own messages, WhatsApp-style. */
  mine: boolean;
  isDeleted: boolean;
  /** Text and images can be copied; a voice note has no clean clipboard
   * equivalent, so it's left out rather than shipping a broken button. */
  canCopy: boolean;
  /** navigator.share isn't available on every browser — hidden rather
   * than shown disabled when it isn't. */
  canShare: boolean;
  infoRows: MessageInfoRow[];
  onReply: () => void;
  onCopy: () => void | Promise<void>;
  onShare: () => void | Promise<void>;
  onDelete: (scope: "me" | "everyone") => void;
};

/** A WhatsApp-style bottom sheet for the long-press message menu — plain
 * backdrop + slide-up panel, no dependency on any other app's drawer
 * component (this app has no shared action-sheet pattern to build on). */
export function MessageActionSheet({
  open,
  onClose,
  mine,
  isDeleted,
  canCopy,
  canShare,
  infoRows,
  onReply,
  onCopy,
  onShare,
  onDelete,
}: Props) {
  const [view, setView] = useState<View>("menu");

  useEffect(() => {
    if (open) setView("menu");
  }, [open]);

  if (!open) return null;

  const row = (icon: React.ReactNode, label: string, onClick: () => void, danger = false) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-[15px] font-semibold ${
        danger ? "text-red-600" : "text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-3xl glass-panel pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgba(10,10,10,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pb-1 pt-2.5">
          <span className="h-1.5 w-10 rounded-full bg-[rgb(var(--surface-muted))]" />
        </div>

        {view === "menu" && (
          <div className="space-y-0.5 p-2">
            {!isDeleted && (
              <>
                {row(<Reply className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />, "Reply", () => {
                  onReply();
                  onClose();
                })}
                {canCopy &&
                  row(<Copy className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />, "Copy", async () => {
                    await onCopy();
                    onClose();
                  })}
              </>
            )}
            {row(<Info className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />, "Info", () => setView("info"))}
            {!isDeleted &&
              canShare &&
              row(<Share2 className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />, "Share", async () => {
                await onShare();
                onClose();
              })}
            {row(<Trash2 className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />, "Delete", () => setView("delete"), true)}
          </div>
        )}

        {view === "delete" && (
          <div className="space-y-0.5 p-2">
            {row(<Trash2 className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />, "Delete for me", () => {
              onDelete("me");
              onClose();
            })}
            {mine &&
              !isDeleted &&
              row(<Trash2 className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />, "Delete for everyone", () => {
                onDelete("everyone");
                onClose();
              }, true)}
            <div className="pt-1">
              {row(<span className="w-5 shrink-0" />, "Cancel", onClose)}
            </div>
          </div>
        )}

        {view === "info" && (
          <div className="space-y-3 p-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Message info</h2>
            <dl className="space-y-2">
              {infoRows.map((r) => (
                <div key={r.label} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-ink-500">{r.label}</dt>
                  <dd className="font-semibold text-ink">{r.value}</dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 w-full rounded-full bg-[rgb(var(--surface-muted))] text-sm font-bold text-ink"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
