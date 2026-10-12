// Preload for `next build` on Windows only. Next's file tracer globs absolute
// paths and scandir throws EPERM on legacy profile junctions (Application
// Data, Cookies, Documents\My Music, …). Those directories are outside the
// repo. This file must not be imported by the app: Electron bundles
// next.config into server.cjs, and a createRequire(import.meta.url) there
// crashes startup because the bundle is CommonJS.
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
