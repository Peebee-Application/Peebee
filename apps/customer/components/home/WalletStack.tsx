"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { walletDeckIndex, type HomeWalletAccount } from "../../lib/home-wallet";

const SETTLE = { duration: 320, easing: "cubic-bezier(.22,1,.36,1)" };
const SHUFFLE = { duration: 760, easing: "cubic-bezier(.4,0,.2,1)", fill: "both" as const };

function restingPose(depth: number) {
  const layer = Math.min(depth, 2);
  return `translate3d(0px,${-12 * layer}px,${-20 * layer}px) rotateX(0deg) rotateY(0deg) rotateZ(0deg) scale(${1 - layer * .04})`;
}
function draggingPose(x: number) {
  return `translate3d(${x}px,${-Math.abs(x) * .12}px,${Math.abs(x) * .4}px) rotateX(${Math.abs(x) * .05}deg) rotateY(${x * .12}deg) rotateZ(${x * .035}deg) scale(1)`;
}
type Flight = { accounts: HomeWalletAccount[]; from: number; to: number; direction: 1 | -1; start: string };

/** Stable keyed cards stay mounted while moving through a physical depth stack. */
export function WalletStack({ accounts, renderCard }: { accounts: HomeWalletAccount[]; renderCard: (account: HomeWalletAccount) => ReactNode }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const cards = flight?.accounts ?? accounts;
  const index = flight?.from ?? Math.max(0, cards.findIndex(card => card.id === selected));
  const active = cards[index];
  const nodes = useRef(new Map<string, HTMLElement>());
  const busy = useRef(false);
  const frame = useRef<number | null>(null);
  const settle = useRef<Animation | null>(null);
  const pointer = useRef<{ id: number; x: number; y: number; dx: number; horizontal: boolean } | null>(null);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    if (!flight) return;
    const animations: Animation[] = [];
    let live = true;
    const count = flight.accounts.length;
    for (let position = 0; position < count; position++) {
      const card = flight.accounts[position]!;
      const node = nodes.current.get(card.id);
      if (!node) continue;
      const before = walletDeckIndex(position, -flight.from, count);
      const after = walletDeckIndex(position, -flight.to, count);
      if (before > 2 && after > 2) continue;
      const target = restingPose(after);
      if (before === 0) {
        // Start exactly at the released drag pose: no snap to the centre, no fade or replacement face.
        const side = -flight.direction;
        animations.push(node.animate([
          { transform: flight.start, zIndex: count + 1, boxShadow: "0 3px 8px rgb(0 0 0 / .12)", offset: 0 },
          { transform: `translate3d(${side * 18}px,-44px,90px) rotateX(22deg) rotateY(${side * -12}deg) rotateZ(${side * 3}deg) scale(.98)`, zIndex: count + 1, boxShadow: "0 24px 32px rgb(0 0 0 / .22)", offset: .34 },
          { transform: `translate3d(${side * 22}px,-52px,70px) rotateX(24deg) rotateY(${side * -10}deg) rotateZ(${side * 2}deg) scale(.96)`, zIndex: count + 1, boxShadow: "0 16px 22px rgb(0 0 0 / .16)", offset: .48 },
          { zIndex: count + 1, offset: .499 },
          { zIndex: count - after, offset: .5 },
          { transform: `translate3d(${side * 16}px,-48px,-70px) rotateX(18deg) rotateY(${side * -6}deg) rotateZ(0deg) scale(.94)`, zIndex: count - after, boxShadow: "0 6px 12px rgb(0 0 0 / .08)", offset: .64 },
          { transform: target, zIndex: count - after, boxShadow: "0 0 0 rgb(0 0 0 / 0)", offset: 1 },
        ], SHUFFLE));
      } else {
        animations.push(node.animate([
          { transform: restingPose(before), zIndex: count - before, offset: 0 },
          { transform: restingPose(before), zIndex: count - before, offset: .22 },
          { zIndex: count - before, offset: .499 },
          { zIndex: count - after, offset: .5 },
          { transform: target, zIndex: count - after, offset: 1 },
        ], SHUFFLE));
      }
    }
    const complete = () => {
      if (!live) return;
      setSelected(flight.accounts[flight.to]?.id ?? null);
      setFlight(null);
      busy.current = false;
    };
    void Promise.all(animations.map(animation => animation.finished)).then(complete).catch(() => {});
    return () => { live = false; animations.forEach(animation => animation.cancel()); };
  }, [flight]);

  useLayoutEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    settle.current?.cancel();
  }, []);

  function switchCard(direction: 1 | -1) {
    if (cards.length < 2 || busy.current) return;
    const target = walletDeckIndex(index, direction, cards.length);
    const node = nodes.current.get(active?.id ?? "");
    const start = node ? settle.current?.playState === "running" ? getComputedStyle(node).transform : node.style.transform : restingPose(0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (node) node.style.transform = restingPose(0);
      setSelected(cards[target]!.id);
      return;
    }
    busy.current = true;
    settle.current?.cancel();
    setFlight({ accounts: cards, from: index, to: target, direction, start });
  }
  function returnToStack() {
    const node = nodes.current.get(active?.id ?? "");
    if (!node) return;
    const from = node.style.transform;
    node.style.transform = restingPose(0);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) settle.current = node.animate([{ transform: from }, { transform: restingPose(0) }], SETTLE);
  }
  function movePointer(event: PointerEvent<HTMLDivElement>) {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId || busy.current) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.horizontal) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { pointer.current = null; returnToStack(); return; }
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
      start.horizontal = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    start.dx = dx;
    suppressClick.current = true;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const node = nodes.current.get(active?.id ?? "");
      if (node && pointer.current?.horizontal) {
        const x = Math.max(-64, Math.min(64, pointer.current.dx * .4));
        node.style.transform = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? `translateX(${x}px)` : draggingPose(x);
      }
    });
  }
  function endPointer(cancelled: boolean) {
    const start = pointer.current;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    pointer.current = null;
    if (!start?.horizontal) { if (start) returnToStack(); return; }
    if (!cancelled && Math.abs(start.dx) >= 40) switchCard(start.dx < 0 ? 1 : -1);
    else returnToStack();
  }

  if (!active) return null;
  return <>
    <div className={`home-wallet__deck ${flight ? "is-shuffling" : ""}`} data-count={cards.length} tabIndex={cards.length > 1 ? 0 : undefined} role="group" aria-roledescription="carousel" aria-label="Wallet accounts"
      onKeyDownCapture={() => { suppressClick.current = false; }}
      onKeyDown={event => { if (event.target === event.currentTarget && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); switchCard(event.key === "ArrowRight" ? 1 : -1); } }}
      onPointerDown={event => {
        suppressClick.current = false;
        if (!event.isPrimary || event.button !== 0 || cards.length < 2 || busy.current) return;
        const node = nodes.current.get(active.id);
        if (node && settle.current) { const current = getComputedStyle(node).transform; settle.current.cancel(); settle.current = null; node.style.transform = current; }
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, horizontal: false };
      }}
      onPointerMove={movePointer} onPointerUp={() => endPointer(false)} onPointerCancel={() => endPointer(true)}
      onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
      {cards.map((card, position) => {
        const depth = walletDeckIndex(position, -index, cards.length);
        const destination = flight ? walletDeckIndex(position, -flight.to, cards.length) : depth;
        const front = depth === 0;
        const faceVisible = front || !!flight && destination === 0;
        return <article key={card.id} ref={node => { if (node) nodes.current.set(card.id, node); else nodes.current.delete(card.id); }}
          className="home-wallet__card home-wallet__layer" data-depth={Math.min(depth, 2)} data-face-visible={faceVisible} data-visible={depth < 3 || !!flight && destination < 3}
          aria-hidden={!front} inert={!front || !!flight} style={{ transform: restingPose(depth), zIndex: cards.length - depth }}>
          {renderCard(card)}
        </article>;
      })}
    </div>
    <span className="sr-only" aria-live="polite" aria-atomic="true">{active.name}, wallet {index + 1} of {cards.length}{active.frozen ? ", frozen" : ""}</span>
    {cards.length > 1 ? <button type="button" className="home-wallet__switch" onClick={() => switchCard(1)} disabled={!!flight} aria-label="Show next wallet. You can also swipe across the cards.">Swipe to switch</button> : <Link className="home-wallet__switch" href="/wallet?tab=accounts">Manage accounts<ArrowRight size={16} aria-hidden /></Link>}
  </>;
}

