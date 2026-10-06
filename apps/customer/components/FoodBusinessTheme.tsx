"use client";
import {DEFAULT_COLOUR_SCENE,type Restaurant} from "@peebee/shared";
import {BusinessTheme} from "@peebee/shared/business-theme";
import {useEffect,useState} from "react";
import {api} from "../lib/api";
export function FoodBusinessTheme({id}:{id:string}){const [business,setBusiness]=useState<Restaurant|null>(null);useEffect(()=>{let disposed=false;setBusiness(null);api.getRestaurant(id).then(result=>{if(!disposed)setBusiness(result.restaurant);}).catch(()=>{});return()=>{disposed=true;};},[id]);return business?<BusinessTheme scene={business.theme_scene??DEFAULT_COLOUR_SCENE} mode={business.theme_mode}/>:null;}
