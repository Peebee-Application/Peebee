"use client";
import {useEffect,useState} from "react";
import {api,errorMessage} from "../lib/api";
import {useAuth} from "../lib/auth-context";

export function DisplayNameSettings() {
  const {user,updateUser}=useAuth();
  const [name,setName]=useState(user?.name??"");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string|null>(null);
  useEffect(()=>setName(user?.name??""),[user?.name]);
  async function save(event:React.FormEvent){event.preventDefault();if(!user)return;setBusy(true);setMessage(null);try{const saved=await api.updateMyDisplayName(name);updateUser({...user,name:saved.name});setMessage("Display name saved.");}catch(error){setMessage(errorMessage(error));}finally{setBusy(false);}}
  return <form onSubmit={save} className="home-card space-y-3"><h2 className="text-sm font-semibold">Display name</h2><input aria-label="Display name" autoComplete="name" placeholder="Your display name" required maxLength={80} value={name} disabled={busy} onChange={event=>{setName(event.target.value);setMessage(null);}} className="w-full rounded-2xl border border-[var(--border-faint)]"/><button type="submit" disabled={busy||!name.trim()||name.trim()===user?.name} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy?"Saving…":"Save display name"}</button>{message&&<p role="status" className="text-sm">{message}</p>}</form>;
}
