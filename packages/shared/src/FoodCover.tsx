"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function FoodCover({id,name,description,coverKey,loadCover,previewUrl,menuLink,edgeToEdge=false,parallax=false,showCaption=true,overlay,revision,placeholder}:{id:string;name:string;description?:string|null;coverKey?:string|null;loadCover:(id:string,revision?:string)=>Promise<Blob>;previewUrl?:string;menuLink?:string;edgeToEdge?:boolean;parallax?:boolean;showCaption?:boolean;overlay?:ReactNode;revision?:string;placeholder?:ReactNode}){
  const [image,setImage]=useState<{key:string;url:string}|null>(null);
  const coverRef = useRef<HTMLElement | null>(null);
  const revisionKey=coverKey??revision??"menu-fallback";
  const key=`${id}:${revisionKey}`;
  useEffect(()=>{if(previewUrl)return;let disposed=false,url:string|undefined;loadCover(id,revisionKey).then(blob=>{if(disposed)return;url=URL.createObjectURL(blob);setImage({key,url});}).catch(()=>{});return()=>{disposed=true;if(url)URL.revokeObjectURL(url);};},[id,key,revisionKey,loadCover,previewUrl]);
  useEffect(() => {
    if (!parallax) return;
    const figure = coverRef.current;
    if (!figure) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, window.scrollY / Math.max(1, window.innerHeight * 0.85)));
      const theme = getComputedStyle(document.documentElement);
      const maxShade = Number.parseFloat(theme.getPropertyValue("--restaurant-cover-scroll-max-shade")) || 0;
      const maxBlur = Number.parseFloat(theme.getPropertyValue("--restaurant-cover-scroll-max-blur")) || 0;
      figure.style.setProperty("--restaurant-cover-scroll-shade", String(progress * maxShade));
      figure.style.setProperty("--restaurant-cover-scroll-blur", `${progress * maxBlur}px`);
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const themeObserver = new MutationObserver(scheduleUpdate);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    colorScheme.addEventListener("change", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate, { passive: true });
    scheduleUpdate();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      themeObserver.disconnect();
      colorScheme.removeEventListener("change", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [parallax]);
  const source=previewUrl||(image && image.key===key?image.url:null);
  return <figure ref={(node) => { coverRef.current = node; }} style={parallax?undefined:{aspectRatio:"9 / 16"}} className={`relative ${parallax?"h-full w-full":"aspect-[9/16] w-full"} overflow-hidden bg-[rgb(var(--surface-muted))] ${edgeToEdge||parallax?"":"rounded-3xl border border-[var(--border-faint)]"}`}>
    {source?<img src={source} alt={`${name} cover`} className={`absolute inset-0 h-full w-full object-cover ${parallax?"restaurant-cover-image":""}`}/>:<div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center text-ink">{placeholder}<p className="text-sm text-ink-500">Fresh food. Made for you.</p></div>}
    {edgeToEdge&&!parallax&&<div aria-hidden className="absolute inset-x-0 bottom-0 h-2/3" style={{background:"linear-gradient(to bottom, transparent, rgb(var(--color-cream) / .8) 60%, rgb(var(--color-cream)) 100%)"}}/>}
    {parallax&&<>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{background:"linear-gradient(to bottom, rgb(var(--color-black) / .015) 0%, transparent 27%, rgb(var(--color-black) / var(--restaurant-cover-mid-shade)) 62%, rgb(var(--color-black) / var(--restaurant-cover-end-shade)) 100%)"}}/>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[rgb(var(--color-black))]" style={{opacity:"var(--restaurant-cover-scroll-shade, 0)"}}/>
    </>}
    {overlay}
    {showCaption&&<figcaption className={`absolute inset-x-0 bottom-0 space-y-3 p-6 ${edgeToEdge?"text-ink":source?"bg-gradient-to-t from-black/85 via-black/60 to-transparent pt-20 text-white":"bg-[rgb(var(--surface-card))]/90 text-ink"}`}>
      <h2 className="break-words text-2xl font-bold">{name}</h2>
      {description&&<p className="text-sm">{description}</p>}
      {menuLink&&<a href={menuLink} className="inline-flex min-h-12 items-center justify-center rounded-full bg-gold px-6 text-sm font-bold text-ink-gold">View menu →</a>}
    </figcaption>}
  </figure>;
}
