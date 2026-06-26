import * as pty from "node-pty";
import { resolveClaudeBin } from "./claude-runner";
import { parseUsagePanel, type ParsedUsage } from "../usage-parse";

/**
 * Drives a throwaway interactive `claude` session to read the `/usage` panel —
 * the only place the real session-limit percentages are surfaced. Boots the
 * TUI, types `/usage`, waits for the panel to render, scrapes it, and kills the
 * PTY. No prompt is sent to the model, so this costs ~no quota: `/usage` is a
 * local panel ("based on local sessions on this machine").
 */

const BOOT_MS = 6_000; // let the TUI finish booting before typing
const POLL_MS = 1_500; // re-check the buffer for a rendered panel
const HARD_MS = 28_000; // absolute cap — kill no matter what

export type ScrapeResult =
  | { ok: true; parsed: ParsedUsage }
  | { ok: false; error: string };

export function scrapeUsage(): Promise<ScrapeResult> {
  return new Promise((resolve) => {
    let term: pty.IPty | null = null;
    let buf = "";
    let done = false;
    const timers: NodeJS.Timeout[] = [];

    const finish = (r: ScrapeResult) => {
      if (done) return;
      done = true;
      for (const t of timers) clearTimeout(t);
      try {
        term?.kill();
      } catch {
        /* already gone */
      }
      resolve(r);
    };

    try {
      term = pty.spawn(resolveClaudeBin(), ["--dangerously-skip-permissions"], {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        // Scrape from the server's own (trusted) working dir — an untrusted
        // folder would pop a "trust this folder?" dialog that swallows /usage.
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
      });
    } catch (e) {
      finish({ ok: false, error: `spawn failed: ${(e as Error).message}` });
      return;
    }

    term.onData((d) => {
      buf += d;
    });
    term.onExit(() =>
      finish({ ok: false, error: "claude exited before the usage panel rendered" }),
    );

    // Boot, then type /usage.
    timers.push(
      setTimeout(() => {
        try {
          term?.write("/usage\r");
        } catch {
          /* ignore */
        }
        // Re-check the buffer until a complete panel parses (or we hit the cap).
        const poll = setInterval(() => {
          const parsed = parseUsagePanel(buf);
          if (parsed) {
            clearInterval(poll);
            finish({ ok: true, parsed });
          }
        }, POLL_MS);
        timers.push(poll as unknown as NodeJS.Timeout);
      }, BOOT_MS),
    );

    // Absolute safety net: parse whatever we have, then give up.
    timers.push(
      setTimeout(() => {
        const parsed = parseUsagePanel(buf);
        finish(
          parsed
            ? { ok: true, parsed }
            : { ok: false, error: "timed out before the usage panel rendered" },
        );
      }, HARD_MS),
    );
  });
}
