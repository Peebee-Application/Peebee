"use client";
import {isColourScene,type Restaurant} from "@peebee/shared";
import {useEffect,useState,type ReactNode} from "react";
import {api} from "../lib/api";
import {useResolvedTheme} from "../lib/theme";

/** Owner appearance belongs to business content, never the document/app chrome. */
export function FoodBusinessTheme({id,children}:{id:string;children:ReactNode}) {
  const [business,setBusiness]=useState<Restaurant|null>(null);
  const appTheme=useResolvedTheme();
  const [autoTheme,setAutoTheme]=useState<"light"|"dark">("light");
  useEffect(()=>{let disposed=false;api.getRestaurant(id).then(result=>{if(!disposed)setBusiness(result.restaurant);}).catch(()=>{});return()=>{disposed=true;};},[id]);
  useEffect(()=>{const update=()=>{const hour=new Date().getHours();setAutoTheme(hour>=6&&hour<19?"light":"dark");};update();const timer=setInterval(update,60000);return()=>clearInterval(timer);},[]);
  const themed=!!business&&isColourScene(business.theme_scene);
  const theme=business?.theme_mode==="auto"?autoTheme:business?.theme_mode??appTheme;
  return <div className={`${themed?"food-business-theme ":""}min-h-[inherit] bg-cream text-ink`} data-colour-scene={themed?business?.theme_scene:undefined} data-theme={themed?theme:undefined}>{children}</div>;
}
