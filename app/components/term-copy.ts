import type { Terminal } from "@xterm/xterm";

export async function copyText(text: string): Promise<void> {
  const desktop = window.cccDesktop;
  if (desktop?.copyText) {
    await desktop.copyText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

/**
 * Ctrl+C copies when a selection exists and otherwise still reaches the CLI.
 * Ctrl+Shift+C always copies. Right-click copies a selection.
 */
export function enableTermCopy(term: Terminal, el: HTMLElement): void {
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== "keydown") return true;
    const key = ev.key.toLowerCase();
    const accel = ev.ctrlKey || ev.metaKey;
    if (!accel || ev.altKey || key !== "c") return true;
    if (!ev.shiftKey && !term.hasSelection()) return true;
    const text = term.getSelection();
    if (!text) return true;
    void copyText(text);
    return false;
  });

  el.addEventListener("contextmenu", (ev) => {
    const text = term.getSelection();
    if (!text) return;
    ev.preventDefault();
    void copyText(text);
  });
}
