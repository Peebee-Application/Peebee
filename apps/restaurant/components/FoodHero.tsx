import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
export function FoodHero() {
  return <section className="food-hero">
    <img src="/brand/food-hero.webp" alt="Fresh Ugandan food, a Rolex roll and golden pastries" width={1536} height={1024}/>
    <div className="food-hero-copy"><p className="text-xs font-bold uppercase tracking-widest">Peebee Food</p><h2>Good food.<br/>More people.</h2><p className="mt-3 text-sm">Your kitchen. Your craft.<br/>A whole community to serve.</p><Link href="/menu" className="food-hero-cta">Manage menu <ArrowRight size={16}/></Link></div>
  </section>;
}
