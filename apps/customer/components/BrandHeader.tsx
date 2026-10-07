"use client";
import {ChevronDown,ChevronRight,User} from "lucide-react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect,useRef,useState} from "react";
import {useAuth} from "../lib/auth-context";
import {api} from "../lib/api";
import {BrandLogo} from "./BrandLogo";

export function BrandHeader() {
  const {user}=useAuth();
  const pathname=usePathname();
  const [expanded,setExpanded]=useState(false);
  const toggleRef=useRef<HTMLButtonElement>(null);
  const [photo,setPhoto]=useState<string|null>(null);
  useEffect(()=>setExpanded(false),[pathname]);
  useEffect(()=>{setPhoto(null);if(!user?.id||!user.hasProfilePhoto)return;let disposed=false,url:string|undefined;api.userPhotoBlob(user.id).then(blob=>{if(disposed)return;url=URL.createObjectURL(blob);setPhoto(url);}).catch(()=>{});return()=>{disposed=true;if(url)URL.revokeObjectURL(url);};},[user]);
  return <header className="customer-header sticky top-0 z-40" onKeyDown={event=>{if(event.key==="Escape"){setExpanded(false);toggleRef.current?.focus();}}}>
    <div className="mx-auto flex h-16 max-w-lg items-center justify-between gap-3 px-4">
      <Link href="/" aria-label="Go to home" className="shrink-0"><BrandLogo inverse/></Link>
      <button ref={toggleRef} type="button" aria-label={expanded?"Close profile menu":"Open profile menu"} aria-expanded={expanded} aria-controls="header-profile" onClick={()=>setExpanded(value=>!value)} className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 hover:bg-white/10"><ChevronDown size={24} className={`transition-transform duration-300 ${expanded?"rotate-180":""}`} aria-hidden/></button>
    </div>
    <div id="header-profile" className={`customer-profile-reveal mx-auto grid max-w-lg ${expanded?"is-expanded":""}`} inert={!expanded} aria-hidden={!expanded}>
      <div className="min-h-0 overflow-hidden"><div className="px-4 pb-4">
        <Link href="/account" className="customer-profile-card flex min-h-24 items-center gap-4 rounded-3xl p-4" onClick={()=>setExpanded(false)}>
          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10">{photo?<img src={photo} alt="Your profile" className="h-full w-full object-cover"/>:<User size={26} aria-hidden/>}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-lg font-bold">{user?.name??"Your account"}</span><span className="mt-1 block text-sm text-white/65">Manage your account</span></span><ChevronRight size={20} className="shrink-0 text-gold" aria-hidden/>
        </Link>
      </div></div>
    </div>
  </header>;
}
