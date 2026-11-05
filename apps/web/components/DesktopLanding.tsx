"use client";
import { HomeAbout } from "./HomeAbout";
import { Fragment } from "react";

import Link from "next/link";
import { PartnerLink } from "./PartnerLink";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, ArrowUpRight, BadgeCheck, KeyRound, Lock, ShieldCheck, Replace, Pill, Wallet, Smartphone, Handshake, Sparkles,
} from "lucide-react";
import { useDoors, type DoorId } from "../lib/doors";
import { moduleOfHref, moduleOfPartner } from "../lib/module-map";
import { useWebModules } from "../lib/web-modules";
import { ModuleShow } from "./ModuleNotice";
import { subPath } from "../lib/pages";
import { ALSO_IN_ACCOUNT, APP_URL, DOOR_CONTENT, ORDER_PATH, WALLET_NOTE } from "../lib/content";
import { FEATURED_PARTNERS, PARTNER_TYPE_BY_SLUG } from "../lib/partners";

const PARTNERS = FEATURED_PARTNERS.map((s) => PARTNER_TYPE_BY_SLUG[s]);
import { PHOTOS } from "../lib/photos";
import { useShell } from "./ShellContext";

/** Real screens from the live customer app (app.peebee.online, practice mode, no account). Balances are blurred. */
const SHOT: Record<DoorId | "home" | "wallet" | "track", string> = {
  home: "/app-shots/home.webp", ride: "/app-shots/ride.webp", buy: "/app-shots/buy.webp", eat: "/app-shots/eat.webp",
  learn: "/app-shots/learn.webp", hive: "/app-shots/work.webp", wallet: "/app-shots/wallet.webp", track: "/app-shots/track.webp",
};
const SHOT_ALT = "A screen from the Peebee customer app";

/** The scrolling words, each tied to the Admin → Services module it names (none: always shown). A switched-off module's words leave the strip. */
const MARQUEE: { word: string; module?: string }[] = [
  { word: "Boda", module: "ride.boda" }, { word: "Cars", module: "ride.car" }, { word: "TaxiPress", module: "ride.taxipress" }, { word: "The List", module: "buy.shopping" },
  { word: "Stores", module: "buy.marketplace" }, { word: "Groceries", module: "buy.shopping" }, { word: "Spotlight", module: "channels" }, { word: "Restaurants", module: "buy.food" },
  { word: "Home kitchens", module: "buy.food" }, { word: "Rolex", module: "buy.food" }, { word: "Juice bars", module: "buy.food" }, { word: "Bakeries", module: "buy.food" },
  { word: "Sprouts", module: "learn" }, { word: "Foundations", module: "learn" }, { word: "Academy", module: "learn" }, { word: "Compass", module: "learn" }, { word: "Skills", module: "learn" },
  { word: "Clean", module: "hive.work" }, { word: "Laundry", module: "hive.work" }, { word: "Fix", module: "hive.work" }, { word: "Pharmacy", module: "buy.pharmacy" },
  { word: "Parcels", module: "deliver.parcel" }, { word: "Wallet" },
];
const COUNT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five"];

function reduced() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Phone({ src, alt, className = "", priority = false }: { src: string; alt: string; className?: string; priority?: boolean }) {
  return (
    <div className={`dl-phone ${className}`}>
      <span className="dl-phone-btn a" /><span className="dl-phone-btn b" /><span className="dl-phone-btn c" />
      <div className="dl-phone-glass">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} width={764} height={1672} loading={priority ? "eager" : "lazy"} decoding="async" />
        <span className="dl-island" />
      </div>
    </div>
  );
}

function Lines({ text, as: Tag = "h2", className = "" }: { text: string; as?: "h1" | "h2"; className?: string }) {
  const words = text.split(" ");
  return (
    <Tag className={`dl-lines ${className}`} aria-label={text} data-reveal>
      {words.map((w, i) => (
        <Fragment key={i}><span className="dl-w" aria-hidden><span style={{ transitionDelay: `${i * 45}ms` }}>{w}</span></span>{" "}</Fragment>
      ))}
    </Tag>
  );
}

function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(to);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    setN(0);
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / 1100);
        setN(Math.round(to * (1 - Math.pow(1 - k, 3))));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to]);
  return <span ref={ref} className="dl-num">{n}{suffix}</span>;
}

