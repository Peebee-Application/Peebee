"use client";
import { useEffect,useState } from "react";

export function FoodCover({id,name,description,coverKey,loadCover,previewUrl,menuLink}:{id:string;name:string;description?:string|null;coverKey?:string|null;loadCover:(id:string,revision?:string)=>Promise<Blob>;previewUrl?:string;menuLink?:string}){
  const [image,setImage]=useState<{key:string;url:string}|null>(null);
  useEffect(()=>{if(!coverKey)return;let disposed=false,url:string|undefined;loadCover(id,coverKey).then(blob=>{if(disposed)return;url=URL.createObjectURL(blob);setImage({key:coverKey,url});}).catch(()=>{});return()=>{disposed=true;if(url)URL.revokeObjectURL(url);};},[id,coverKey,loadCover]);
  const source=previewUrl||(image && image.key===coverKey?image.url:null);
  return <figure style={{aspectRatio:"9 / 16"}} className="relative aspect-[9/16] w-full overflow-hidden rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))]">
    {source?<img src={source} alt={`${name} cover`} className="absolute inset-0 h-full w-full object-cover"/>:<div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center text-ink"><svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden className="text-gold"><path d="M3 10V5h18v5M3 10h18M5 10v10h14V10M9 20v-6h6v6M2 5l3-3h14l3 3"/></svg><p className="text-sm text-ink-500">Fresh food. Made for you.</p></div>}
    <figcaption className={`absolute inset-x-0 bottom-0 space-y-3 p-6 ${source?"bg-gradient-to-t from-black/85 via-black/60 to-transparent pt-20 text-white":"bg-[rgb(var(--surface-card))]/90 text-ink"}`}>
      <h2 className="break-words text-2xl font-bold">{name}</h2>
      {description&&<p className="text-sm">{description}</p>}
      {menuLink&&<a href={menuLink} className="inline-flex min-h-12 items-center justify-center rounded-full bg-gold px-6 text-sm font-bold text-ink-gold">View menu →</a>}
    </figcaption>
  </figure>;
}
