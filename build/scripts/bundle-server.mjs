// Bundles the custom server (start + lib) to a single CJS file Electron requires,
// and compiles the electron main/preload/secrets entries to JS.
// Native + framework deps stay external (resolved from node_modules, asarUnpacked).
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const electronDir = path.join(root, "build", "electron");

await build({
  entryPoints: [path.join(root, "lib", "server", "start.ts")],
  outfile: path.join(electronDir, "dist", "server.cjs"),
  platform: "node",
  format: "cjs",
  bundle: true,
  target: "node20",
  external: ["next", "node-pty", "electron", "openai", "ws"],
  banner: { js: "// generated — do not edit" },
});

await build({
  entryPoints: [
    path.join(electronDir, "main.ts"),
    path.join(electronDir, "preload.ts"),
    path.join(electronDir, "secrets.ts"),
  ],
  outdir: electronDir,
  platform: "node",
  format: "cjs",
  bundle: false,
  target: "node20",
});

console.log("bundled server + electron entries");
