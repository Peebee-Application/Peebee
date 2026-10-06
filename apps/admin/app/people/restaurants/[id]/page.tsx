"use client";
import { FoodCover } from "@peebee/shared/food-cover";
import { foodBusinessLabel, hasPermission, type AdminRestaurant } from "@peebee/shared";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback,useEffect,useState } from "react";
import { PersonPhoto, SubmittedFields } from "../../../../components/PersonPreview";
import { api,errorMessage } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";

export default function FoodPreview(){
  const {id}=useParams<{id:string}>(); const {user}=useAuth();
  const [profile,setProfile]=useState<AdminRestaurant|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{const result=await api.adminGetRestaurant(id);setProfile(result.restaurant);},[id]);
  useEffect(()=>{void load().catch(err=>setError(errorMessage(err)));},[load]);
  async function change(status:"active"|"suspended"){setBusy(true);setError(null);try{await api.adminSetRestaurantStatus(id,status);await load();}catch(err){setError(errorMessage(err));}finally{setBusy(false);}}
  if(!profile)return <p className="p-4" role="status">{error??"Loading food business…"}</p>;
  const canManage=hasPermission(user?.adminRole??null,"restaurants.manage");
  return <div className="space-y-5 p-4 pb-8">
    <Link href="/people?tab=restaurants" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold"><ArrowLeft size={18}/>Users</Link>
    <header className="home-card flex items-center gap-3 !rounded-3xl !p-5"><PersonPhoto kind="restaurants" id={id} name={profile.name}/><div className="min-w-0"><p className="text-xs text-ink-500">Food business preview</p><h1 className="break-words text-xl font-bold">{profile.name}</h1><p className="mt-1 text-sm text-gold">{profile.status==="active"?"Approved":profile.status.replaceAll("_"," ")}</p></div></header>
    {error&&<p role="alert" className="rounded-2xl border border-[var(--border-faint)] p-3">{error}</p>}
    <FoodCover id={id} name={profile.name} description={profile.cuisine} coverKey={profile.cover_key} loadCover={api.restaurantCoverBlob}/>
    <SubmittedFields title="Business details" fields={[["Business name",profile.name],["Category",foodBusinessLabel(profile.business_type)],["Description",profile.description],["Cuisine",profile.cuisine],["Business phone",profile.phone],["Address",profile.address],["Pickup latitude",profile.lat],["Pickup longitude",profile.lng]]}/>
    <SubmittedFields title="Owner details" fields={[["Name",profile.owner_name],["Phone",profile.owner_phone],["Email",profile.owner_email]]}/>
    <SubmittedFields title="Working hours and account" fields={[["Opening time (Uganda)",profile.open_time],["Closing time (Uganda)",profile.close_time],["Accepting orders",profile.is_open?"Open":"Closed"],["Status",profile.status.replaceAll("_"," ")],["Registered",profile.created_at],["Last updated",profile.updated_at],["Business reference",profile.id]]}/>
    {canManage&&<button type="button" disabled={busy} onClick={()=>void change(profile.status==="active"?"suspended":"active")} className="min-h-12 w-full rounded-full bg-gold text-sm font-bold text-ink-gold disabled:opacity-60">{busy?"Saving…":profile.status==="active"?"Suspend business":"Approve"}</button>}
  </div>;
}
