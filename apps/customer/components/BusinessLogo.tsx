"use client";
import {Store} from "lucide-react";
import {useEffect,useState} from "react";
import {api} from "../lib/api";
export function BusinessLogo({id,name,logoKey}:{id:string;name:string;logoKey?:string|null}){const [image,setImage]=useState<{key:string;url:string}|null>(null);useEffect(()=>{if(!logoKey)return;let disposed=false,url:string|undefined;api.restaurantLogoBlob(id,logoKey).then(blob=>{if(disposed)return;url=URL.createObjectURL(blob);setImage({key:logoKey,url});}).catch(()=>{});return()=>{disposed=true;if(url)URL.revokeObjectURL(url);};},[id,logoKey]);return <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))]/80 p-2 shadow-sm backdrop-blur-xl">{image?.key===logoKey&&image?<img src={image.url} alt={`${name} logo`} className="h-full w-full object-contain"/>:<Store size={24} aria-label={`${name} logo not uploaded`}/>}</div>;}
