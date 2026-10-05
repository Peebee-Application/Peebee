"use client";
import Link from 'next/link';
import { useState } from 'react';
import { BrandLogo } from '../../components/BrandLogo';
import { GoogleSignInButton } from '../../components/GoogleSignInButton';
import { request } from '../../lib/api';
import { finishSignIn } from '../../lib/access';
export default function Login(){
  const [signup,setSignup]=useState(false),[name,setName]=useState(''),[identifier,setIdentifier]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{const data=await request<{token:string}>(signup?'/auth/register':'/auth/login',{method:'POST',body:JSON.stringify(signup?{name:name.trim(),email:identifier.trim().toLowerCase(),password,role:'customer'}:{identifier:identifier.trim(),password})});await finishSignIn(data.token,signup);}
    catch(e){setError(e instanceof Error?e.message:'Could not sign in.');}finally{setBusy(false);}
  }
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10"><BrandLogo className="justify-center"/><h1 className="mt-8 text-2xl font-black">{signup?'Apply as a sales agent':'Sales-agent sign in'}</h1><p className="mt-2 text-sm text-ink-500">{signup?'Create your account. An admin will review your sales-agent application.':'Register people and businesses with Peebee.'}</p><nav className="mt-5 flex gap-2" aria-label="Account options"><button type="button" disabled={busy} aria-pressed={!signup} className={`sales-tab ${!signup?'sales-tab-active':''}`} onClick={()=>{setSignup(false);setError('');}}>Sign in</button><button type="button" disabled={busy} aria-pressed={signup} className={`sales-tab ${signup?'sales-tab-active':''}`} onClick={()=>{setSignup(true);setError('');}}>Sign up</button></nav><form onSubmit={submit} className="mt-6 space-y-5"><fieldset disabled={busy} className="space-y-5">
    {signup&&<label className="block text-sm font-semibold">Full name<input required maxLength={80} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} className="sales-input mt-2"/></label>}
    <label className="block text-sm font-semibold">{signup?'Email':'Phone or email'}<input type={signup?'email':'text'} autoComplete="username" required maxLength={160} value={identifier} onChange={e=>setIdentifier(e.target.value)} className="sales-input mt-2"/></label>
    <label className="block text-sm font-semibold">Password<input type="password" minLength={signup?10:1} maxLength={100} autoComplete={signup?'new-password':'current-password'} required value={password} onChange={e=>setPassword(e.target.value)} className="sales-input mt-2"/></label>
    {error&&<p role="alert" className="text-sm">{error}</p>}<button className="sales-primary w-full" disabled={busy}>{busy?'Please wait…':signup?'Create account & request approval':'Sign in'}</button></fieldset></form><Link href="/forgot-password" className="mt-4 text-center text-sm font-semibold text-gold">Forgot password?</Link><GoogleSignInButton/><p className="mt-5 text-xs text-ink-500">Invited agents can also use their activation link. Admin approval is required for sales access.</p></main>;
}
