"use client";
import {useCallback,useEffect,useState} from 'react';
import {BrandLogo} from '../../components/BrandLogo';
import {request,TOKEN_KEY} from '../../lib/api';
import type {AccessStatus} from '../../lib/access';
export default function Approval(){
  const [status,setStatus]=useState<AccessStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const check=useCallback(async()=>{setBusy(true);setError('');try{const r=await request<{status:AccessStatus}>('/sales-access/status');if(r.status==='approved')window.location.replace('/');else setStatus(r.status);}catch(e){setError(e instanceof Error?e.message:'Could not check approval.');}finally{setBusy(false);}},[]);
  useEffect(()=>{if(!localStorage.getItem(TOKEN_KEY))window.location.replace('/login');else void check();},[check]);
  async function apply(){setBusy(true);setError('');try{const r=await request<{status:AccessStatus}>('/sales-access/request',{method:'POST',body:JSON.stringify({consent:true})});setStatus(r.status);}catch(e){setError(e instanceof Error?e.message:'Could not apply.');}finally{setBusy(false);}}
  const title=status==='pending'?'Awaiting admin approval':status==='disabled'?'Sales access is disabled':status==='rejected'?'Application not approved':status==='none'?'Apply for sales access':'Checking your access…';
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10"><BrandLogo className="justify-center"/><h1 className="mt-8 text-2xl font-black">{title}</h1><p className="mt-3 text-sm text-ink-500">{status==='pending'?'Your account is ready and your sales-agent request is saved. You can start onboarding after an admin approves it.':status==='none'?'You are signed in to Peebee. Request sales-agent approval to onboard people and businesses.':status==='disabled'||status==='rejected'?'Contact your administrator to discuss access. Signing in or resetting your password keeps the existing access decision.':'Please wait while we check your sales-agent access.'}</p>{error&&<p role="alert" className="mt-4 text-sm">{error}</p>}<button disabled={busy||!status} onClick={status==='none'?apply:check} className="sales-primary mt-6 w-full">{busy?'Checking…':status==='none'?'Request admin approval':'Check approval status'}</button><button onClick={()=>{localStorage.removeItem(TOKEN_KEY);window.location.replace('/login');}} className="mt-5 text-sm font-semibold text-gold">Sign out</button></main>;
}
