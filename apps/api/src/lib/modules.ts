import { MODULES, channelModulePatch, cleanModuleNotice, getModule, resolveModuleAvailability, syncedFlag, type ModuleFlags, type ModuleOfflineDisplay, type ModuleNotices, type ModuleSettings, type ModuleSettingsUpdate } from "@peebee/shared";
import { getChannelsConfig, saveChannelsConfig } from "../channels/settings.js";
import { getSetting, getSettingRaw, rawModuleLive, setSetting, type SettingKey } from "./settings.js";

function parse(raw: string): Record<string, boolean> {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" ? (value as Record<string, boolean>) : {};
  } catch { return {}; }
}

/** Every module's two switches exactly as stored (before the modules above it are applied). */
export async function getModuleFlags(): Promise<ModuleFlags> {
  const [liveJson, practiceJson] = await Promise.all([getSettingRaw("modules_live"), getSettingRaw("modules_practice")]);
  const live = parse(liveJson);
  const practice = parse(practiceJson);
  const values = new Map<string, string>([["modules_live", liveJson], ["channels_config", await getSettingRaw("channels_config")]]);
  await Promise.all(MODULES.filter((x) => x.liveKey).map(async (x) => values.set(x.liveKey!, await getSettingRaw(x.liveKey as SettingKey))));
  return Object.fromEntries(MODULES.map((x) => [x.key, { live: rawModuleLive(x, values), practice: practice[x.key] !== false }]));
}

/** Stored notices, kept only for modules that are off in some world (a note on a module that is on is not shown). */
async function getModuleNotices(flags: ModuleFlags): Promise<ModuleNotices> {
  const stored = parseNotices(await getSettingRaw("modules_notices"));
  return Object.fromEntries(Object.entries(stored).filter(([key]) => flags[key] && (!flags[key]!.live || !flags[key]!.practice)));
}

