import type { MetadataRoute } from "next";

// The whole site is invite-only (see proxy.ts), so there is nothing for search engines to index.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
