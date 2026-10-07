"use client";
import {isColourScene,type Restaurant} from "@peebee/shared";
import {useEffect,useState,type ReactNode} from "react";
import {api} from "../lib/api";
import {useResolvedTheme} from "../lib/theme";

/** The owner chooses the colours; the customer chooses their light/dark variant. */
export function FoodBusinessTheme({id,children}:{id:string;children:ReactNode}) {
  const [business,setBusiness]=useState<Restaurant|null>(null);
  const appTheme=useResolvedTheme();
  useEffect(()=>{let disposed=false;api.getRestaurant(id).then(result=>{if(!disposed)setBusiness(result.restaurant);}).catch(()=>{});return()=>{disposed=true;};},[id]);
  const themed=!!business&&isColourScene(business.theme_scene);
  return <div className={`${themed?"food-business-theme ":""}min-h-[inherit] bg-cream text-ink`} data-colour-scene={themed?business?.theme_scene:undefined} data-theme={themed?appTheme:undefined}>{children}</div>;
}
