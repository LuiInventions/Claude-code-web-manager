import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Linting runs as a dedicated step (`npm run lint`); keep it out of the
  // production build so build success never depends on the lint config.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
