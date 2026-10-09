"use client";
import {ChevronDown,ChevronRight,Moon,Sun,User} from "lucide-react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect,useRef,useState} from "react";
import {isPracticeMode,type PlatformEnvironment} from "@peebee/shared";
import {useAuth} from "../lib/auth-context";
import {api} from "../lib/api";
import {useResolvedTheme,useThemeMode} from "../lib/theme";
import {BrandLogo} from "./BrandLogo";

const THEME_OPTIONS = [
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
] as const;

export function BrandHeader() {
  const {user}=useAuth();
  const pathname=usePathname();
  const {setMode}=useThemeMode();
  const activeTheme=useResolvedTheme();
  const [expanded,setExpanded]=useState(false);
  const toggleRef=useRef<HTMLButtonElement>(null);
  const [photo,setPhoto]=useState<string|null>(null);
  const [environment,setEnvironment]=useState<PlatformEnvironment|null>(null);
  const [practiceActive,setPracticeActive]=useState(false);
  const modeLabel=practiceActive?"*practice":environment==="sandbox"?"*demo":null;
  useEffect(()=>setExpanded(false),[pathname]);
  useEffect(()=>{
    const syncPractice=()=>setPracticeActive(isPracticeMode());
    syncPractice();
    window.addEventListener("storage",syncPractice);
    api.getSettings().then(({settings})=>setEnvironment(settings.platformEnvironment)).catch(()=>{});
    return()=>window.removeEventListener("storage",syncPractice);
  },[]);
  useEffect(()=>{setPhoto(null);if(!user?.id||!user.hasProfilePhoto)return;let disposed=false,url:string|undefined;api.userPhotoBlob(user.id).then(blob=>{if(disposed)return;url=URL.createObjectURL(blob);setPhoto(url);}).catch(()=>{});return()=>{disposed=true;if(url)URL.revokeObjectURL(url);};},[user]);
  return <header className="customer-header sticky top-0 z-40" onKeyDown={event=>{if(event.key==="Escape"){setExpanded(false);toggleRef.current?.focus();}}}>
    <div className="mx-auto flex h-16 max-w-lg items-center justify-between gap-3 px-4">
      <Link href="/" aria-label={`Go to home${modeLabel ? `, ${practiceActive ? "practice" : "demo"} mode` : ""}`} className="flex shrink-0 items-start gap-1"><BrandLogo variant={activeTheme === "dark" ? "light" : "dark"}/>{modeLabel&&<sup aria-hidden="true" className="pt-1 text-[10px] font-bold leading-none text-gold">{modeLabel}</sup>}</Link>
      <button ref={toggleRef} type="button" aria-label={expanded?"Close profile menu":"Open profile menu"} aria-expanded={expanded} aria-controls="header-profile" onClick={()=>setExpanded(value=>!value)} className="customer-header-toggle flex h-11 w-11 items-center justify-center rounded-full"><ChevronDown size={24} className={`transition-transform duration-300 ${expanded?"rotate-180":""}`} aria-hidden/></button>
    </div>
    <div id="header-profile" className={`customer-profile-reveal mx-auto grid max-w-lg ${expanded?"is-expanded":""}`} inert={!expanded} aria-hidden={!expanded}>
      <div className="min-h-0 overflow-hidden"><div className="space-y-3 px-4 pb-4">
        <Link href="/account" className="customer-profile-card flex min-h-24 items-center gap-4 rounded-3xl p-4" onClick={()=>setExpanded(false)}>
          <span className="customer-profile-avatar flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full">{photo?<img src={photo} alt="Your profile" className="h-full w-full object-cover"/>:<User size={26} aria-hidden/>}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-lg font-bold">{user?.name??"Your account"}</span><span className="customer-profile-muted mt-1 block text-sm">Manage your account</span></span><ChevronRight size={20} className="customer-profile-chevron shrink-0" aria-hidden/>
        </Link>
        <section className="customer-profile-appearance rounded-2xl px-3 py-3" aria-label="Appearance">
          <h2 className="customer-profile-muted mb-2 text-xs font-semibold">Appearance</h2>
          <div className="customer-profile-segmented grid grid-cols-2 gap-1 rounded-full p-1" role="group" aria-label="Color theme">
            {THEME_OPTIONS.map(({mode:optionMode,label,Icon})=>{
              const selected=activeTheme===optionMode;
              return <button key={optionMode} type="button" aria-pressed={selected} onClick={()=>setMode(optionMode)} className={`customer-profile-theme-option flex min-h-10 items-center justify-center gap-2 rounded-full px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-black focus-visible:outline-offset-2 ${selected?"is-selected":""}`}>
                <Icon size={17} strokeWidth={1.9} aria-hidden/>{label}
              </button>;
            })}
          </div>
        </section>
      </div></div>
    </div>
  </header>;
}
