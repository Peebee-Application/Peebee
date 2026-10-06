import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Peebee Merchant",
    short_name: "Peebee Merchant",
    description: "Accept Peebee payments and manage merchant settlements.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F9F6F0",
    theme_color: "#153A75",
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png?v=logo-6", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png?v=logo-6", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
