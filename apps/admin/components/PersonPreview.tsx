"use client";
import { CheckCircle2, Store, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export type PersonKind = "riders" | "customers" | "restaurants" | "merchants";
export function PersonPhoto({kind,id,name}:{kind:PersonKind;id:string;name:string}) {
  const [photo,setPhoto]=useState<{id:string;url:string}|null>(null);
  useEffect(()=>{
    let disposed=false, url:string|undefined;
    api.adminPersonPhoto(kind,id).then(blob=>{if(disposed)return;url=URL.createObjectURL(blob);setPhoto({id,url});}).catch(()=>{});
    return ()=>{disposed=true;if(url)URL.revokeObjectURL(url);};
  },[kind,id]);
  const Icon=kind==="restaurants"||kind==="merchants"?Store:UserRound;
  return <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[rgb(var(--surface-muted))] text-gold">
    {photo?.id===id ? <img src={photo.url} alt={`${name} profile`} className="h-full w-full object-cover" onError={()=>setPhoto(null)} /> : <Icon size={25} aria-hidden />}
  </div>;
}

export function PersonCard({kind,id,name,description,status,approved,canApprove,busy,onApprove}:{kind:PersonKind;id:string;name:string;description:string;status:string;approved:boolean;canApprove:boolean;busy?:boolean;onApprove:()=>void}) {
  return <article className={`home-card space-y-4 !rounded-3xl !p-4 ${approved?"ring-1 ring-gold/25":""}`}>
    <div className="flex items-start gap-3">
      <PersonPhoto kind={kind} id={id} name={name}/>
      <div className="min-w-0 flex-1"><h3 className="break-words text-base font-bold">{name}</h3><p className="mt-1 break-words text-xs text-ink-500">{description}</p></div>
      <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${approved?"bg-gold/15 text-ink":"bg-[rgb(var(--surface-muted))] text-ink-500"}`}>{approved&&<CheckCircle2 size={12} aria-hidden/>}{approved?"Approved":status}</span>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <button type="button" disabled={approved||busy||!canApprove} onClick={onApprove} className="min-h-11 rounded-full bg-gold px-3 text-sm font-bold text-ink-gold disabled:opacity-50">{busy?"Saving…":approved?"Approved":"Approve"}</button>
      <Link href={`/people/${kind}/${encodeURIComponent(id)}`} className="flex min-h-11 items-center justify-center rounded-full border border-[var(--border-faint)] px-3 text-sm font-bold">Preview</Link>
    </div>
  </article>;
}

export function SubmittedFields({title,fields}:{title:string;fields:Array<[string,unknown]>}) {
  return <section className="home-card !rounded-3xl !p-5"><h2 className="mb-3 text-base font-bold">{title}</h2><dl className="space-y-3">{fields.map(([label,value])=><div key={label} className="border-b border-[var(--border-faint)] pb-3 last:border-0 last:pb-0"><dt className="text-xs text-ink-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold">{value===null||value===undefined||value===""?"Not supplied":String(value)}</dd></div>)}</dl></section>;
}
