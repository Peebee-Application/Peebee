import { nextHomeTemplate, pickHomeShortcuts, type HomeShortcut, type HomeTemplateId, type HomeTemplatesSettings } from "@peebee/shared";

export type HomeSelection = { template: HomeTemplateId; shortcuts: string[] };
export function initialHomeSelection(raw: string | null, config: HomeTemplatesSettings, available: readonly HomeShortcut[], random = Math.random): HomeSelection {
  const previous = restoreHomeSelection(raw, config, available);
  return config.rotateOnReturn ? chooseHomeSelection(config, available, previous?.template, random) : previous ?? chooseHomeSelection(config, available, undefined, random);
}
export function chooseHomeSelection(config: HomeTemplatesSettings, available: readonly HomeShortcut[], previous?: HomeTemplateId, random = Math.random): HomeSelection {
  return { template: nextHomeTemplate(config.templates, previous, random), shortcuts: pickHomeShortcuts(available, config, random).map((s) => s.id) };
}
export function restoreHomeSelection(raw: string | null, config: HomeTemplatesSettings, available: readonly HomeShortcut[]): HomeSelection | null {
  try {
    const saved = JSON.parse(raw || "null") as HomeSelection | null;
    if (!saved || !config.templates.includes(saved.template) || !Array.isArray(saved.shortcuts)
      || saved.shortcuts.length !== Math.min(config.shortcutCount, available.length)
      || new Set(saved.shortcuts).size !== saved.shortcuts.length
      || saved.shortcuts.some((id) => !available.some((s) => s.id === id))) return null;
    return { template: saved.template, shortcuts: saved.shortcuts };
  } catch { return null; }
}

export type HomeRotationSafety = {
  visible: boolean; paused: boolean; overlay: boolean; focused: boolean;
  pointerDown: boolean; hovered: boolean; lastInteraction: number; now: number; quietSeconds: number;
};
export function canRotateHome(safety: HomeRotationSafety): boolean {
  return safety.visible && !safety.paused && !safety.overlay && !safety.focused && !safety.pointerDown && !safety.hovered
    && safety.now - safety.lastInteraction >= safety.quietSeconds * 1000;
}
