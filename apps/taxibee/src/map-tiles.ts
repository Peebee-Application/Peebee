type MapSettings = { provider: string; key?: string | null; lightStyle?: "normal" | "light" };

const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const streetTiles = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: osmAttribution,
};

let settingsRequest: { expires: number; result: Promise<MapSettings> } | undefined;
function loadSettings() {
  if (settingsRequest && Date.now() < settingsRequest.expires) return settingsRequest.result;
  const result = fetch("/api/v1/maps/public", { signal: AbortSignal.timeout(5000) })
    .then(async response => {
      if (!response.ok) throw new Error("Map configuration unavailable");
      return await response.json() as MapSettings;
    })
    .catch(() => {
      settingsRequest = undefined;
      return { provider: "streetmaps" };
    });
  settingsRequest = { expires: Date.now() + 10 * 60_000, result };
  return result;
}

function selectTiles(settings: MapSettings) {
  if (!settings.key) return streetTiles;
  const key = encodeURIComponent(settings.key);
  switch (settings.provider) {
    case "maptiler":
      return { url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${key}`, attribution: `${osmAttribution} &copy; MapTiler` };
    case "stadia":
      return { url: `https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=${key}`, attribution: `${osmAttribution} &copy; Stadia Maps` };
    case "thunderforest":
      return { url: `https://{s}.tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=${key}`, attribution: `${osmAttribution} &copy; Thunderforest` };
    case "jawg": {
      let preference = "auto";
      try { preference = localStorage.getItem("peebee-map-style") ?? "auto"; } catch {}
      const dark = document.documentElement.dataset.theme === "dark";
      const style = preference === "dark" || (preference === "auto" && dark) ? "jawg-dark"
        : preference === "light" || (preference === "auto" && settings.lightStyle === "light") ? "jawg-light"
        : "jawg-sunny";
      return {
        url: `https://tile.jawg.io/${style}/{z}/{x}/{y}{r}.png?access-token=${key}`,
        attribution: '<a href="https://www.jawg.io/">&copy; JawgMaps</a> · <a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap</a>',
      };
    }
    case "tomtom":
      return { url: `https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${key}`, attribution: "&copy; TomTom" };
    case "mapbox":
      return {
        url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}{r}.png?access_token=${key}`,
        attribution: `${osmAttribution} &copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a>`,
      };
    default:
      return streetTiles;
  }
}

export function addConfiguredMapTiles(
  leaflet: any,
  map: any,
  fallback?: HTMLElement | null,
  attributionPosition: "topleft" | "topright" | "bottomleft" | "bottomright" = "topright",
) {
  let active = true;
  let layer: any;
  let url = "";
  const applyTiles = (settings: MapSettings) => {
    if (!active || !map.getContainer().isConnected) return;
    const tiles = selectTiles(settings);
    if (url === tiles.url) return;
    if (layer) map.removeLayer(layer);
    const attribution = map.attributionControl ?? leaflet.control.attribution({ position: attributionPosition, prefix: false }).addTo(map);
    attribution.setPosition(attributionPosition);
    attribution.setPrefix(false);
    layer = leaflet.tileLayer(tiles.url, { maxZoom: 19, attribution: tiles.attribution });
    if (fallback) {
      let loaded = false;
      layer.on("tileload", () => { loaded = true; fallback.hidden = true; });
      layer.on("load", () => { fallback.hidden = loaded; });
    }
    layer.addTo(map);
    url = tiles.url;
  };
  void loadSettings().then(settings => {
    applyTiles(settings);
    if (!active || settings.provider !== "jawg") return;
    const redraw = () => applyTiles(settings);
    const observer = new MutationObserver(redraw);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("peebee-map-style-change", redraw);
    map.once("unload", () => {
      observer.disconnect();
      window.removeEventListener("peebee-map-style-change", redraw);
    });
  });
  map.once("unload", () => { active = false; });
}
