"use client";
import {ShieldCheck} from "lucide-react";
import {useAuth} from "../../lib/auth-context";
import {useTranslate} from "../../lib/i18n";
import {ModuleOnly} from "../ModuleOnly";

export function Greeting({compact=false}:{compact?:boolean}) {
  const {user}=useAuth();
  const t=useTranslate();
  const firstName=user?.name?.trim().split(/\s+/)[0];
  return <header className={compact?"dh-greeting space-y-2":"space-y-3 pt-3"}>
    <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-ink">{t(compact?"greeting_hello":"greeting_welcome")}{firstName?`, ${firstName}`:""}</h1>
    {!compact&&<ModuleOnly any={["buy.shopping"]}><p className="text-[15px] leading-snug text-ink-500">{t("greeting_subtitle")}</p></ModuleOnly>}
    {!compact&&<ModuleOnly any={["ride","deliver","buy.shopping"]}><p className="flex items-center gap-1.5 text-sm font-medium text-green"><ShieldCheck size={16} aria-hidden/>{t("greeting_verified")}</p></ModuleOnly>}
  </header>;
}
