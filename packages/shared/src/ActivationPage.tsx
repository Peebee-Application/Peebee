"use client";
import { useEffect, useState } from 'react';
import { AuthScene } from './AuthScene.js';
import type { AuthUser } from './domain.js';

export function ActivationPage({apiUrl,accountType,onActivated}:{apiUrl:string;accountType:string;onActivated:(token:string,user:AuthUser)=>void}) {
  const [token,setToken]=useState(''),[name,setName]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
  useEffect(()=>{
    const value=new URLSearchParams(window.location.hash.slice(1)).get('token')??'';
    const controller=new AbortController();setToken(value);
    if(!value){setError('This link is incomplete. Ask your sales agent for a new activation link.');return;}
    fetch(`${apiUrl}/v1/onboarding/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:value}),signal:controller.signal})
      .then(async res=>{const data=await res.json();if(!res.ok)throw new Error(data.message??'This link has expired or was already used.');
        if(data.accountType!==accountType)throw new Error('Open the activation link in the app it was sent for.');setName(data.name);setLoaded(true);})
      .catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>controller.abort();
  },[apiUrl,accountType]);
  async function submit(event:React.FormEvent) {
    event.preventDefault();setError('');if(password!==confirm){setError('The passwords do not match.');return;}setBusy(true);
    try{const res=await fetch(`${apiUrl}/v1/onboarding/activate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password})});
      const data=await res.json();if(!res.ok)throw new Error(data.message??'Activation could not be completed.');
      onActivated(data.token,data.user);window.history.replaceState(null,'','/activate');window.location.replace('/');
    }catch(e){setError(e instanceof Error?e.message:'Activation could not be completed.');}finally{setBusy(false);}
  }
  return <AuthScene><section className="auth-legacy">
    <h1 className="mt-6 text-center text-2xl font-black">Activate your account</h1>
    <p className="mt-2 text-center text-sm text-ink-500">{name?`Welcome, ${name}. `:''}Your {accountType==='agent'?'sales-agent':accountType} details are already saved. Choose your password to get started.</p>
    {error&&<p role="alert" className="mt-5 rounded-xl border border-[var(--border-faint)] p-4 text-sm">{error}</p>}
    {!loaded&&!error&&<p role="status" className="mt-5 text-center text-sm">Checking your activation link…</p>}
    {loaded&&<form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm font-semibold">New password<input type="password" autoComplete="new-password" minLength={10} maxLength={100} required value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-[var(--border-faint)] px-4 py-3"/></label>
      <p className="text-xs text-ink-500">Use at least 10 characters.</p>
      <label className="block text-sm font-semibold">Confirm password<input type="password" autoComplete="new-password" minLength={10} maxLength={100} required value={confirm} onChange={e=>setConfirm(e.target.value)} className="mt-2 w-full rounded-xl border border-[var(--border-faint)] px-4 py-3"/></label>
      <button disabled={busy} className="w-full rounded-full bg-gold px-5 py-3 font-bold text-ink-gold">{busy?'Activating…':'Activate my account'}</button>
    </form>}
  </section></AuthScene>;
}
