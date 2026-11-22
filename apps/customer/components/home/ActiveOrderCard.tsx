"use client";
import { isPracticeMode } from "@peebee/shared";
import { ListChecks, MapPinned, MessageCircle, Package, Phone, Route, Store, UtensilsCrossed, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useCalls } from "../../lib/calls-context";
import { useChatDrawer } from "../../lib/chat-drawer";
import { activeOrderCard } from "../../lib/active-order-card";
import { publishActiveOrder, readActiveOrder, subscribeActiveOrder } from "../../lib/active-order-store";
import { homeFont } from "./home-font";
const ICONS = { "ride-pickup": Route, "ride-dropoff": Route, parcel: Package, shopping: ListChecks, catalogue: Store, food: UtensilsCrossed };
export function ActiveOrderCard() {
  const {user,ready}=useAuth();
  const {openThread}=useChatDrawer();
  const {startCall}=useCalls();
  const scope=`${user?.id ?? "guest"}:${isPracticeMode()?"practice":"live"}`;
  const read=useCallback(()=>readActiveOrder(scope),[scope]);
  const order=useSyncExternalStore(subscribeActiveOrder,read,()=>undefined);
  useEffect(()=>{
    if(!ready||!user)return;
    let live=true;
    const load=()=>{if(document.visibilityState!=="visible")return;void api.getActiveOrder().then(({activeOrder})=>{if(live)publishActiveOrder(scope,activeOrder);}).catch(()=>{});};
    load();document.addEventListener("visibilitychange",load);window.addEventListener("peebee:data-updated",load);
    return()=>{live=false;document.removeEventListener("visibilitychange",load);window.removeEventListener("peebee:data-updated",load);};
  },[ready,user,scope]);
  if(!order||!user||order.customer_id!==user.id||["Settle","Cancelled"].includes(order.stage))return null;
  const model=activeOrderCard(order),Icon=ICONS[model.kind];
  const initials=order.rider_name?.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join("").toUpperCase();
  return <section className={`ride-trip-card home-active-card ${homeFont.className}`} aria-label={model.title}>
    <Link className="home-active-card__summary" href={model.href} aria-label={`${model.title}. ${model.status}. Open tracking`}>
      <span className="ride-trip-card__avatar home-active-card__avatar" aria-hidden>{order.rider_id&&initials?initials:<Icon size={28}/>}</span>
      <span className="home-active-card__copy"><span className="home-active-card__title"><Icon size={22} aria-hidden/><h2>{model.title}</h2></span><span className="home-active-card__status">{model.status}</span></span>
      {model.pin&&<span className="home-active-card__pin" aria-label={`Handover PIN ${model.pin}`}>PIN {model.pin}</span>}
    </Link>
    <div className="home-active-card__actions">
      <button type="button" disabled={!model.contactAvailable} aria-label={model.contactAvailable?"Chat with your rider":"Chat available when a rider is assigned"} onClick={()=>{if(order.rider_id)openThread({type:"rider",id:order.rider_id});}}><MessageCircle size={22} aria-hidden/>Chat</button>
      <button type="button" disabled={!model.contactAvailable} aria-label={model.contactAvailable?"Call your rider":"Call available when a rider is assigned"} onClick={()=>{if(order.rider_id)void startCall({calleeId:order.rider_id,orderId:order.id});}}><Phone size={22} aria-hidden/>Call</button>
      <Link href={model.href} aria-label={model.needsPayment?"Complete payment":`Track ${model.title}`}>{model.needsPayment?<Wallet size={22} aria-hidden/>:<MapPinned size={22} aria-hidden/>}{model.needsPayment?"Pay":"Track"}</Link>
    </div>
    <span className="ride-trip-card__track home-active-card__progress" role="progressbar" aria-label={`${model.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(model.progress*100)}><span className="ride-gold-fill" style={{width:`${model.progress*100}%`}}/></span>
  </section>;
}
