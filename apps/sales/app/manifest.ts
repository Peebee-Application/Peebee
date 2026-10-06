import type { MetadataRoute } from 'next';
export default function manifest():MetadataRoute.Manifest{return {name:'Peebee Sales',short_name:'Peebee Sales',start_url:'/',display:'standalone',background_color:'#F7F3EE',theme_color:'#153A75',icons:[{src:'/icons/icon-192.png?v=logo-6',sizes:'192x192',type:'image/png'},{src:'/icons/icon-512.png?v=logo-6',sizes:'512x512',type:'image/png'}]};}
