"use client";
import {Bell,ChevronDown,Languages,LogOut,MapPinned,MessagesSquare,Moon,Package,Settings,ShoppingBag,Sun,User,Wallet,type LucideIcon} from "lucide-react";
import Link from "next/link";
import {usePathname,useRouter} from "next/navigation";
import {useEffect,useRef,useState} from "react";
import {isPracticeMode,type PlatformEnvironment} from "@peebee/shared";
import {useAuth} from "../lib/auth-context";
import {api} from "../lib/api";
import {useCart} from "../lib/cart";
import {loadOrderFeed} from "../lib/order-feed";
import {useResolvedTheme,useThemeMode} from "../lib/theme";
import {useChatDrawer} from "../lib/chat-drawer";
import {useHomeMenu} from "../lib/home-menu";
import {useLanguage} from "../lib/i18n";
import {HeaderExtensionOutlet} from "../lib/header-extension";
import {drawerSectionForPath,pathForDrawerSection,useHeaderDrawer,} from "../lib/header-drawer";
import {BrandLogo} from "./BrandLogo";
import {useLocationLabel} from "../lib/use-location-label";
import {homeFont} from "./home/home-font";
import {SavedCartsList,useCartRows} from "./SavedCarts";

type MenuCounts={wallet:number|null;unreadChats:number;inProgress:number;attention:number};
const EMPTY_COUNTS:MenuCounts={wallet:null,unreadChats:0,inProgress:0,attention:0};

/** Live numbers for the menu, fetched each time it opens. Every source is
 * optional: a failed call simply leaves its badge off. */
async function loadMenuCounts():Promise<MenuCounts>{
  const [wallet,threads,restaurantThreads,feed,active]=await Promise.allSettled([
    api.getWallet(),api.getChatThreads(),api.getMyRestaurantChatThreads(),loadOrderFeed(),api.getActiveOrder(),
  ]);
  const unreadChats=(threads.status==="fulfilled"?threads.value.threads.filter(t=>t.unread).length:0)
    +(restaurantThreads.status==="fulfilled"?restaurantThreads.value.threads.filter(t=>t.unread).length:0);
  const feeProposal=active.status==="fulfilled"&&active.value.pendingFeeProposal?1:0;
  return {
    wallet:wallet.status==="fulfilled"?wallet.value.balance:null,
    unreadChats,
    inProgress:feed.status==="fulfilled"?feed.value.inProgress.length:0,
    attention:unreadChats+feeProposal,
  };
}

function badgeText(n:number){return n>99?"99+":String(n);}

function MenuTile({href,label,Icon,badge,badgeLabel,onNavigate}:{href:string;label:string;Icon:LucideIcon;badge?:number;badgeLabel?:string;onNavigate:()=>void}){
  const show=!!badge&&badge>0;
  return <Link href={href} onClick={onNavigate} aria-label={show?`${label}, ${badge} ${badgeLabel??"new"}`:label} className="customer-menu-tile flex flex-col items-center justify-center gap-2 rounded-2xl px-1 py-3 text-center">
    <span className="customer-menu-tile-icon relative flex h-11 w-11 items-center justify-center rounded-[14px]">
      <Icon size={21} strokeWidth={1.9} aria-hidden/>
      {show&&<span aria-hidden className="customer-menu-badge absolute -right-2 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-black tabular-nums leading-none">{badgeText(badge as number)}</span>}
    </span>
    <span className="text-[12.5px] font-semibold leading-tight">{label}</span>
  </Link>;
}

