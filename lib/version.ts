import pkg from "../package.json";

/**
 * The running application version.
 *
 * In the packaged desktop app the Electron main process sets
 * `CCC_APP_VERSION` from `app.getVersion()` before the server boots; everywhere
 * else (web dev, tests) we fall back to the bundled `package.json` version.
 *
 * Used to gate first-run setup: when the value last stamped into settings
 * (`setupVersion`) differs from this, the welcome/provider screen runs again
 * after an update — while the GitHub token and other `userData` stay intact.
 */
export function appVersion(): string {
  return process.env.CCC_APP_VERSION?.trim() || (pkg as { version: string }).version;
}
