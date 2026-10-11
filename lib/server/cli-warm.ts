import { spawn } from "node:child_process";
import { getConfig } from "../config";
import { getCodeCli, spawnEnv } from "../code-clis";
import { resolveCliBin } from "./cli-bin";

/**
 * Page the selected CLI into the OS file cache so the next PTY opens faster.
 *
 * This runs `bin --version` and exits. It does not start a session, send a
 * prompt, or keep a warm pool of agents. v1.8 pre-spawned six live Claude
 * sessions and was removed because those sessions raced the launcher.
 */

let warmedFor: string | null = null;

export function warmCodeCli(): void {
  const id = getConfig().codeCli;
  if (warmedFor === id) return;
  warmedFor = id;

  const binName = getCodeCli(id).bin;
  const configured =
    id === "claude" && getConfig().claudeBin && getConfig().claudeBin !== "claude"
      ? getConfig().claudeBin
      : null;
  const bin = configured || resolveCliBin(binName);
  if (!bin) return;

  try {
    const child = spawn(bin, ["--version"], {
      env: spawnEnv(id),
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }, 8000);
    timer.unref?.();
    child.unref?.();
    child.on("exit", () => clearTimeout(timer));
    child.on("error", () => clearTimeout(timer));
  } catch {
    /* missing binary — the session start reports that */
  }
}
