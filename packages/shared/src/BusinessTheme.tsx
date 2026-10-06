"use client";
import {useEffect} from "react";
import {DEFAULT_COLOUR_SCENE,isColourScene,type ColourScene} from "./colour-scenes.js";
type Mode="auto"|"light"|"dark";
function resolved(mode:Mode){if(mode!=="auto")return mode;const hour=new Date().getHours();return hour>=6&&hour<19?"light":"dark";}
/** Temporary business scope: never overwrites the customer's saved preference. */
export function BusinessTheme({scene,mode}:{scene?:ColourScene|null;mode?:Mode|null}){
 useEffect(()=>{
  if(!isColourScene(scene))return;
  const root=document.documentElement,oldScene=root.getAttribute("data-colour-scene"),oldTheme=root.getAttribute("data-theme");
  const apply=()=>{if(root.getAttribute("data-colour-scene")!==scene)root.setAttribute("data-colour-scene",scene);if(mode&&root.getAttribute("data-theme")!==resolved(mode))root.setAttribute("data-theme",resolved(mode));};
  apply();const observer=new MutationObserver(apply);observer.observe(root,{attributes:true,attributeFilter:["data-colour-scene","data-theme"]});const timer=mode==="auto"?setInterval(apply,30000):undefined;
  return()=>{observer.disconnect();if(timer)clearInterval(timer);let savedScene:string|null=null,savedMode:string|null=null;try{savedScene=localStorage.getItem("peebee-colour-scene");savedMode=localStorage.getItem("peebee-theme");}catch{}root.setAttribute("data-colour-scene",isColourScene(savedScene)?savedScene:oldScene??DEFAULT_COLOUR_SCENE);if(mode)root.setAttribute("data-theme",savedMode==="dark"||savedMode==="light"||savedMode==="auto"?resolved(savedMode):oldTheme??"light");};
 },[scene,mode]);return null;
}
