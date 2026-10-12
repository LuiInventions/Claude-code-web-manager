/**
 * How to start VS Codium or VS Code. On Windows the PATH entry is a `.cmd`
 * shim. Spawning that file directly yields no stdout, so `serve-web --help`
 * looks like a missing command.
 */

export interface SpawnSpec {
  file: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

/** Spawn argv for an editor binary. Batch files go through `cmd.exe /d /s /c`. */
export function editorSpawnSpec(
  bin: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comspec = process.env.ComSpec || "cmd.exe",
): SpawnSpec {
  const batch = platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  if (!batch) return { file: bin, args };
  const line = [quoteCmdArg(bin), ...args.map(quoteCmdArg)].join(" ");
  // `/s` strips one leading and one trailing quote. The extra quote keeps a
  // path that contains spaces as a single command.
  return {
    file: comspec,
    args: ["/d", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
  };
}

function quoteCmdArg(part: string): string {
  if (part.length === 0) return '""';
  if (!/[\s"&|<>^%]/.test(part)) return part;
  return `"${part.replace(/"/g, '""')}"`;
}

/**
 * `where` lists `code`, `code.cmd`, and sometimes `Code.exe`. The `.cmd`
 * shim is the one that runs the CLI.
 */
export function preferEditorHit(paths: string[]): string | null {
  const usable = paths.map((p) => p.trim()).filter(Boolean);
  return (
    usable.find((p) => /\.(cmd|bat)$/i.test(p)) ||
    usable.find((p) => /\.exe$/i.test(p)) ||
    usable[0] ||
    null
  );
}

/** Standard install paths, VS Codium before VS Code. Empty off Windows. */
export function installedEditorCandidates(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string[] {
  if (platform !== "win32") return [];
  const local = env.LOCALAPPDATA;
  const pf = env.ProgramFiles;
  const pf86 = env["ProgramFiles(x86)"];
  const pairs: Array<[string | undefined, string]> = [
    [local, "Programs\\VSCodium\\bin\\codium.cmd"],
    [pf, "VSCodium\\bin\\codium.cmd"],
    [local, "Programs\\Microsoft VS Code\\bin\\code.cmd"],
    [pf, "Microsoft VS Code\\bin\\code.cmd"],
    [pf86, "Microsoft VS Code\\bin\\code.cmd"],
  ];
  return pairs.flatMap(([root, rel]) => (root ? [`${root}\\${rel}`] : []));
}

/** Editor help is sometimes UTF-16 on a Windows pipe. ASCII search needs text. */
export function decodeCliOutput(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString("utf16le");
  }
  let zeros = 0;
  const n = Math.min(buf.length, 32);
  for (let i = 1; i < n; i += 2) if (buf[i] === 0) zeros += 1;
  if (n >= 8 && zeros * 2 >= n - 1) return buf.toString("utf16le");
  return buf.toString("utf8");
}
