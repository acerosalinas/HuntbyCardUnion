import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Server Actions default to a 1MB body limit. Bulk Upload sends up to
      // 30 photos in one request through uploadCardImages() (app/admin/
      // actions.ts), each already capped at MAX_IMAGE_BYTES (8MB) in
      // lib/imageValidation.ts - 30 * 8MB plus multipart overhead is the
      // real worst case this needs to fit, not an arbitrary round number.
      bodySizeLimit: "250mb",
    },
  },
};

export default nextConfig;
