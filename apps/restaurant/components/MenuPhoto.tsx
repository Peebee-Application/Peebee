"use client";
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
export function MenuPhoto({id,hasPhoto}:{id:string;hasPhoto:boolean}) {
  const [url,setUrl]=useState<string|null>(null);
  useEffect(()=>{let cancelled=false;let objectUrl:string|undefined;setUrl(null);
    if(hasPhoto)api.menuItemPhotoBlob(id).then(blob=>{if(!cancelled&&blob.type.startsWith("image/")){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(()=>{});
    return()=>{cancelled=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[id,hasPhoto]);
  return <img src={url??'/brand/food-hero.webp'} alt={url?'Menu item photo':'Food illustration'} width={320} height={240} className="mb-3 aspect-[4/3] w-full rounded-xl object-cover" loading="lazy"/>;
}
