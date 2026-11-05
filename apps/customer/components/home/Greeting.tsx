"use client";
import {MapPin,ShieldCheck} from "lucide-react";
import {useAuth} from "../../lib/auth-context";
import {useTranslate} from "../../lib/i18n";
import {useLocationLabel} from "../../lib/use-location-label";
import {ModuleOnly} from "../ModuleOnly";

export function Greeting({compact=false}:{compact?:boolean}) {
  const {user}=useAuth();
  const t=useTranslate();
  const {label,status}=useLocationLabel();
  const firstName=user?.name?.trim().split(/\s+/)[0];
  const location=status==="locating"?"Locating…":label??"Location unavailable";
  return <header className={compact?"dh-greeting space-y-2":"space-y-3 pt-3"}>
    <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-ink">{t(compact?"greeting_hello":"greeting_welcome")}{firstName?`, ${firstName}`:""}</h1>
    <span aria-label="Current location" className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] px-3 py-2"><MapPin size={15} className="shrink-0 text-gold" aria-hidden/><span className="truncate text-xs font-medium">{location}</span></span>
    {!compact&&<ModuleOnly any={["buy.shopping"]}><p className="text-[15px] leading-snug text-ink-500">{t("greeting_subtitle")}</p></ModuleOnly>}
    {!compact&&<ModuleOnly any={["ride","deliver","buy.shopping"]}><p className="flex items-center gap-1.5 text-sm font-medium text-green"><ShieldCheck size={16} aria-hidden/>{t("greeting_verified")}</p></ModuleOnly>}
  </header>;
}
