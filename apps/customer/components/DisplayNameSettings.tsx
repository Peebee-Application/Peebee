"use client";
import {Pencil} from "lucide-react";
import {useEffect,useState} from "react";
import {api,errorMessage} from "../lib/api";
import {useAuth} from "../lib/auth-context";

export function DisplayNameSettings() {
  const {user,updateUser}=useAuth();
  const [editing,setEditing]=useState(false);
  const [name,setName]=useState(user?.name??"");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string|null>(null);
  useEffect(()=>{ // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the field in sync when the account name changes elsewhere
    setName(user?.name??"");
  },[user?.name]);
  function cancel(){setName(user?.name??"");setMessage(null);setEditing(false);}
  async function save(event:React.FormEvent){event.preventDefault();if(!user)return;setBusy(true);setMessage(null);try{const saved=await api.updateMyDisplayName(name);updateUser({...user,name:saved.name});setMessage("Display name saved.");setEditing(false);}catch(error){setMessage(errorMessage(error));}finally{setBusy(false);}}
  if(!editing){
    return <button type="button" onClick={()=>{setMessage(null);setEditing(true);}} className="home-card flex min-h-12 w-full items-center gap-3 !rounded-2xl !py-3 text-sm font-semibold text-ink">
      <Pencil className="h-4 w-4 text-gold" strokeWidth={1.9} aria-hidden/>
      Edit profile
    </button>;
  }
  return <form onSubmit={save} className="home-card space-y-3"><h2 className="text-sm font-semibold">Display name</h2><input aria-label="Display name" autoComplete="name" placeholder="Your display name" required maxLength={80} value={name} disabled={busy} onChange={event=>{setName(event.target.value);setMessage(null);}} className="w-full rounded-2xl border border-[var(--border-faint)]"/><div className="flex gap-2"><button type="button" onClick={cancel} disabled={busy} className="min-h-12 flex-1 rounded-full border border-[var(--border-faint)] font-bold text-ink disabled:opacity-50">Cancel</button><button type="submit" disabled={busy||!name.trim()||name.trim()===user?.name} className="min-h-12 flex-1 rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy?"Saving…":"Save display name"}</button></div>{message&&<p role="status" className="text-sm">{message}</p>}</form>;
}
