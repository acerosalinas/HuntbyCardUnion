import type { MetadataRoute } from "next";

/**
 * Lets a phone treat the site as an installable app. With this, "Add to Home Screen" opens the site in its own
 * window every time (no browser tabs or address bar) instead of a new browser tab, like a normal app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hunt by Card Union",
    short_name: "Hunt",
    description: "Private card-collecting marketplace with live dibs claiming.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b132b",
    theme_color: "#0b132b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
