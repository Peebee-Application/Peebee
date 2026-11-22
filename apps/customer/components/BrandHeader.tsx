"use client";
import {ChevronDown,ChevronUp,MapPinned,MessagesSquare} from "lucide-react";
import Link from "next/link";
import {usePathname,useRouter} from "next/navigation";
import {useCallback,useEffect,useRef,useState} from "react";
import {isPracticeMode,type PlatformEnvironment} from "@peebee/shared";
import {api} from "../lib/api";
import {useCart} from "../lib/cart";
import {loadOrderFeed} from "../lib/order-feed";
import {useChatDrawer} from "../lib/chat-drawer";
import {useHomeMenu} from "../lib/home-menu";
import {HeaderExtensionOutlet} from "../lib/header-extension";
import {drawerSectionForPath,pathForDrawerSection,useHeaderDrawer} from "../lib/header-drawer";
import {BrandLogo} from "./BrandLogo";
import {useLocationLabel} from "../lib/use-location-label";
import {homeFont} from "./home/home-font";
import {useCartRows} from "./SavedCarts";
import {HeaderDrawerCard} from "./header-drawer/HeaderDrawerCard";

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

export function BrandHeader() {
  const pathname=usePathname();
  const router=useRouter();
  const drawer=useHeaderDrawer();
  const open=drawer.mode!=="closed";
  const home=pathname==="/";
  const {label:locationLabel,status:locationStatus}=useLocationLabel(home);
  const {totalQuantity:cartCount}=useCart();
  const chat=useChatDrawer();
  const chatEnabled=useHomeMenu().header.chatEnabled;
  const [chatUnread,setChatUnread]=useState(false);
  const cartRows=useCartRows(open);
  const openCarts=cartRows.some(row=>row.kind!=="earlier");
  const toggleRef=useRef<HTMLButtonElement>(null);
  const releaseTimer=useRef<number|undefined>(undefined);
  const leavingRef=useRef(false);
  const [counts,setCounts]=useState<MenuCounts>(EMPTY_COUNTS);
  const [environment,setEnvironment]=useState<PlatformEnvironment|null>(null);
  const [practiceActive,setPracticeActive]=useState(false);
  // Practice is shown by the shared blue border + "Practice mode" tab, not a header label.
  const modeLabel=!practiceActive&&environment==="sandbox"?"*demo":null;

  const closeMenu=useCallback(()=>{
    const sectionPath=drawerSectionForPath(pathname);
    if(sectionPath){
      leavingRef.current=true;
      drawer.close();
      router.push("/");
      return;
    }
    drawer.close();
  },[drawer,pathname,router]);

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
    const fromPath=drawerSectionForPath(pathname);
    if(leavingRef.current){
      if(!fromPath) leavingRef.current=false;
      else return;
    }
    if(fromPath){
      drawer.openSection(fromPath);
      return;
    }
    // Leave the first-drop menu open when Back from Wallet returns home.
    if(drawer.mode==="menu") return;
    if(drawer.mode==="section" && pathForDrawerSection(drawer.section)===pathname) return;
    if(drawer.mode!=="closed") drawer.close();
  },[pathname, drawer]);
  useEffect(()=>()=>{window.clearTimeout(releaseTimer.current);document.documentElement.classList.remove("customer-menu-open","customer-section-open");},[]);
  useEffect(()=>{
    const root=document.documentElement;
    const screen=document.querySelector("main");
    const reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.clearTimeout(releaseTimer.current);
    if(drawer.mode==="menu"){
      root.classList.add("customer-menu-open");
      root.classList.remove("customer-section-open");
      screen?.setAttribute("inert","");
    }else if(drawer.mode==="section"){
      root.classList.add("customer-section-open");
      root.classList.remove("customer-menu-open");
      screen?.removeAttribute("inert");
    }else{
      root.classList.remove("customer-section-open");
      screen?.removeAttribute("inert");
      releaseTimer.current=window.setTimeout(()=>root.classList.remove("customer-menu-open"),reduce?0:420);
    }
    return()=>screen?.removeAttribute("inert");
  },[drawer.mode]);
  useEffect(()=>{
    const syncPractice=()=>setPracticeActive(isPracticeMode());
    syncPractice();
    window.addEventListener("storage",syncPractice);
    api.getSettings().then(({settings})=>setEnvironment(settings.platformEnvironment)).catch(()=>{});
    return()=>window.removeEventListener("storage",syncPractice);
  },[]);
  useEffect(()=>{
    if(!open)return;
    let cancelled=false;
    loadMenuCounts().then(next=>{if(!cancelled)setCounts(next);}).catch(()=>{});
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape"){closeMenu();toggleRef.current?.focus();}};
    window.addEventListener("keydown",onKey);
    return()=>{cancelled=true;window.removeEventListener("keydown",onKey);};
  },[open,closeMenu]);
  const walletJoined=pathname==="/wallet"||pathname.startsWith("/wallet/");
  return <>
    <header className={`customer-header sticky top-0 z-40 ${home?`ph-header ${homeFont.className}`:""} ${drawer.mode==="menu"?"is-menu-open":""} ${drawer.mode==="section"?"is-section-open":""} ${walletJoined||drawer.section==="wallet"?"is-wallet-joined":""}`}>
      <div className="mx-auto flex h-16 max-w-lg items-center justify-between gap-3 px-4">
        <Link href="/" aria-label={`Go to home${modeLabel ? ", demo mode" : ""}`} className={home?"ph-brand-link min-w-0":"flex shrink-0 items-start gap-1"}><span className="flex items-start gap-1"><BrandLogo variant="light"/>{modeLabel&&<sup aria-hidden="true" className="pt-1 text-[10px] font-bold leading-none text-gold">{modeLabel}</sup>}</span>{home&&<span className="ph-header-location" aria-label="Current detected location"><MapPinned size={14} aria-hidden/><span>{locationStatus==="locating"?"Locating…":locationLabel??"Location unavailable"}</span></span>}</Link>
        <div className="flex shrink-0 items-center gap-1">
          <button ref={toggleRef} type="button" aria-label={open?"Close menu":"Open menu"} aria-expanded={open} aria-controls="header-menu" onClick={()=>{ if(open){ closeMenu(); toggleRef.current?.focus(); } else { drawer.openMenu(); } }} className="customer-header-toggle relative flex h-11 w-11 items-center justify-center rounded-full">
            {open?<ChevronUp size={24} aria-hidden/>:<ChevronDown size={24} aria-hidden/>}
            {!open&&(cartCount>0||openCarts)&&<span aria-hidden className="customer-header-dot absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full"/>}
          </button>
          {chatEnabled&&<button type="button" aria-label={chatUnread?"Open chat, unread messages":"Open chat"} aria-expanded={chat.open} aria-controls="chat-drawer" onClick={chat.openChat} className="customer-header-toggle relative flex h-11 w-11 items-center justify-center rounded-full">
            <MessagesSquare size={22} aria-hidden/>
            {chatUnread&&<span aria-hidden className="customer-header-dot absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full"/>}
          </button>}
        </div>
      </div>
      <HeaderExtensionOutlet />
    </header>
    <HeaderDrawerCard open={open} notificationCount={counts.attention} />
    {/* The pushed-down screen below the menu: one tap anywhere on it closes the menu. */}
    <div aria-hidden className={`customer-menu-catcher fixed inset-0 z-30 ${drawer.mode==="menu"?"is-active":""}`} onClick={closeMenu}/>
  </>;
}
