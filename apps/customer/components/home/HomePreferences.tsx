"use client";

import { BookOpen, BriefcaseBusiness, Check, EyeOff, RotateCcw, Route, ShieldCheck, ShoppingBag, Sparkles, UtensilsCrossed } from "lucide-react";
import { useEffect } from "react";
import { HOME_INTERESTS, type HomePreferences as Preferences, type HomeSuggestion } from "../../lib/personalized-home";
import { BottomDrawer } from "../BottomDrawer";
import { homeFont } from "./home-font";

const INTERESTS = {
  ride: { title: "Ride", detail: "Your everyday journeys", Icon: Route },
  buy: { title: "Shopping", detail: "Finds & essentials", Icon: ShoppingBag },
  eat: { title: "Food", detail: "Meals & local favourites", Icon: UtensilsCrossed },
  work: { title: "Help at home", detail: "A little less to do", Icon: BriefcaseBusiness },
  learn: { title: "Learning", detail: "Make room to grow", Icon: BookOpen },
};

export function HomePreferences({ open, onClose, preferences, suggestion, onSave }: {
  open: boolean; onClose: () => void; preferences: Preferences;
  suggestion?: HomeSuggestion; onSave: (next: Preferences) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = document.querySelector<HTMLElement>(".ph-preferences");
    if (!panel) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.querySelector<HTMLButtonElement>('button[aria-label="Close sheet"]')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    panel.addEventListener("keydown", trap);
    return () => { document.body.style.overflow = overflow; panel.removeEventListener("keydown", trap); previous?.focus(); };
  }, [open]);
  return <BottomDrawer isOpen={open} onClose={onClose} title="Your home" className={`ph-preferences ${homeFont.className}`}>
    <div className="ph-pref-intro"><span className="ph-pref-spark" aria-hidden><Sparkles size={23} /></span><div><p className="ph-pref-eyebrow">A little more you</p><p>Shape what shows up on your Home.</p></div></div>
    <div className="ph-pref-activity"><div className="ph-pref-activity-head"><span><b>Personal suggestions</b><small>Use my activity</small></span><button type="button" role="switch" aria-label="Use my activity" aria-checked={preferences.enabled} className="ph-pref-toggle" onClick={() => onSave({ ...preferences, enabled: !preferences.enabled })}><span /></button></div><p><ShieldCheck size={16} aria-hidden />Based on completed activity and the interests you choose.</p></div>
    <div className="ph-pref-section"><div><h3>What do you enjoy?</h3><span>{preferences.interests.length ? `${preferences.interests.length} selected` : "Choose a few"}</span></div><p>Keep your favourites close. Everything else stays open.</p></div>
    <div className="ph-pref-interests">{HOME_INTERESTS.map(interest => {
      const { title, detail, Icon } = INTERESTS[interest];
      const selected = preferences.interests.includes(interest);
      return <button type="button" key={interest} className="ph-pref-interest" aria-pressed={selected} onClick={() => onSave({ ...preferences, interests: selected ? preferences.interests.filter(item => item !== interest) : [...preferences.interests, interest] })}>
        <span className="ph-pref-interest-icon"><Icon size={25} strokeWidth={2} aria-hidden /></span><span className="ph-pref-interest-copy"><b>{title}</b><small>{detail}</small></span><span className="ph-pref-check" aria-hidden>{selected && <Check size={14} strokeWidth={3} />}</span>
      </button>;
    })}</div>
    {(suggestion || preferences.hidden.length > 0) && <div className="ph-pref-controls">
      {suggestion && <button type="button" onClick={() => { onSave({ ...preferences, hidden: [...preferences.hidden, suggestion.id] }); onClose(); }}><EyeOff size={18} aria-hidden /><span>Hide this suggestion</span></button>}
      {preferences.hidden.length > 0 && <button type="button" onClick={() => onSave({ ...preferences, hidden: [] })}><RotateCcw size={18} aria-hidden /><span>Restore hidden suggestions</span><small>{preferences.hidden.length}</small></button>}
    </div>}
    <div className="ph-pref-footer"><button type="button" className="ph-primary" onClick={onClose}>Done<Check size={20} aria-hidden /></button></div>
  </BottomDrawer>;
}
