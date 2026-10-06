"use client";
import type { Restaurant } from "@peebee/shared";
import { FoodCover } from "@peebee/shared/food-cover";
import { useEffect,useState } from "react";
import { api,errorMessage } from "../lib/api";

export function CoverEditor({restaurant,onSaved}:{restaurant:Restaurant;onSaved:()=>Promise<void>}){
  const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<string|undefined>(),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[saved,setSaved]=useState(false);
  useEffect(()=>{if(!file){setPreview(undefined);return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
  async function save(){if(!file)return;setBusy(true);setError(null);try{await api.uploadRestaurantCover(file);await onSaved();setFile(null);setSaved(true);}catch(err){setError(errorMessage(err));}finally{setBusy(false);}}
  return <section className="home-card space-y-4"><div><h2 className="font-bold">Your cover page</h2><p className="mt-1 text-sm text-ink-500">Introduce your food business with a portrait cover. Photos are centre-cropped to 9:16.</p></div>
    <FoodCover id={restaurant.id} name={restaurant.name} description={restaurant.cuisine} coverKey={restaurant.cover_key} loadCover={api.restaurantCoverBlob} previewUrl={preview}/>
    <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-full border border-[var(--border-faint)] text-sm font-bold">{restaurant.cover_key?"Change cover":"Choose cover photo"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className="sr-only" onChange={e=>{const chosen=e.target.files?.[0];e.target.value="";setError(null);setSaved(false);if(!chosen)return;if(!["image/jpeg","image/png","image/webp"].includes(chosen.type)||chosen.size>4*1024*1024){setError("Choose a JPG, PNG or WebP image under 4 MB.");return;}setFile(chosen);}}/></label>
    {file&&<div className="flex gap-2"><button type="button" disabled={busy} onClick={()=>setFile(null)} className="min-h-12 flex-1 rounded-full border border-[var(--border-faint)] font-bold">Cancel</button><button type="button" disabled={busy} onClick={()=>void save()} className="min-h-12 flex-1 rounded-full bg-gold font-bold text-ink-gold disabled:opacity-60">{busy?"Saving…":"Save cover"}</button></div>}
    {error&&<p role="alert" className="text-sm">{error}</p>}{saved&&<p role="status" className="text-sm">Cover saved.</p>}
  </section>;
}
