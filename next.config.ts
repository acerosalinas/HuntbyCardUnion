import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Server Actions default to a 1MB body limit. Bulk Upload sends up to
      // 30 photos in one request through uploadCardImages() (app/admin/
      // actions.ts), each already capped at MAX_IMAGE_BYTES (20MB) in
      // lib/imageAccept.ts - 30 * 20MB plus multipart overhead is the
      // real worst case this needs to fit, not an arbitrary round number.
      bodySizeLimit: "650mb",
    },
  },
};

export default nextConfig;
