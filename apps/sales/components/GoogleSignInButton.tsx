"use client";
import { GoogleButtonSurface, mountGoogleButton } from "@peebee/shared/google-button";
import Script from 'next/script';
import { useEffect,useRef,useState } from 'react';
import { request } from '../lib/api';
import { finishSignIn } from '../lib/access';
type GoogleIdentity = {accounts:{id:{initialize:(config:Record<string,unknown>)=>void;renderButton:(node:HTMLElement,options:Record<string,unknown>)=>void}}};
const clientId=process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
export function GoogleSignInButton(){
  const ref=useRef<HTMLDivElement>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    const google=(window as Window & {google?:GoogleIdentity}).google;
    if(!ready||!clientId||!ref.current||!google)return;
    let alive=true;
    google.accounts.id.initialize({client_id:clientId,callback:async(response:{credential:string})=>{
      setBusy(true);setError('');
      try{const result=await request<{token:string}>('/auth/google',{method:'POST',body:JSON.stringify({idToken:response.credential,app:'sales'})});if(alive)await finishSignIn(result.token,true);}
      catch(e){if(alive)setError(e instanceof Error?e.message:'Google sign-in failed.');}
      finally{if(alive)setBusy(false);}
    }});
    const stopSizing=mountGoogleButton(ref.current,(node,options)=>google.accounts.id.renderButton(node,options));
    return()=>{alive=false;stopSizing();};
  },[ready]);
  if(!clientId)return null;
  return <div className="mt-6 space-y-3"><Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={()=>setReady(true)} onError={()=>setError('Google could not load. Refresh the page or sign in with your password.')}/><div className="flex items-center gap-3 text-xs text-ink-500"><span className="h-px flex-1 bg-[var(--border-faint)]"/>OR<span className="h-px flex-1 bg-[var(--border-faint)]"/></div><GoogleButtonSurface buttonRef={ref} ready={ready} busy={busy}/>{busy&&<p role="status" className="text-center text-sm">Signing in…</p>}{error&&<p role="alert" className="text-sm">{error}</p>}</div>;
}
