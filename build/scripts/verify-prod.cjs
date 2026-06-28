// Headless check of the PACKAGED server code path: load the bundled server.cjs,
// start it with an explicit `dir` (as Electron main does), probe the page + an
// API route, then exit. Self-terminates so no process lingers.
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const { startServer } = require(path.join(root, "build", "electron", "dist", "server.cjs"));

const HARD_TIMEOUT = setTimeout(() => {
  console.error("VERIFY: timed out");
  process.exit(2);
}, 45000);

(async () => {
  const srv = await startServer({ quiet: true, dir: root });
  const base = `http://${srv.host}:${srv.port}`;
  let ok = true;

  for (const [label, url] of [
    ["page /", `${base}/`],
    ["api /api/settings", `${base}/api/settings`],
  ]) {
    try {
      const r = await fetch(url);
      const body = await r.text();
      console.log(`VERIFY ${label}: HTTP ${r.status}, ${body.length} bytes`);
      if (r.status !== 200) ok = false;
    } catch (e) {
      console.error(`VERIFY ${label}: FAIL ${e.message}`);
      ok = false;
    }
  }

  await srv.close();
  clearTimeout(HARD_TIMEOUT);
  console.log(ok ? "VERIFY: OK" : "VERIFY: FAILED");
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("VERIFY: error", e);
  process.exit(1);
});