function parseNotices(raw: string): ModuleNotices {
  try {
    const value = JSON.parse(raw || "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).flatMap(([key, n]) => { const c = cleanModuleNotice(n); return c ? [[key, c]] : []; }));
  } catch { return {}; }
}

export async function isModuleSync(): Promise<boolean> {
  return (await getSettingRaw("modules_sync")) === "1";
}

export async function getOfflineDisplay(): Promise<ModuleOfflineDisplay> {
  return (await getSettingRaw("modules_offline_display")) === "inactive" ? "inactive" : "hide";
}

export async function getModuleSettings(): Promise<ModuleSettings> {
  const [stored, sync] = await Promise.all([getModuleFlags(), isModuleSync()]);
  // Kept the same: show each module's switch as what it really is, on only if on in both worlds.
  const flags = sync ? Object.fromEntries(MODULES.map((x) => [x.key, syncedFlag(x, stored[x.key]!, true)])) : stored;
  return { flags, available: resolveModuleAvailability(flags, sync), notices: await getModuleNotices(flags), sync, display: await getOfflineDisplay() };
}

/** Is this module on in Live right now, counting every module above it? */
export async function isModuleLive(key: string): Promise<boolean> {
  const def = getModule(key);
  if (!def) return true;
  const liveJson = await getSettingRaw("modules_live");
  const values = new Map<string, string>([["modules_live", liveJson], ["channels_config", await getSettingRaw("channels_config")]]);
  const chain = [def];
  for (let up = def.parent ? getModule(def.parent) : undefined; up; up = up.parent ? getModule(up.parent) : undefined) chain.push(up);
  await Promise.all(chain.filter((x) => x.liveKey).map(async (x) => values.set(x.liveKey!, await getSettingRaw(x.liveKey as SettingKey))));
  if (!chain.every((x) => rawModuleLive(x, values))) return false;
  // Kept the same as Practice: off there means off here too.
  if (await isModuleSync()) {
    const practice = parse(await getSettingRaw("modules_practice"));
    if (chain.some((x) => x.practice.coverage !== "none" && practice[x.key] === false)) return false;
  }
  return true;
}

/** Which of these modules are on in Live right now (each counted with every module above it), asked once per key. */
export async function liveModules(keys: readonly string[]): Promise<Record<string, boolean>> {
  const unique = [...new Set(keys)];
  const on = await Promise.all(unique.map((k) => isModuleLive(k)));
  return Object.fromEntries(unique.map((k, i) => [k, on[i]!]));
}

/** Only the keys that exist: anything else in an update is a mistake worth refusing. */
export function unknownModuleKeys(update: ModuleSettingsUpdate): string[] {
  return [...Object.keys(update.live ?? {}), ...Object.keys(update.practice ?? {}), ...Object.keys(update.notices ?? {})].filter((k) => !getModule(k));
}

/**
 * Saves switches. With Live and Practice kept the same, a switch changed in either world is saved to both (off wins if
 * a request names both with different values), and turning the setting on first makes the two agree: anything off in
 * one world is switched off in the other.
 */
export async function setModuleFlags(update: ModuleSettingsUpdate): Promise<void> {
  if (update.display) await setSetting("modules_offline_display", update.display);
  const wasSync = await isModuleSync();
  const sync = update.sync ?? wasSync;
  if (sync !== wasSync) {
    await setSetting("modules_sync", sync ? "1" : "0");
    if (sync) {
      const stored = await getModuleFlags();
      const agree: Record<string, boolean> = {};
      for (const def of MODULES) if (def.practice.coverage !== "none" && stored[def.key]!.live !== stored[def.key]!.practice) agree[def.key] = false;
      if (Object.keys(agree).length) await applyModuleFlags({ live: agree, practice: agree });
    }
  }
  let { live, practice } = update;
  if (sync) {
    live = { ...live }; practice = { ...practice };
    for (const key of new Set([...Object.keys(live), ...Object.keys(practice)])) {
      if (getModule(key)?.practice.coverage === "none") continue;
      const on = (live[key] ?? true) && (practice[key] ?? true);
      live[key] = on; practice[key] = on;
    }
  }
  await applyModuleFlags({ live, practice, notices: update.notices });
}

async function applyModuleFlags(update: ModuleSettingsUpdate): Promise<void> {
  if (update.notices && Object.keys(update.notices).length) {
    const notices = parseNotices(await getSettingRaw("modules_notices"));
    for (const [key, n] of Object.entries(update.notices)) {
      const clean = n && cleanModuleNotice(n);
      if (clean) notices[key] = clean; else delete notices[key];
    }
    await setSetting("modules_notices", JSON.stringify(notices));
  }
  const liveJson = parse(await getSettingRaw("modules_live"));
  let liveJsonChanged = false;
  let channelsPatch: Record<string, unknown> = {};
  for (const [key, on] of Object.entries(update.live ?? {})) {
    const def = getModule(key);
    if (!def) continue;
    if (def.channel) channelsPatch = { ...channelsPatch, ...channelModulePatch(def, nestedPatch(channelsPatch, await getChannelsConfig()), on) };
    else if (def.liveKey) await setSetting(def.liveKey as SettingKey, on ? "1" : "0", { force: true });
    else { liveJson[key] = on; liveJsonChanged = true; }
  }
  if (Object.keys(channelsPatch).length) await saveChannelsConfig(unflatten(channelsPatch));
  if (liveJsonChanged) await setSetting("modules_live", JSON.stringify(liveJson));
  const practiceUpdate = Object.entries(update.practice ?? {}).filter(([k]) => getModule(k));
  if (practiceUpdate.length) {
    const practiceJson = parse(await getSettingRaw("modules_practice"));
    for (const [key, on] of practiceUpdate) practiceJson[key] = on;
    await setSetting("modules_practice", JSON.stringify(practiceJson));
  }
}

/** Boda, Luxury and Ambulance have no older setting, so the booking routes ask here. */

/** {"a.b": 1} becomes {a: {b: 1}}, the shape the Channels config merges. */
function unflatten(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(flat)) {
    const keys = path.split(".");
    let node = out;
    for (const k of keys.slice(0, -1)) node = (node[k] ??= {}) as Record<string, unknown>;
    node[keys[keys.length - 1]!] = value;
  }
  return out;
}

/** The saved Channels config with the not-yet-saved changes laid over it, so two post types switched in one save both stick. */
function nestedPatch(pending: Record<string, unknown>, saved: unknown): unknown {
  const merged = JSON.parse(JSON.stringify(saved)) as Record<string, unknown>;
  const over = unflatten(pending);
  for (const [key, value] of Object.entries(over)) {
    merged[key] = value && typeof value === "object" && !Array.isArray(value) ? { ...((merged[key] as object) ?? {}), ...(value as object) } : value;
  }
  return merged;
}
