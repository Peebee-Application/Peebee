"use client";
import { useEffect,useState,type ReactNode } from "react";

export function FoodCover({id,name,description,coverKey,loadCover,previewUrl,menuLink,edgeToEdge=false,overlay,revision,placeholder}:{id:string;name:string;description?:string|null;coverKey?:string|null;loadCover:(id:string,revision?:string)=>Promise<Blob>;previewUrl?:string;menuLink?:string;edgeToEdge?:boolean;overlay?:ReactNode;revision?:string;placeholder?:ReactNode}){
  const [image,setImage]=useState<{key:string;url:string}|null>(null);
  const revisionKey=coverKey??revision??"menu-fallback";
  const key=`${id}:${revisionKey}`;
  useEffect(()=>{if(previewUrl)return;let disposed=false,url:string|undefined;loadCover(id,revisionKey).then(blob=>{if(disposed)return;url=URL.createObjectURL(blob);setImage({key,url});}).catch(()=>{});return()=>{disposed=true;if(url)URL.revokeObjectURL(url);};},[id,key,revisionKey,loadCover,previewUrl]);
  const source=previewUrl||(image && image.key===key?image.url:null);
  return <figure style={{aspectRatio:"9 / 16"}} className={`relative aspect-[9/16] w-full overflow-hidden bg-[rgb(var(--surface-muted))] ${edgeToEdge?"":"rounded-3xl border border-[var(--border-faint)]"}`}>
    {source?<img src={source} alt={`${name} cover`} className="absolute inset-0 h-full w-full object-cover"/>:<div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center text-ink">{placeholder}<p className="text-sm text-ink-500">Fresh food. Made for you.</p></div>}
    {edgeToEdge&&<div aria-hidden className="absolute inset-x-0 bottom-0 h-2/3" style={{background:"linear-gradient(to bottom, transparent, rgb(var(--color-cream) / .8) 60%, rgb(var(--color-cream)) 100%)"}}/>}
    {overlay}
    <figcaption className={`absolute inset-x-0 bottom-0 space-y-3 p-6 ${edgeToEdge?"text-ink":source?"bg-gradient-to-t from-black/85 via-black/60 to-transparent pt-20 text-white":"bg-[rgb(var(--surface-card))]/90 text-ink"}`}>
      <h2 className="break-words text-2xl font-bold">{name}</h2>
      {description&&<p className="text-sm">{description}</p>}
      {menuLink&&<a href={menuLink} className="inline-flex min-h-12 items-center justify-center rounded-full bg-gold px-6 text-sm font-bold text-ink-gold">View menu →</a>}
    </figcaption>
  </figure>;
}
