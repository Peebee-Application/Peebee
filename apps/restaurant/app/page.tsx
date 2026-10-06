"use client";
import { FOOD_BUSINESS_TYPES, foodBusinessLabel, type MenuItem } from '@peebee/shared';
import { ChefHat, CookingPot, Croissant, Search, UtensilsCrossed, WalletCards, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MenuPhoto } from '../components/MenuPhoto';
import { FoodHero } from '../components/FoodHero';
import { OpenStatusCard } from '../components/OpenStatusCard';
import { useAuth } from '../lib/auth-context';
import { api } from '../lib/api';

export default function HomePage() {
  const { restaurant, restaurantReady, refreshRestaurant } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [menuError, setMenuError] = useState(false);
  useEffect(() => { if (restaurantReady && !restaurant) router.replace('/account'); }, [restaurantReady, restaurant, router]);
  useEffect(() => { let cancelled=false; if (restaurant) api.myMenu().then(result => {if(!cancelled)setItems([...result.categories.flatMap(category=>category.items),...result.uncategorizedItems]);}).catch(() => {if(!cancelled)setMenuError(true);}); return()=>{cancelled=true;}; }, [restaurant?.id]);
  if (!restaurantReady) return <p className="p-8 text-center">Loading your food business…</p>;
  if (!restaurant) return null;
  const filtered = items?.filter(item => item.name.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <div className="space-y-5 px-4 pb-8 pt-4">
    <div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-ink-500">{foodBusinessLabel(restaurant.business_type)}</p><h1 className="text-xl font-bold">{restaurant.name}</h1></div><Link href="/account" className="text-sm font-bold text-gold">Profile</Link></div>
    {restaurant.status !== 'active' && <section role="status" className="home-card"><p className="font-bold">{restaurant.status === 'pending_approval' ? 'Awaiting admin approval' : 'Business suspended'}</p><p className="mt-1 text-sm text-ink-500">{restaurant.status === 'pending_approval' ? 'Prepare your menu while we review your business. Customers can order after approval.' : 'Contact support to restore your business. Ordering is unavailable while suspended.'}</p></section>}
    <div className="field-box flex min-h-12 items-center gap-2 rounded-2xl px-4"><Search size={18} className="text-ink-500"/><input aria-label="Search your menu" placeholder="Search dishes, pastries, snacks…" value={query} onChange={event=>setQuery(event.target.value)} className="w-full border-0 outline-none"/></div>
    <FoodHero/>
    <div className="food-categories">{FOOD_BUSINESS_TYPES.map((type,index)=>{const Icon=[UtensilsCrossed,ChefHat,CookingPot,Croissant][index];return <Link href="/account" key={type.value} className={(restaurant.business_type ?? 'restaurant')===type.value ? 'active' : ''}><span><Icon size={23} strokeWidth={1.5}/></span><strong>{type.label}</strong></Link>;})}</div>
    <section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">Your menu</h2><Link href="/menu" className="text-sm font-semibold text-gold">View all →</Link></div>
      {menuError ? <p role="status" className="home-card text-sm">Menu could not load. <Link href="/menu" className="underline">Open menu management</Link></p> : items===null ? <p className="text-sm text-ink-500">Loading menu…</p> : items.length===0 ? <div className="home-card"><p className="font-semibold">Your next favourite starts here.</p><p className="mt-1 text-sm text-ink-500">Add dishes, prices and photos to bring your menu to life.</p><Link href="/menu" className="mt-3 inline-block font-bold text-gold">Add your first item →</Link></div> : <div className="grid grid-cols-2 gap-3">{filtered.slice(0,6).map(item=><Link href="/menu" key={item.id} className="food-menu-card"><MenuPhoto id={item.id} hasPhoto={!!item.photo_key}/><h3 className="font-bold">{item.name}</h3><p className="mt-1 text-sm">UGX {item.price.toLocaleString()}</p><p className="mt-2 text-xs text-ink-500">{item.available?'Available':'Unavailable'}</p></Link>)}</div>}
      {items && items.length>0 && filtered.length===0 && <p className="py-4 text-sm text-ink-500">No items match your search.</p>}
    </section>
    {restaurant.status==='active' && <OpenStatusCard restaurant={restaurant} onUpdated={refreshRestaurant}/>}
    <div className="grid grid-cols-2 gap-3"><Link href="/wallet" className="food-menu-card"><WalletCards className="mb-3 text-gold"/><h2 className="font-bold">Business balance</h2><p className="mt-1 text-xs text-ink-500">Sales and settlements</p></Link><Link href="/payments" className="food-menu-card"><ShieldCheck className="mb-3 text-gold"/><h2 className="font-bold">Rider payment</h2><p className="mt-1 text-xs text-ink-500">Confirm your handover</p></Link></div>
  </div>;
}
