import '@peebee/shared/auth.css';
import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
export const metadata:Metadata={title:'Peebee Sales',description:'Register Peebee customers, riders and businesses',manifest:'/manifest.webmanifest',icons:{icon:[{url:'/favicon.svg?v=logo-6',sizes:'any',type:'image/svg+xml'},{url:'/icons/favicon-32.png?v=logo-6',sizes:'32x32',type:'image/png'}],apple:'/icons/apple-touch-icon.png?v=logo-6'},referrer:'no-referrer'};
const theme=`try{var m=localStorage.getItem('peebee-theme');var h=new Date().getHours();document.documentElement.dataset.theme=m==='light'||m==='dark'?m:(h>=6&&h<19?'light':'dark')}catch(e){}`;
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en" suppressHydrationWarning><body><Script id="theme-init" strategy="beforeInteractive">{theme}</Script>{children}</body></html>;}
