/** @type {import('next').NextConfig} */
const nextConfig = {
  // Linting runs as a dedicated step (`npm run lint`); keep it out of the
  // production build so build success never depends on the lint config.
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // The vendored pixel-agents office (app/components/sessions/office/**) uses
    // `.js` import specifiers that point at TypeScript sources (NodeNext/bundler
    // style). tsc resolves these via moduleResolution:"bundler", but webpack
    // needs an explicit extension alias to map `.js` → `.ts`/`.tsx`. Without it
    // the office modules fail to resolve at build time.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