export function DesktopLanding() {
  const doors = useDoors();
  const modules = useWebModules();
  const { scroller, openDoor, openFeature } = useShell();
  const root = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLElement>(null);
  const path = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [heroIdx, setHeroIdx] = useState(0);

  // Hero photos cycle (paused when hidden or reduced motion).
  useEffect(() => {
    if (reduced()) return;
    const id = setInterval(() => { if (!document.hidden) setHeroIdx((i) => (i + 1) % doors.length); }, 5200);
    return () => clearInterval(id);
  }, [doors.length]);

  // Reveal on enter.
  useEffect(() => {
    const el = root.current;
    const sc = scroller.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>("[data-reveal]");
    if (reduced()) { items.forEach((x) => x.setAttribute("data-in", "")); return; }
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { e.target.setAttribute("data-in", ""); io.unobserve(e.target); }
    }, { root: sc, rootMargin: "0px 0px -12% 0px", threshold: 0.12 });
    items.forEach((x) => io.observe(x));
    // Pause ambient animation offscreen.
    const amb = new IntersectionObserver((es) => {
      for (const e of es) e.target.toggleAttribute("data-play", e.isIntersecting);
    }, { root: sc });
    el.querySelectorAll("[data-ambient]").forEach((x) => amb.observe(x));
    return () => { io.disconnect(); amb.disconnect(); };
  }, [scroller, doors]);

  // Scroll-driven values: written as CSS variables, no React renders except the pinned door index.
  useEffect(() => {
    const sc = scroller.current;
    const el = root.current;
    if (!sc || !el) return;
    const still = reduced();
    let raf = 0;
    let last = -1;
    const run = () => {
      raf = 0;
      const vh = sc.clientHeight;
      if (!still) el.style.setProperty("--sy", String(sc.scrollTop));
      const p = pin.current;
      if (p) {
        const r = p.getBoundingClientRect();
        const top = r.top - sc.getBoundingClientRect().top;
        const span = Math.max(1, p.offsetHeight - vh);
        const prog = Math.min(1, Math.max(0, -top / span));
        p.style.setProperty("--pp", prog.toFixed(4));
        const idx = Math.min(doors.length - 1, Math.floor(prog * doors.length * 0.9999));
        if (idx !== last) { last = idx; setActive(idx); }
      }
      if (!still) el.querySelectorAll<HTMLElement>("[data-prog]").forEach((x) => {
        const r = x.getBoundingClientRect();
        const c = (r.top + r.height / 2 - sc.getBoundingClientRect().top - vh / 2) / vh;
        x.style.setProperty("--c", Math.max(-1.5, Math.min(1.5, c)).toFixed(4));
      });
      const pa = path.current;
      if (pa && !still) {
        const r = pa.getBoundingClientRect();
        const top = r.top - sc.getBoundingClientRect().top;
        const prog = Math.min(1, Math.max(0, (vh * 0.85 - top) / (r.height + vh * 0.2)));
        pa.style.setProperty("--lp", prog.toFixed(4));
      }
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(run); };
    run();
    sc.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { sc.removeEventListener("scroll", on); window.removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, [scroller, doors.length]);

  // Gentle pointer tilt for the hero devices.
  const tilt = useRef<HTMLDivElement>(null);
  function onMove(e: React.PointerEvent) {
    if (reduced() || !tilt.current) return;
    const r = tilt.current.getBoundingClientRect();
    tilt.current.style.setProperty("--rx", ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    tilt.current.style.setProperty("--ry", ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
  }

  function jumpTo(i: number) {
    const sc = scroller.current;
    const p = pin.current;
    if (!sc || !p) return;
    const span = p.offsetHeight - sc.clientHeight;
    const top = p.offsetTop + span * ((i + 0.5) / doors.length);
    sc.scrollTo({ top, behavior: reduced() ? "auto" : "smooth" });
  }

  const cur = doors[active] ?? doors[0];

  return (
    <div className="dl" ref={root}>
      {/* ───── hero ───── */}
      <section className="dl-hero" aria-labelledby="dl-h1" onPointerMove={onMove}>
        <div className="dl-aurora" data-ambient aria-hidden>
          <i className="o1" /><i className="o2" /><i className="o3" /><i className="o4" />
          <svg className="dl-lines-bg" viewBox="0 0 1200 800" preserveAspectRatio="none"><path d="M-50 620 C 250 480, 450 760, 760 560 S 1150 380, 1300 470" /><path d="M-50 700 C 300 560, 520 820, 820 640 S 1180 480, 1300 560" /></svg>
          <span className="dl-grain" />
        </div>
        <div className="dl-wrap dl-hero-grid">
          <div className="dl-hero-copy">
            <p className="dl-pill" data-reveal><Sparkles size={14} aria-hidden /> One account. One wallet. {COUNT_WORDS[doors.length] ?? doors.length} {doors.length === 1 ? "door" : "doors"}.</p>
            <Lines as="h1" text="Everything Kampala does in a day, in one app." className="dl-h1" />
            <p className="dl-sub" data-reveal style={{ transitionDelay: "260ms" }}>
              Ride across town, send the list to the market, order dinner from a kitchen you love, sit a class, get the house cleaned. Pay once from a wallet that holds the money until the job is done.
            </p>
          </div>
          <div className="dl-hero-stage" ref={tilt} aria-hidden>
            <div className="dl-float dl-float-back"><Phone src={SHOT.wallet} alt="" /></div>
            <div className="dl-float dl-float-front"><Phone src={SHOT.home} alt="" priority /></div>
            <div className="dl-chip dl-chip-a"><Lock size={16} /> <span><b>Held in escrow</b><small>Released at the PIN</small></span></div>
            <div className="dl-chip dl-chip-b"><KeyRound size={16} /> <span><b>PIN · • • • •</b><small>Handover</small></span></div>
          </div>
        </div>
        <div className="dl-scrollcue" aria-hidden><span /></div>
      </section>

      {/* ───── marquee ───── */}
      <div className="dl-marquee" data-ambient aria-hidden>
        <div className="dl-marquee-track">
          {[0, 1].map((k) => (
            <span key={k}>{MARQUEE.filter((m) => !m.module || modules.on(m.module)).map((m) => <em key={m.word}>{m.word}</em>)}</span>
          ))}
        </div>
      </div>

      {/* ───── five doors, pinned: photo stays, phone alternates sides ───── */}
      <section className="dl-doors" ref={pin} style={{ "--n": doors.length } as React.CSSProperties} aria-labelledby="dl-doors-h">
        <div className="dl-pin">
          <div className="dl-wrap dl-pin-grid">
            <div className="dl-pin-copy">
              <h2 id="dl-doors-h" className="dl-h2">{COUNT_WORDS[doors.length] ?? doors.length} {doors.length === 1 ? "door" : "doors"}, one account.</h2>
              <ul className="dl-doortabs" role="tablist" aria-label="The doors">
                {doors.map((d, i) => {
                  const C = DOOR_CONTENT[d.id].icon;
                  return (
                    <li key={d.id}>
                      <button type="button" role="tab" aria-selected={i === active} className={`dl-btn ${i === active ? "dl-btn-gold" : "dl-btn-ghost"}`} data-on={i === active || undefined} onClick={() => jumpTo(i)}><C size={15} aria-hidden /> {d.label}</button>
                    </li>
                  );
                })}
              </ul>
              <div className="dl-pin-texts">
                {doors.map((d, i) => (
                  <div key={d.id} className="dl-pin-text" data-on={i === active || undefined} aria-hidden={i !== active}>
                    <p className="dl-pin-num">0{i + 1} / 0{doors.length}</p>
                    <h3>{DOOR_CONTENT[d.id].heroTitle}</h3>
                    <p>{DOOR_CONTENT[d.id].lead}</p>
                    <button type="button" className="dl-link" onClick={() => openDoor(d.id)} tabIndex={i === active ? 0 : -1}>Open {d.label} <ArrowRight size={16} aria-hidden /></button>
                  </div>
                ))}
              </div>
            </div>
            <div className="dl-pin-stage" data-side={active % 2 ? "left" : "right"}>
              <div className="dl-pin-photo" aria-hidden>
                {doors.map((d, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={d.id} src={PHOTOS[d.id].hero} alt="" loading={i === 0 ? "eager" : "lazy"} data-on={i === active || undefined} />
                ))}
              </div>
              <div className="dl-pin-phone">
                {doors.map((d, i) => (
                  <div key={d.id} className="dl-pin-shot" data-on={i === active || undefined}>
                    <Phone src={SHOT[d.id]} alt={`${SHOT_ALT}: ${d.label}`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───── order path ───── */}
      <section className="dl-path" ref={path} aria-labelledby="dl-path-h">
        <div className="dl-wrap">
          <p className="dl-kicker" data-reveal>How every order moves</p>
          <Lines text="Six steps. The same for a boda, a basket or a lesson." className="dl-h2 dl-center" />
          <ol className="dl-timeline">
            <span className="dl-tl-line" aria-hidden><span /></span>
            {ORDER_PATH.map((s, i) => (
              <li key={s.name} data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
                <span className="dl-tl-dot">{i + 1}</span>
                <b>{s.name}</b>
                <small>{s.text}</small>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ───── about ───── */}
      <HomeAbout desk />

      {/* ───── also in account ───── */}
      <section className="dl-also" aria-labelledby="dl-also-h">
        <div className="dl-wrap">
          <p className="dl-kicker" data-reveal>Also in your account</p>
          <Lines text="Medicine, parcels and money, under the same login." className="dl-h2" />
          <ul className="dl-cards3">
            {ALSO_IN_ACCOUNT.map((a, i) => (
              <ModuleShow key={a.title} module={moduleOfHref(a.href)}><li data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
                {a.feature ? (
                  <button type="button" onClick={() => openFeature(a.feature!)} aria-haspopup="dialog">
                    <span className="dl-ic"><a.icon size={20} aria-hidden /></span>
                    <b>{a.title}</b>
                    <small>{a.text}</small>
                    <span className="dl-more">Read more <ArrowUpRight size={15} aria-hidden /></span>
                  </button>
                ) : (
                  <Link href={a.href}>
                    <span className="dl-ic"><a.icon size={20} aria-hidden /></span>
                    <b>{a.title}</b>
                    <small>{a.text}</small>
                    <span className="dl-more">Read more <ArrowUpRight size={15} aria-hidden /></span>
                  </Link>
                )}
              </li></ModuleShow>
            ))}
          </ul>
        </div>
      </section>

      {/* ───── partners ───── */}
      <section className="dl-partners" aria-labelledby="dl-partners-h">
        <div className="dl-wrap">
          <div className="dl-partners-head">
            <div>
              <p className="dl-kicker" data-reveal><Handshake size={16} aria-hidden /> Partners</p>
              <Lines text="You already cook, sell, ride or teach. Bring it." className="dl-h2" />
            </div>
            <p className="dl-lead" data-reveal>You keep your own app. Your customers stay in theirs. The money moves when the work is done.</p>
          </div>
          <ul className="dl-pgrid">
            {PARTNERS.map((p, i) => (
              <ModuleShow key={p.slug} module={moduleOfPartner(p.slug, p.door)}><li data-reveal style={{ transitionDelay: `${(i % 4) * 80}ms` }} data-closed={p.closed || undefined}>
                <PartnerLink href={`/partners/${p.slug}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.photo} alt="" loading="lazy" />
                  <span className="dl-pshade" />
                  <span className="dl-ptext">
                    <span className="dl-pname"><p.icon size={16} aria-hidden /> {p.name}{p.closed && <em>Not open</em>}</span>
                    <small>{p.who}</small>
                  </span>
                  <ArrowUpRight size={18} className="dl-parrow" aria-hidden />
                </PartnerLink>
              </li></ModuleShow>
            ))}
            <li className="dl-pcta" data-reveal>
              <PartnerLink href="/partners">
                <b>All partner apps</b>
                <small>A dedicated page for every kind of partner, from taxis to bakeries.</small>
                <span className="dl-more">See them <ArrowRight size={15} aria-hidden /></span>
              </PartnerLink>
            </li>
          </ul>
        </div>
      </section>

      {/* ───── trust ───── */}
      <section className="dl-trust" aria-label="Trust and safety">
        <div className="dl-wrap">
          <ul>
            {[
              { i: BadgeCheck, t: "Verified riders", s: "Checked before the first job." },
              { i: Lock, t: "Escrow on every order", s: "Held, not spent, until handover." },
              { i: KeyRound, t: "Four-digit PIN", s: "Nothing settles without it." },
              { i: Replace, t: "You approve swaps", s: "A substitute waits for your yes." },
              { i: Pill, t: "Licensed pharmacies", s: "Licensed with the NDA." },
              { i: ShieldCheck, t: "Written twice", s: "Every wallet movement, double-entry." },
            ].map((x, k) => (
              <li key={x.t} data-reveal style={{ transitionDelay: `${k * 60}ms` }}>
                <x.i size={20} aria-hidden /><span><b>{x.t}</b><small>{x.s}</small></span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ───── closing ───── */}
      <section className="dl-close" aria-labelledby="dl-close-h">
        <div className="dl-aurora" data-ambient aria-hidden><i className="o1" /><i className="o4" /></div>
        <div className="dl-wrap dl-close-in">
          <Lines text="Phone in hand? Start with a door." className="dl-h2 dl-center dl-h2-xl" />
          <div className="dl-ctas dl-center-row" data-reveal>
            <a href={APP_URL} className="dl-btn dl-btn-gold">Download the app <ArrowUpRight size={18} aria-hidden /></a>
            <PartnerLink href="/partners" className="dl-btn dl-btn-ghost">Become a partner</PartnerLink>
          </div>
        </div>
      </section>
    </div>
  );
}
