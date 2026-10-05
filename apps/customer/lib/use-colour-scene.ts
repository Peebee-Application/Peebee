"use client";

import { useSyncExternalStore } from "react";
import { COLOUR_SCENE_KEY, DEFAULT_COLOUR_SCENE, isColourScene, type ColourScene } from "./colour-scenes";

const EVENT = "peebee-colour-scene-change";

function readScene(): ColourScene {
  const applied = document.documentElement.getAttribute("data-colour-scene");
  return isColourScene(applied) ? applied : DEFAULT_COLOUR_SCENE;
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== COLOUR_SCENE_KEY && event.key !== null) return;
    const scene = isColourScene(event.newValue) ? event.newValue : DEFAULT_COLOUR_SCENE;
    document.documentElement.setAttribute("data-colour-scene", scene);
    onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useColourScene() {
  const scene = useSyncExternalStore(subscribe, readScene, () => DEFAULT_COLOUR_SCENE);
  function setScene(next: ColourScene) {
    document.documentElement.setAttribute("data-colour-scene", next);
    try { localStorage.setItem(COLOUR_SCENE_KEY, next); } catch {}
    window.dispatchEvent(new Event(EVENT));
  }
  return { scene, setScene };
}
