"use client";
import { FOOD_BUSINESS_TYPES, foodBusinessLabel, type FoodBusinessType, type Restaurant } from '@peebee/shared';
import { demoRestaurantPhotoPath } from '@peebee/shared/demo-food';
import { ChefHat, CookingPot, Croissant, Search, SlidersHorizontal, UtensilsCrossed, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../lib/api';

export default function FoodPage() {
  const searchParams = useSearchParams();
  const [restaurants,setRestaurants]=useState<Restaurant[] | null>(null);
  const [error,setError]=useState<string|null>(null);
  const [paused,setPaused]=useState(false);
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState<FoodBusinessType|null>(null);
  const [openOnly,setOpenOnly]=useState(false);
  const results=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{api.listRestaurants().then(res=>{setRestaurants(res.restaurants);setPaused(!!res.paused);}).catch(err=>setError(errorMessage(err)));},[]);
  useEffect(()=>{const requested=searchParams.get('category');if(FOOD_BUSINESS_TYPES.some(type=>type.value===requested))setCategory(requested as FoodBusinessType);},[searchParams]);
  const filtered=restaurants?.filter(r=>(!category||(r.business_type??'restaurant')===category)&&(!openOnly||!!r.is_open)&&`${r.name} ${r.cuisine??''} ${r.description??''}`.toLowerCase().includes(query.toLowerCase()))??[];
  return <div className="space-y-5 px-4 pb-8 pt-4">
    <div><p className="text-xs font-semibold text-gold">Made nearby. Delivered to you.</p><h1 className="mt-1 text-2xl font-bold">Peebee Food</h1></div>
    <div className="flex items-center gap-2"><div className="field-box flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl px-3"><Search size={18} className="shrink-0 text-ink-500"/><input aria-label="Search food businesses" placeholder="Search food, kitchens, bakeries…" value={query} onChange={e=>setQuery(e.target.value)} className="min-w-0 w-full border-0 outline-none"/></div><button aria-label="Show only open businesses" aria-pressed={openOnly} onClick={()=>setOpenOnly(!openOnly)} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--border-faint)] ${openOnly?'bg-gold/20 text-gold':'bg-[rgb(var(--surface-card))]'}`}><SlidersHorizontal size={20}/></button></div>
    <section className="food-hero"><img src="/brand/food-hero.webp" alt="Ugandan dishes, a fresh Rolex and golden pastries" width={1536} height={1024}/><div className="food-hero-copy"><p className="text-xs font-bold uppercase tracking-widest">Something delicious</p><h2>Good food.<br/>Close to home.</h2><p className="mt-3 text-sm">From neighbourhood favourites to home-cooked comfort.</p><button className="food-hero-cta" onClick={()=>results.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'})}>Explore food <ArrowRight size={16}/></button></div></section>
    <div className="food-categories" aria-label="Food business categories">{FOOD_BUSINESS_TYPES.map((type,index)=>{const Icon=[UtensilsCrossed,ChefHat,CookingPot,Croissant][index];return <button key={type.value} aria-pressed={category===type.value} className={category===type.value?'active':''} onClick={()=>setCategory(category===type.value?null:type.value)}><span><Icon size={23} strokeWidth={1.5}/></span><strong>{type.label}</strong></button>;})}</div>
    <div className="flex items-center justify-between"><h2 ref={results} className="scroll-mt-20 text-lg font-bold">{category?foodBusinessLabel(category):'Discover nearby'}</h2><button onClick={()=>{setCategory(null);setOpenOnly(false);setQuery('');}} className="text-sm font-semibold text-gold">View all →</button></div>
    {openOnly&&<p role="status" className="text-xs text-ink-500">Showing businesses open now.</p>}
    {paused&&<p role="status" className="home-card text-sm">Food ordering is currently paused by the platform.</p>}
    {error&&<p role="alert" className="home-card text-sm">{error}</p>}
    {!error&&restaurants===null&&<p role="status" className="py-8 text-center text-sm text-ink-500">Loading food businesses…</p>}
    {restaurants!==null&&filtered.length===0&&<div className="home-card py-8 text-center"><p className="font-semibold">Nothing here just yet.</p><p className="mt-2 text-sm text-ink-500">Try another category or clear your search.</p></div>}
    <div className="grid grid-cols-2 gap-3">{filtered.map(r=><Link key={r.id} href={`/restaurants/${r.id}`} className="food-menu-card !overflow-hidden !p-0"><img src={r.is_demo ? demoRestaurantPhotoPath(r.id)??'/brand/food-hero.webp':'/brand/food-hero.webp'} alt="Food illustration" className="aspect-[4/3] w-full object-cover" width={320} height={240} loading="lazy"/><div className="p-3"><p className="text-[10px] font-semibold text-gold">{foodBusinessLabel(r.business_type)}{r.is_demo?' · Demo':''}</p><h3 className="mt-1 font-bold leading-snug">{r.name}</h3><p className="mt-1 truncate text-xs text-ink-500">{r.cuisine??r.description??'Explore the menu'}</p><p className="mt-3 text-xs font-semibold">{r.is_open?'Open now':'Closed'} <span className="float-right text-gold">Menu →</span></p></div></Link>)}</div>
  </div>;
}
