"use client";
import { useState } from 'react';
import { BrandLogo } from '../../components/BrandLogo';
import { request,TOKEN_KEY } from '../../lib/api';
export default function Login(){const [identifier,setIdentifier]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const data=await request<{token:string}>('/auth/login',{method:'POST',body:JSON.stringify({identifier,password})});localStorage.setItem(TOKEN_KEY,data.token);await request('/sales/me');window.location.replace('/');}catch(e){localStorage.removeItem(TOKEN_KEY);setError(e instanceof Error?e.message:'Could not sign in.');}finally{setBusy(false);}}
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10"><BrandLogo className="justify-center"/><h1 className="mt-8 text-2xl font-black">Sales-agent sign in</h1><p className="mt-2 text-sm text-ink-500">Register people and businesses with Peebee.</p><form onSubmit={submit} className="mt-6 space-y-5">
    <label className="block text-sm font-semibold">Phone or email<input autoComplete="username" required value={identifier} onChange={e=>setIdentifier(e.target.value)} className="sales-input mt-2"/></label>
    <label className="block text-sm font-semibold">Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} className="sales-input mt-2"/></label>
    {error&&<p role="alert" className="text-sm">{error}</p>}<button className="sales-primary w-full" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form><p className="mt-5 text-xs text-ink-500">Your administrator invites you to this app. New agents should use their activation link.</p></main>;}
