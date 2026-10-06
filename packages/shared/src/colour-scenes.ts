/** Colours follow the supplied swatches rather than the text printed on them. */
export const COLOUR_SCENES = [
  { id: "cove", name: "Cove", colours: ["#0878bc", "#30a4dc", "#ffcf79", "#ffe4af"] },
  { id: "forest", name: "Forest", colours: ["#49651d", "#8ca63d", "#d5d36d", "#faedbc"] },
  { id: "viola", name: "Viola", colours: ["#7e2096", "#c452b6", "#ffcc76", "#ffe4ad"] },
  { id: "violet-dusk", name: "Violet Dusk", colours: ["#55325d", "#965477", "#f5d9bf", "#f8f4e9"] },
  { id: "luigi", name: "Luigi", colours: ["#2caf57", "#7bcb68", "#c0dc71", "#ffe4ae"] },
  { id: "sunset", name: "Sunset", colours: ["#eb6511", "#f99225", "#fabb32", "#ffe4b1"] },
  { id: "blush", name: "Blush", colours: ["#9d1548", "#c44860", "#ff8053", "#ffd18d"] },
  { id: "sicily", name: "Sicily", colours: ["#235abc", "#77b9fa", "#fff1af", "#ffbf19"] },
  { id: "ocean-blue", name: "Ocean Blue", colours: ["#08065f", "#047daf", "#45c5de", "#c9eff5"] },
  { id: "marple", name: "Marple", colours: ["#c52a53", "#ff676b", "#ffb477", "#ffe3af"] },
] as const;

export type ColourScene = (typeof COLOUR_SCENES)[number]["id"];
export const COLOUR_SCENE_KEY = "peebee-colour-scene";
export const DEFAULT_COLOUR_SCENE: ColourScene = "cove";

export function isColourScene(value: unknown): value is ColourScene {
  return COLOUR_SCENES.some((scene) => scene.id === value);
}

// Runs alongside the existing light/dark initializer before the first paint.
export const COLOUR_SCENE_INIT_SCRIPT = `
(function () {
  var scene = "${DEFAULT_COLOUR_SCENE}";
  try {
    var saved = localStorage.getItem("${COLOUR_SCENE_KEY}");
    if (${JSON.stringify(COLOUR_SCENES.map((scene) => scene.id))}.indexOf(saved) !== -1) scene = saved;
  } catch (e) {}
  document.documentElement.setAttribute("data-colour-scene", scene);
})();
`;