export function BrandHeader() {
  const {user,logout}=useAuth();
  const pathname=usePathname();
  const router=useRouter();
  const drawer=useHeaderDrawer();
  const expanded=drawer.mode==="menu";
  const {language,setLanguage}=useLanguage();
  const home=pathname==="/";
  const {label:locationLabel,status:locationStatus}=useLocationLabel(home);
  const {setMode}=useThemeMode();
  const activeTheme=useResolvedTheme();
  const {totalQuantity:cartCount}=useCart();
  const chat=useChatDrawer();
  const chatEnabled=useHomeMenu().header.chatEnabled;
  const [chatUnread,setChatUnread]=useState(false);
  // Every cart on this device (the bag, each restaurant's, the earlier ones), re-read each time the menu opens.
  const cartRows=useCartRows(expanded);
  const openCarts=cartRows.some(row=>row.kind!=="earlier");
  const toggleRef=useRef<HTMLButtonElement>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  const releaseTimer=useRef<number|undefined>(undefined);
  const [photo,setPhoto]=useState<string|null>(null);
  const [counts,setCounts]=useState<MenuCounts>(EMPTY_COUNTS);
  const [environment,setEnvironment]=useState<PlatformEnvironment|null>(null);
  const [practiceActive,setPracticeActive]=useState(false);
  // Practice is shown by the shared blue border + "Practice mode" tab, not a header label.
  const modeLabel=!practiceActive&&environment==="sandbox"?"*demo":null;
  const isDark=activeTheme==="dark";
  const close=()=>drawer.close();
  useEffect(()=>{if(chat.open && drawer.mode!=="closed") drawer.close();},[chat.open, drawer]);

  // A dot on the chat icon when any conversation has something unread. Quiet on failure: the icon just shows no dot.
  useEffect(()=>{
    if(!chatEnabled||chat.open)return;
    let live=true;
    Promise.allSettled([api.getChatThreads(),api.getMyRestaurantChatThreads()]).then(([riders,restaurants])=>{
      if(!live)return;
      setChatUnread((riders.status==="fulfilled"&&riders.value.threads.some(t=>t.unread))||(restaurants.status==="fulfilled"&&restaurants.value.threads.some(t=>t.unread)));
    });
    return()=>{live=false;};
  },[chatEnabled,chat.open]);
  useEffect(()=>{
    const walletSection=drawerSectionForPath(pathname);
    if(walletSection){
      drawer.openSection(walletSection);
      return;
    }
    // Leave the first-drop menu open when Back from Wallet returns home.
    if(drawer.mode==="menu") return;
    if(drawer.mode==="section" && drawer.section && pathForDrawerSection(drawer.section)===pathname) return;
    if(drawer.mode!=="closed") drawer.close();
  },[pathname, drawer]);
  useEffect(()=>()=>{window.clearTimeout(releaseTimer.current);document.documentElement.classList.remove("customer-menu-open","customer-section-open");},[]);
  useEffect(()=>{
    const root=document.documentElement;
    root.classList.toggle("customer-section-open", drawer.mode==="section");
    return()=>root.classList.remove("customer-section-open");
  },[drawer.mode]);
  useEffect(()=>{
    const syncPractice=()=>setPracticeActive(isPracticeMode());
    syncPractice();
    window.addEventListener("storage",syncPractice);
    api.getSettings().then(({settings})=>setEnvironment(settings.platformEnvironment)).catch(()=>{});
    return()=>window.removeEventListener("storage",syncPractice);
  },[]);
  useEffect(()=>{setPhoto(null);if(!user?.id||!user.hasProfilePhoto)return;let disposed=false,url:string|undefined;api.userPhotoBlob(user.id).then(blob=>{if(disposed)return;url=URL.createObjectURL(blob);setPhoto(url);}).catch(()=>{});return()=>{disposed=true;if(url)URL.revokeObjectURL(url);};},[user]);
  useEffect(()=>{
    if(!expanded)return;
    let cancelled=false;
    loadMenuCounts().then(next=>{if(!cancelled)setCounts(next);}).catch(()=>{});
    // Move focus into the menu so keyboard and screen-reader users land on it.
    const focusTimer=window.setTimeout(()=>menuRef.current?.querySelector<HTMLElement>("a,button")?.focus({preventScroll:true}),60);
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape"){close();toggleRef.current?.focus();}};
    window.addEventListener("keydown",onKey);
    // The screen is pushed down, not covered: keep it visible but out of
    // reach (no taps, no keyboard focus) until the menu closes again.
    const root=document.documentElement;
    const screen=document.querySelector("main");
    window.clearTimeout(releaseTimer.current);
    root.classList.add("customer-menu-open");
    screen?.setAttribute("inert","");
    return()=>{
      cancelled=true;window.clearTimeout(focusTimer);window.removeEventListener("keydown",onKey);screen?.removeAttribute("inert");
      // Hold scroll anchoring off until the screen has slid back up, or the
      // browser "compensates" for the collapse and jumps the page to the top.
      releaseTimer.current=window.setTimeout(()=>root.classList.remove("customer-menu-open"),420);
    };
  },[expanded]);
  const walletJoined=pathname==="/wallet"||pathname.startsWith("/wallet/");
  return <>
    <header className={`customer-header sticky top-0 z-40 ${home?`ph-header ${homeFont.className}`:""} ${expanded?"is-menu-open":""} ${drawer.mode==="section"?"is-section-open":""} ${walletJoined||drawer.section==="wallet"?"is-wallet-joined":""}`}>
      <div className="mx-auto flex h-16 max-w-lg items-center justify-between gap-3 px-4">
        <Link href="/" aria-label={`Go to home${modeLabel ? ", demo mode" : ""}`} className={home?"ph-brand-link min-w-0":"flex shrink-0 items-start gap-1"}><span className="flex items-start gap-1"><BrandLogo variant={home ? "light" : isDark ? "dark" : "light"}/>{modeLabel&&<sup aria-hidden="true" className="pt-1 text-[10px] font-bold leading-none text-gold">{modeLabel}</sup>}</span>{home&&<span className="ph-header-location" aria-label="Current detected location"><MapPinned size={14} aria-hidden/><span>{locationStatus==="locating"?"Locating…":locationLabel??"Location unavailable"}</span></span>}</Link>
        <div className="flex shrink-0 items-center gap-1">
          <button ref={toggleRef} type="button" aria-label={expanded||drawer.mode!=="closed"?"Close menu":"Open menu"} aria-expanded={expanded||drawer.mode!=="closed"} aria-controls="header-menu" onClick={()=>{ if(expanded||drawer.mode!=="closed"){ close(); toggleRef.current?.focus(); } else { drawer.openMenu(); } }} className="customer-header-toggle relative flex h-11 w-11 items-center justify-center rounded-full">
            <ChevronDown size={24} aria-hidden/>
            {!expanded&&(cartCount>0||openCarts)&&<span aria-hidden className="customer-header-dot absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full"/>}
          </button>
          {chatEnabled&&<button type="button" aria-label={chatUnread?"Open chat, unread messages":"Open chat"} aria-expanded={chat.open} aria-controls="chat-drawer" onClick={chat.openChat} className="customer-header-toggle relative flex h-11 w-11 items-center justify-center rounded-full">
            <MessagesSquare size={22} aria-hidden/>
            {chatUnread&&<span aria-hidden className="customer-header-dot absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full"/>}
          </button>}
        </div>
      </div>
      <div id="header-menu" className={`customer-profile-reveal customer-menu-reveal mx-auto grid max-w-lg ${expanded?"is-expanded":""}`} inert={!expanded} aria-hidden={!expanded}>
        <div className="min-h-0 overflow-hidden">
          <nav ref={menuRef} aria-label="Account menu" className="customer-menu-sheet space-y-3 px-4 pb-5 pt-4">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="customer-menu-tile customer-menu-tile-lg flex flex-col items-center justify-center gap-2 rounded-[28px] px-2 py-5 text-center" onClick={()=>{ drawer.openSection("profile"); router.push(pathForDrawerSection("profile")); }}>
                <span className="customer-menu-tile-icon relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-[18px]">{photo?<img src={photo} alt="" className="h-full w-full object-cover"/>:<User size={26} strokeWidth={1.8} aria-hidden/>}</span>
                <span className="text-[12.5px] font-semibold leading-tight">Profile</span>
              </button>
              <button type="button" className="customer-menu-tile customer-menu-tile-lg flex flex-col items-center justify-center gap-2 rounded-[28px] px-2 py-5 text-center" onClick={()=>{ drawer.openSection("wallet"); router.push(pathForDrawerSection("wallet")); }}>
                <span className="customer-menu-tile-icon relative flex h-14 w-14 items-center justify-center rounded-[18px]"><Wallet size={26} strokeWidth={1.8} aria-hidden/></span>
                <span className="text-[12.5px] font-semibold leading-tight">Wallet</span>
                <span className="customer-menu-muted max-w-full truncate text-[11px] font-bold tabular-nums">{counts.wallet==null?"Balance":`UGX ${counts.wallet.toLocaleString("en-UG")}`}</span>
              </button>
              <button type="button" className="customer-menu-tile customer-menu-tile-lg flex flex-col items-center justify-center gap-2 rounded-[28px] px-2 py-5 text-center" onClick={()=>{ drawer.openSection("notifications"); router.push(pathForDrawerSection("notifications")); }}>
                <span className="customer-menu-tile-icon relative flex h-14 w-14 items-center justify-center rounded-[18px]">
                  <Bell size={26} strokeWidth={1.8} aria-hidden/>
                  {counts.attention>0&&<span aria-hidden className="customer-menu-badge absolute -right-2 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-black tabular-nums leading-none">{badgeText(counts.attention)}</span>}
                </span>
                <span className="text-[12.5px] font-semibold leading-tight">Notifications</span>
              </button>
              <button type="button" className="customer-menu-tile customer-menu-tile-lg flex flex-col items-center justify-center gap-2 rounded-[28px] px-2 py-5 text-center" onClick={()=>{ drawer.openSection("settings"); router.push(pathForDrawerSection("settings")); }}>
                <span className="customer-menu-tile-icon relative flex h-14 w-14 items-center justify-center rounded-[18px]"><Settings size={26} strokeWidth={1.8} aria-hidden/></span>
                <span className="text-[12.5px] font-semibold leading-tight">Settings</span>
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <MenuTile href="/cart" label="Cart" Icon={ShoppingBag} badge={cartCount} badgeLabel={cartCount===1?"item":"items"} onNavigate={close}/>
              <MenuTile href="/orders/history" label="Orders" Icon={Package} onNavigate={close}/>
              <MenuTile href="/track" label="Track" Icon={MapPinned} badge={counts.inProgress} badgeLabel="on the way" onNavigate={close}/>
              <MenuTile href="/chat" label="Chat" Icon={MessagesSquare} badge={counts.unreadChats} badgeLabel="unread" onNavigate={close}/>
            </div>
            <SavedCartsList rows={cartRows} onNavigate={close}/>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" role="switch" aria-checked={isDark} onClick={()=>setMode(isDark?"light":"dark")} className="customer-menu-row customer-menu-theme flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-[22px] px-2 py-3 text-center">
                <span className="customer-menu-tile-icon flex h-9 w-9 items-center justify-center rounded-xl">{isDark?<Moon size={18} strokeWidth={1.9} aria-hidden/>:<Sun size={18} strokeWidth={1.9} aria-hidden/>}</span>
                <span className="text-[12.5px] font-semibold">{isDark?"Dark":"Light"}</span>
                <span aria-hidden className={`customer-menu-switch relative h-6 w-10 rounded-full ${isDark?"is-on":""}`}><span className="customer-menu-switch-knob absolute left-0.5 top-0.5 h-5 w-5 rounded-full"/></span>
              </button>
              <button type="button" onClick={()=>setLanguage(language==="en"?"lg":"en")} className="customer-menu-row customer-menu-theme flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-[22px] px-2 py-3 text-center">
                <span className="customer-menu-tile-icon flex h-9 w-9 items-center justify-center rounded-xl"><Languages size={18} strokeWidth={1.9} aria-hidden/></span>
                <span className="text-[12.5px] font-semibold">Language</span>
                <span className="text-[11px] font-bold opacity-60">{language==="en"?"EN":"LG"}</span>
              </button>
              <button type="button" onClick={()=>{ close(); logout(); }} className="customer-menu-row customer-menu-theme flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-[22px] px-2 py-3 text-center">
                <span className="customer-menu-tile-icon flex h-9 w-9 items-center justify-center rounded-xl"><LogOut size={18} strokeWidth={1.9} aria-hidden/></span>
                <span className="text-[12.5px] font-semibold">Sign out</span>
              </button>
            </div>
          </nav>
        </div>
      </div>
      <HeaderExtensionOutlet />
    </header>
    {/* The pushed-down screen below the menu: one tap anywhere on it closes the menu. */}
    <div aria-hidden className={`customer-menu-catcher fixed inset-0 z-30 ${expanded?"is-active":""}`} onClick={close}/>
  </>;
}
