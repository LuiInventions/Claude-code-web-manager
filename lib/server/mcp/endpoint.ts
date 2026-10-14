import { writeJson } from "../../store";

let currentUrl: string | null = null;

export function mcpUrl(): string | null {
  return currentUrl;
}

/** Remember the loopback URL in `.data/mcp.json` so a client can find this process. */
export function publishMcpEndpoint(host: string, port: number): string {
  currentUrl = `http://${host}:${port}/mcp`;
  writeJson("mcp.json", {
    name: "jarvis-control-center",
    transport: "streamable-http",
    url: currentUrl,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  return currentUrl;
}

export function unpublishMcpEndpoint(): void {
  currentUrl = null;
  writeJson("mcp.json", {
    name: "jarvis-control-center",
    transport: "streamable-http",
    url: null,
    pid: process.pid,
    stoppedAt: new Date().toISOString(),
  });
}
