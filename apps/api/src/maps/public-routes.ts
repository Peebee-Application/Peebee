import { Hono } from "hono";
import { getActiveMapsProvider, getJawgLightStyle } from "../lib/settings.js";
import { getMapsCredential } from "./credentials.js";

export const publicMapsRoutes = new Hono();

// Only the active basemap and its browser credential are needed by guest maps.
// Other Peebee settings and credentials remain behind their existing guards.
publicMapsRoutes.get("/maps/public", async (c) => {
  const provider = await getActiveMapsProvider();
  switch (provider) {
    case "jawg":
      return c.json({
        provider,
        key: await getMapsCredential(provider, "accessToken") ?? null,
        lightStyle: await getJawgLightStyle(),
      });
    case "mapbox": {
      const token = await getMapsCredential(provider, "accessToken");
      return c.json({ provider, key: token?.startsWith("pk.") ? token : null });
    }
    case "maptiler":
    case "stadia":
    case "thunderforest":
    case "tomtom":
      return c.json({ provider, key: await getMapsCredential(provider, "apiKey") ?? null });
    default:
      return c.json({ provider });
  }
});
