import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Peebee Car",
    short_name: "Peebee Car",
    description: "Own or drive a car on Peebee.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F9F6F0",
    theme_color: "#153A75",
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png?v=logos-3", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png?v=logos-3", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
