"use client";
import { Children,cloneElement,isValidElement,useState,type ReactNode } from 'react';

type FieldProps={children?:ReactNode;id?:string;type?:string;placeholder?:string;autoComplete?:string;'aria-label'?:string};
const fieldNames:Record<string,string>={name:'Your full name',identifier:'Phone or email',email:'Email address',phone:'Phone number',password:'Password',newPassword:'New password',currentPassword:'Current password',confirmPassword:'Confirm password',code:'6-digit code'};
/** Keep accessible names while displaying only placeholders, including existing password controls. */
function styleFields(children:ReactNode,label?:string):ReactNode {
  return Children.map(children,child=>{
    if(!isValidElement<FieldProps>(child))return child;
    const props=child.props;
    const name=child.type==='label'?Children.toArray(props.children).filter(x=>typeof x==='string').join('').trim():label;
    const field=child.type==='input'||(typeof child.type!=='string'&&props.id&&fieldNames[props.id]);
    return cloneElement(child,{
      ...(field?{placeholder:name||fieldNames[props.id??'']||props.placeholder||(props.type==='password'?'Password':props.type==='email'?'Email address':'Phone or email'),'aria-label':props['aria-label']||name||fieldNames[props.id??'']||props.placeholder}:{}),
      ...(props.children?{children:styleFields(props.children,name)}:{}),
    });
  });
}
function Brand(){return <div className="auth-brand"><img src="/brand/peebee-logo-light.png?v=svg-5" alt="" className="auth-logo-light" width={40} height={40}/><img src="/brand/peebee-logo-dark.png?v=svg-5" alt="" className="auth-logo-dark" width={40} height={40}/><span>Peebee</span></div>;}
export function AuthScene({children,className='',showBrand=true,navigation}:{children:ReactNode;className?:string;showBrand?:boolean;navigation?:ReactNode}){
  return <section aria-label="Account access" className={`auth-scene ${className}`}><div className="auth-art" aria-hidden="true"><img src="/brand/auth-illustration.webp" alt="" width={1536} height={1024}/></div>{navigation}<div className="auth-content">{showBrand&&<Brand/>}{styleFields(children)}</div></section>;
}
type JourneyProps={children:ReactNode;mode:'login'|'register';onModeChange:(mode:'login'|'register')=>void;welcomeTitle:string;description:string;signupTitle?:string;loginTitle?:string;canSignup?:boolean;busy?:boolean};
export function AuthJourney({children,mode,onModeChange,welcomeTitle,description,signupTitle='Ready to get started?',loginTitle='Welcome back.',canSignup=true,busy=false}:JourneyProps){
  const [screen,setScreen]=useState<'welcome'|'form'>('welcome');
  function open(next:'login'|'register'){onModeChange(next);setScreen('form');}
  return <AuthScene showBrand={false} className={screen==='welcome'?'auth-welcome':'auth-form'} navigation={screen==='form'&&<button type="button" className="auth-back" disabled={busy} onClick={()=>setScreen('welcome')} aria-label="Back to welcome"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>}>{screen==='welcome'?<><Brand/><section className="auth-welcome-copy"><h1>{welcomeTitle}</h1><p>{description}</p><div className="auth-actions">{canSignup&&<button type="button" className="auth-primary" onClick={()=>open('register')}>Sign up</button>}<button type="button" className={canSignup?'auth-secondary':'auth-primary'} onClick={()=>open('login')}>Log in</button></div>{!canSignup&&<p className="auth-footnote">Access is provided by your platform administrator.</p>}</section></>:<section className="auth-form-copy"><h1>{mode==='register'?signupTitle:loginTitle}</h1><p>{mode==='register'?'A few details and you’re on your way.':'Pick up right where you left off.'}</p><div className="auth-form-body">{children}</div>{canSignup&&<p className="auth-switch">{mode==='register'?'Already have an account?':'New to Peebee?'} <button type="button" disabled={busy} onClick={()=>onModeChange(mode==='login'?'register':'login')}>{mode==='register'?'Log in':'Sign up'}</button></p>}</section>}</AuthScene>;
}
