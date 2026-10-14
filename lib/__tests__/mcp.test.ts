import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { filesWrite, filesRead } from "../server/mcp/actions/files";
import { githubUpdateRepo } from "../server/mcp/actions/github";
import { findSavedServer, remoteSavedServers } from "../server/mcp/actions/remote";
import { killPtySession } from "../server/claude-pty";
import { jarvisSystemPrompt } from "../server/jarvis/prompt";
import { listActiveSessions, sessionCount, sessionInfoByNumber } from "../server/mcp/actions/sessions";
import { MCP_INSTRUCTIONS } from "../server/mcp/server";
import { queueCopy } from "../server/mcp/actions/ui";
import { resolveUnder, searchTree, uploadLocalImages, uploadLocalTree } from "../server/mcp/actions/transfer";
import { githubSessionStart, localSessionStart } from "../server/mcp/actions/workspace";
import { removeImageSetCache } from "../server/image-set-cache";
import { resetRememberedRepo } from "../server/mcp/selection";
import { resolveSection } from "../server/mcp/sections";
import { listenMcp } from "../server/mcp/http";
import { drainUiCommands, resetUiCommands } from "../server/ui-commands";

afterEach(() => {
  resetUiCommands();
});

describe("mcp sections", () => {
  it("maps sidebar names onto the window section ids", () => {
    expect(resolveSection("local")).toBe("launcher");
    expect(resolveSection("github")).toBe("github-launch");
    expect(resolveSection("repos")).toBe("github");
    expect(resolveSection("settings")).toBe("settings");
    expect(resolveSection("nope")).toBeNull();
  });
});

describe("mcp guards", () => {
  it("refuses to commit and push without confirm", async () => {
    await expect(githubUpdateRepo("someone/repo", false)).rejects.toThrow(/confirm true/);
  });
});

describe("mcp files", () => {
  it("writes and reads a text file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccc-mcp-"));
    const file = path.join(dir, "note.txt");
    const wrote = await filesWrite(file, "hallo mcp");
    expect(wrote.bytes).toBeGreaterThan(0);
    const read = await filesRead(file);
    expect(read.content).toBe("hallo mcp");
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("mcp drive tools", () => {
  it("rejects a session count outside 1 to 6", () => {
    expect(sessionCount(undefined)).toBe(1);
    expect(sessionCount(6)).toBe(6);
    expect(() => sessionCount(0)).toThrow(/1 to 6/);
    expect(() => sessionCount(7)).toThrow(/1 to 6/);
  });

  it("keeps a path inside its folder", () => {
    const root = path.join(os.tmpdir(), "ccc-root");
    expect(resolveUnder(root, "src")).toBe(path.resolve(root, "src"));
    expect(() => resolveUnder(root, "../outside")).toThrow(/outside/);
  });

  it("searches names under a folder and skips dependency folders", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccc-mcp-search-"));
    await fs.writeFile(path.join(root, "note.txt"), "x");
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "skip-note.txt"), "x");
    const found = await searchTree(root, "NOTE");
    expect(found.entries.map((entry) => entry.name)).toContain("note.txt");
    expect(found.entries.map((entry) => entry.name)).not.toContain("skip-note.txt");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("copies a file and a folder into a destination", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccc-mcp-up-"));
    const src = await fs.mkdtemp(path.join(os.tmpdir(), "ccc-mcp-src-"));
    const dest = path.join(root, "dest");
    await fs.mkdir(path.join(src, "sub"), { recursive: true });
    await fs.mkdir(dest);
    await fs.writeFile(path.join(src, "a.txt"), "hi");
    await fs.writeFile(path.join(src, "sub", "b.txt"), "yo");
    const saved = await uploadLocalTree(dest, [path.join(src, "a.txt"), path.join(src, "sub")]);
    expect(saved.files).toBe(2);
    expect(await fs.readFile(path.join(dest, "a.txt"), "utf8")).toBe("hi");
    expect(await fs.readFile(path.join(dest, "sub", "b.txt"), "utf8")).toBe("yo");
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(src, { recursive: true, force: true });
  });

  it("puts images in an image_set folder and returns the paste sentence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccc-mcp-img-"));
    const png = path.join(root, "pic.png");
    await fs.writeFile(png, Buffer.from([137, 80, 78, 71]));
    const saved = await uploadLocalImages(root, [png]);
    expect(saved.folder).toMatch(/^image_set[a-zA-Z]{8}$/);
    expect(saved.prompt).toBe(`in ${saved.path} sind die bilder:`);
    expect(await fs.readFile(path.join(root, saved.folder, "pic.png"))).toEqual(Buffer.from([137, 80, 78, 71]));
    await removeImageSetCache(saved.folder);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("queues a clipboard copy and returns the path", () => {
    const copied = queueCopy("launcher", "C:\\work\\demo");
    expect(copied.path).toBe("C:\\work\\demo");
    const queued = drainUiCommands();
    expect(queued).toHaveLength(1);
    expect(queued[0].section).toBe("launcher");
    expect(queued[0].payload).toEqual({ kind: "copy-text", text: "C:\\work\\demo" });
  });

  it("does not start a session when the folder is missing", async () => {
    const missing = path.join(os.tmpdir(), "ccc-mcp-missing-folder");
    await expect(localSessionStart({ path: missing, count: 2 })).rejects.toThrow(/outside|not found|Not a folder/i);
  });

  it("does not start a repo session before one is selected", async () => {
    resetRememberedRepo();
    await expect(githubSessionStart({ count: 1 })).rejects.toThrow(/github_select_repo/);
  });

  it("lists saved servers without a password field", () => {
    const listed = remoteSavedServers();
    expect(Array.isArray(listed.servers)).toBe(true);
    expect(JSON.stringify(listed)).not.toContain('"password"');
    expect(() => findSavedServer("not-a-saved-server")).toThrow(/remote_saved_servers/);
  });
});

