import { createRequire } from "node:module";

// Next's file tracer globs absolute paths. On Windows that walk enters the
// user profile and scandir throws EPERM on every legacy junction it meets
// (Application Data, Cookies, Documents\My Music, …). Directories outside
// this repo that cannot be read are not app files; treat them as empty.
const require = createRequire(import.meta.url);
const fs = require("node:fs");
const path = require("node:path");
const projectRoot = process.cwd();

function outsideProject(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  const rel = path.relative(projectRoot, path.resolve(value));
  return rel.startsWith("..") || path.isAbsolute(rel);
}

function isDeniedOutside(err, target) {
  if (!err || (err.code !== "EPERM" && err.code !== "EACCES")) return false;
  return outsideProject(String(err.path || "")) || outsideProject(target);
}

const readdirSync = fs.readdirSync;
fs.readdirSync = function (target, options) {
  try {
    return readdirSync.call(this, target, options);
  } catch (err) {
    if (isDeniedOutside(err, target)) return [];
    throw err;
  }
};

// The tracer uses the async glob, which calls fs.readdir, not readdirSync.
const readdir = fs.readdir;
fs.readdir = function (target, options, callback) {
  let cb = callback;
  let opts = options;
  if (typeof options === "function") {
    cb = options;
    opts = undefined;
  }
  if (typeof cb !== "function") return readdir.call(this, target, options, callback);
  const done = (err, entries) => {
    if (isDeniedOutside(err, target)) cb(null, []);
    else cb(err, entries);
  };
  if (opts === undefined) return readdir.call(this, target, done);
  return readdir.call(this, target, opts, done);
};

const readdirPromise = fs.promises.readdir;
fs.promises.readdir = async function (target, options) {
  try {
    return await readdirPromise.call(this, target, options);
  } catch (err) {
    if (isDeniedOutside(err, target)) return [];
    throw err;
  }
};

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
