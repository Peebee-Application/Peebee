"use client";
import {Bell,ChevronDown,ChevronRight,MapPinned,MessagesSquare,Moon,Package,Settings,ShoppingBag,Sun,User,Wallet,type LucideIcon} from "lucide-react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect,useRef,useState} from "react";
import {isPracticeMode,type PlatformEnvironment} from "@peebee/shared";
import {useAuth} from "../lib/auth-context";
import {api} from "../lib/api";
import {useCart} from "../lib/cart";
import {loadOrderFeed} from "../lib/order-feed";
import {useResolvedTheme,useThemeMode} from "../lib/theme";
import {useChatDrawer} from "../lib/chat-drawer";
import {useHomeMenu} from "../lib/home-menu";
import {HeaderExtensionOutlet} from "../lib/header-extension";
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
  const {user}=useAuth();
  const pathname=usePathname();
  const home=pathname==="/";
  const {label:locationLabel,status:locationStatus}=useLocationLabel(home);
  const {setMode}=useThemeMode();
  const activeTheme=useResolvedTheme();
  const {totalQuantity:cartCount}=useCart();
  const [expanded,setExpanded]=useState(false);
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
  const close=()=>setExpanded(false);
  useEffect(()=>{if(chat.open)setExpanded(false);},[chat.open]);
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
  useEffect(()=>setExpanded(false),[pathname]);
  useEffect(()=>()=>{window.clearTimeout(releaseTimer.current);document.documentElement.classList.remove("customer-menu-open");},[]);
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
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape"){setExpanded(false);toggleRef.current?.focus();}};
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
  const walletText=counts.wallet==null?"Balance, top up and history":`UGX ${counts.wallet.toLocaleString("en-UG")}`;
  const walletJoined=pathname==="/wallet"||pathname.startsWith("/wallet/");
  return <>
    <header className={`customer-header sticky top-0 z-40 ${home?`ph-header ${homeFont.className}`:""} ${expanded?"is-menu-open":""} ${walletJoined?"is-wallet-joined":""}`}>
      <div className="mx-auto flex h-16 max-w-lg items-center justify-between gap-3 px-4">
        <Link href="/" aria-label={`Go to home${modeLabel ? ", demo mode" : ""}`} className={home?"ph-brand-link min-w-0":"flex shrink-0 items-start gap-1"}><span className="flex items-start gap-1"><BrandLogo variant={home ? "light" : isDark ? "dark" : "light"}/>{modeLabel&&<sup aria-hidden="true" className="pt-1 text-[10px] font-bold leading-none text-gold">{modeLabel}</sup>}</span>{home&&<span className="ph-header-location" aria-label="Current detected location"><MapPinned size={14} aria-hidden/><span>{locationStatus==="locating"?"Locating…":locationLabel??"Location unavailable"}</span></span>}</Link>
        <div className="flex shrink-0 items-center gap-1">
          <button ref={toggleRef} type="button" aria-label={expanded?"Close menu":"Open menu"} aria-expanded={expanded} aria-controls="header-menu" onClick={()=>setExpanded(value=>!value)} className="customer-header-toggle relative flex h-11 w-11 items-center justify-center rounded-full">
            <ChevronDown size={24} className={`transition-transform duration-300 ${expanded?"rotate-180":""}`} aria-hidden/>
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
            <Link href="/account" onClick={close} className="customer-menu-row flex items-center gap-3.5 rounded-2xl p-2 pr-3">
              <span className="customer-menu-avatar flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full">{photo?<img src={photo} alt="" className="h-full w-full object-cover"/>:<User size={26} aria-hidden/>}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] font-bold leading-tight">{user?.name??"Your account"}</span>
                <span className="customer-menu-muted mt-0.5 block truncate text-[13px]">{user?.phone??"View your profile"}</span>
              </span>
              <span className="customer-menu-pill shrink-0 rounded-full px-3 py-1.5 text-xs font-bold">Profile</span>
            </Link>
            <Link href="/wallet" onClick={close} className="customer-menu-wallet flex items-center gap-3 rounded-[22px] px-4 py-3.5">
              <span className="customer-menu-wallet-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"><Wallet size={20} strokeWidth={2} aria-hidden/></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold opacity-75">Peebee Wallet</span>
                <span className={`block truncate font-black tabular-nums leading-tight ${counts.wallet==null?"text-[14px]":"text-[19px]"}`}>{walletText}</span>
              </span>
              <ChevronRight size={20} className="shrink-0 opacity-70" aria-hidden/>
            </Link>
            <div className="grid grid-cols-3 gap-2">
              <MenuTile href="/cart" label="Cart" Icon={ShoppingBag} badge={cartCount} badgeLabel={cartCount===1?"item":"items"} onNavigate={close}/>
              <MenuTile href="/orders/history" label="Orders" Icon={Package} onNavigate={close}/>
              <MenuTile href="/track" label="Track" Icon={MapPinned} badge={counts.inProgress} badgeLabel="on the way" onNavigate={close}/>
              <MenuTile href="/chat" label="Chat & Calls" Icon={MessagesSquare} badge={counts.unreadChats} badgeLabel="unread" onNavigate={close}/>
              <MenuTile href="/notifications" label="Notifications" Icon={Bell} badge={counts.attention} badgeLabel="new" onNavigate={close}/>
              <MenuTile href="/settings" label="Settings" Icon={Settings} onNavigate={close}/>
            </div>
            <SavedCartsList rows={cartRows} onNavigate={close}/>
            <button type="button" role="switch" aria-checked={isDark} onClick={()=>setMode(isDark?"light":"dark")} className="customer-menu-row customer-menu-theme flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left">
              <span className="customer-menu-tile-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">{isDark?<Moon size={18} strokeWidth={1.9} aria-hidden/>:<Sun size={18} strokeWidth={1.9} aria-hidden/>}</span>
              <span className="flex-1 text-[14px] font-semibold">Dark mode</span>
              <span aria-hidden className={`customer-menu-switch relative h-7 w-12 shrink-0 rounded-full ${isDark?"is-on":""}`}><span className="customer-menu-switch-knob absolute left-1 top-1 h-5 w-5 rounded-full"/></span>
            </button>
          </nav>
        </div>
      </div>
      <HeaderExtensionOutlet />
    </header>
    {/* The pushed-down screen below the menu: one tap anywhere on it closes the menu. */}
    <div aria-hidden className={`customer-menu-catcher fixed inset-0 z-30 ${expanded?"is-active":""}`} onClick={close}/>
  </>;
}