describe("numbered sessions", () => {
  const ids: string[] = [];

  function seed(row: {
    id: string;
    buffer: string;
    status: "running" | "done";
    startedAt: number;
    where?: "remote";
    origin?: "github";
    projectName: string;
  }) {
    const g = globalThis as { __claudePtySessions?: Map<string, unknown> };
    const map = g.__claudePtySessions;
    if (!map) throw new Error("pty registry missing");
    ids.push(row.id);
    map.set(row.id, {
      id: row.id,
      term: { onData() {}, onExit() {}, write() {}, resize() {}, kill() {} },
      buffer: row.buffer,
      status: row.status,
      lastDataAt: row.startedAt,
      clients: new Set(),
      meta: {
        cwd: `C:\\work\\${row.projectName}`,
        prompt: "",
        model: "",
        effort: "",
        cli: "claude",
        where: row.where,
        origin: row.origin,
        projectName: row.projectName,
        batchId: "",
        startedAt: row.startedAt,
      },
    });
  }

  afterEach(() => {
    for (const id of ids) killPtySession(id);
    ids.length = 0;
  });

  it("numbers running sessions oldest first inside each area", () => {
    seed({ id: "gh-new", buffer: "new", status: "running", startedAt: 300, origin: "github", projectName: "new" });
    seed({ id: "gh-old", buffer: "\u001b[31mold text\u001b[0m", status: "running", startedAt: 100, origin: "github", projectName: "old" });
    seed({ id: "gh-mid", buffer: "middle", status: "running", startedAt: 200, origin: "github", projectName: "mid" });
    seed({ id: "gh-done", buffer: "gone", status: "done", startedAt: 50, origin: "github", projectName: "done" });
    seed({ id: "local-1", buffer: "local", status: "running", startedAt: 150, projectName: "local" });
    seed({ id: "remote-1", buffer: "remote", status: "running", startedAt: 180, where: "remote", projectName: "remote" });

    const github = listActiveSessions("github").sessions;
    expect(github.map((row) => row.label)).toEqual(["session 1", "session 2", "session 3"]);
    expect(github.map((row) => row.id)).toEqual(["gh-old", "gh-mid", "gh-new"]);
    expect(listActiveSessions("local").sessions.map((row) => row.id)).toEqual(["local-1"]);
    expect(listActiveSessions("remote").sessions.map((row) => row.id)).toEqual(["remote-1"]);

    const info = sessionInfoByNumber("github", 1);
    expect(info.output).toContain("old text");
    expect(info.output).not.toContain("\u001b");
    expect(info.copied).toBe(true);
    const queued = drainUiCommands();
    expect(queued).toHaveLength(1);
    expect(queued[0].section).toBe("github-launch");
    expect(queued[0].payload).toEqual({ kind: "copy-text", text: info.output });
    expect(() => sessionInfoByNumber("github", 9)).toThrow(/list_active_github_sessions/);
  });
});

describe("mcp http", () => {
  it("lists the control tools and answers app_status", async () => {
    const listener = await listenMcp(0);
    const client = new Client({ name: "mcp-test", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${listener.port}/mcp`));
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      for (const name of [
        "app_status",
        "app_navigate",
        "session_start",
        "session_send",
        "session_read",
        "session_stop",
        "github_update_repo",
        "github_connect",
        "remote_connect",
        "files_write",
        "settings_update",
        "remote_saved_servers",
        "remote_start_saved",
        "remote_session_start",
        "remote_upload_images",
        "remote_upload",
        "remote_search",
        "remote_copy_path",
        "github_cloned_repos",
        "github_select_repo",
        "github_session_start",
        "local_get_path",
        "local_select_path",
        "local_session_start",
        "local_set_projects_dir",
        "local_upload",
        "local_upload_images",
        "list_active_github_sessions",
        "list_active_local_sessions",
        "list_active_remote_sessions",
        "get_session_x_info",
      ]) {
        expect(names).toContain(name);
      }
      const prompt = jarvisSystemPrompt(
        MCP_INSTRUCTIONS,
        listed.tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? "",
          parameters: tool.inputSchema as unknown as Record<string, unknown>,
        })),
      );
      expect(prompt).toContain("list_active_github_sessions");
      expect(prompt).toContain("get_session_x_info");
      expect(prompt).toContain("How to use: Call get_session_x_info with where");
      const status = await client.callTool({ name: "app_status", arguments: {} });
      expect(status.isError).not.toBe(true);
      const text = JSON.parse((status.content as { text: string }[])[0].text) as { name: string };
      expect(text.name).toBe("Jarvis Control Center");

      const nav = await client.callTool({ name: "app_navigate", arguments: { section: "repos" } });
      expect(nav.isError).not.toBe(true);
      const queued = drainUiCommands();
      expect(queued).toHaveLength(1);
      expect(queued[0].section).toBe("github");

      const refused = await client.callTool({
        name: "github_update_repo",
        arguments: { fullName: "someone/repo", confirm: false },
      });
      expect(refused.isError).toBe(true);
    } finally {
      await client.close();
      await listener.close();
    }
  }, 20_000);
});
