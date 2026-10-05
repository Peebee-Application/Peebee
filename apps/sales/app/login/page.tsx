"use client";
import Link from 'next/link';
import { useState } from 'react';
import { AuthJourney } from '@peebee/shared/auth';
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
  return <AuthJourney mode={signup?'register':'login'} onModeChange={mode=>{setSignup(mode==='register');setError('');}} busy={busy} welcomeTitle="Let’s grow together." description="Bring more people and businesses into the Peebee community." signupTitle="Ready to grow?"><form onSubmit={submit} className="mt-6 space-y-5"><fieldset disabled={busy} className="space-y-5">
    {signup&&<label className="block text-sm font-semibold">Full name<input required maxLength={80} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} className="sales-input mt-2"/></label>}
    <label className="block text-sm font-semibold">{signup?'Email':'Phone or email'}<input type={signup?'email':'text'} autoComplete="username" required maxLength={160} value={identifier} onChange={e=>setIdentifier(e.target.value)} className="sales-input mt-2"/></label>
    <label className="block text-sm font-semibold">Password<input type="password" minLength={signup?10:1} maxLength={100} autoComplete={signup?'new-password':'current-password'} required value={password} onChange={e=>setPassword(e.target.value)} className="sales-input mt-2"/></label>
    {error&&<p role="alert" className="text-sm">{error}</p>}<GoogleSignInButton/>
<button className="sales-primary w-full" disabled={busy}>{busy?'Please wait…':signup?'Create account & request approval':'Sign in'}</button></fieldset></form><Link href="/forgot-password" className="mt-4 text-center text-sm font-semibold text-gold">Forgot password?</Link><p className="mt-5 text-xs text-ink-500">Sales-agent access requires admin approval.</p></AuthJourney>;
}
