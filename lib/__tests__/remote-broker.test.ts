import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  brokerLaunchCommand,
  brokerSource,
  openRemoteCli,
  remoteList,
  remoteReadFile,
  remoteWriteFile,
} from "../server/remote-broker";

describe("remote session broker", () => {
  it("does not echo the result markers in the launch command", () => {
    const cmd = brokerLaunchCommand(33841);
    expect(cmd.includes("CCC_BROKER_MISSING")).toBe(false);
    expect(cmd.includes("CCC_BROKER_BIND")).toBe(false);
    expect(/CCC_BROKER \d/.test(cmd)).toBe(false);
    expect(cmd.includes("CCC_BROKER_%s")).toBe(true);
    expect(cmd.includes("CCC_PORT=33841")).toBe(true);
  });

  // The broker uses Unix pty/fcntl. It runs on the server, not on the Windows app.
  it.skipIf(process.platform === "win32")("spawns a command over the local broker", async () => {
    const proc = spawn("python3", ["-c", brokerSource()], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    proc.stderr?.on("data", (chunk) => {
      err += chunk.toString("utf8");
    });
    const portLine = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(err || "no broker port")), 4000);
      let buf = "";
      proc.stdout?.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const match = buf.match(/CCC_BROKER (\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      proc.on("exit", () => {
        clearTimeout(timer);
        reject(new Error(err || "broker exited"));
      });
    });
    const sock = net.connect(Number(portLine), "127.0.0.1");
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
    });
    try {
      const b64 = Buffer.from("printf 'hello-broker\\n'", "utf8").toString("base64");
      await new Promise<void>((resolve, reject) => {
        sock.once("connect", () => resolve());
        sock.once("error", reject);
      });
      sock.write(`SPAWN t1 80 24 ${b64}\n`);
      const body = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(buf || "no output")), 4000);
        const look = () => {
          if (!buf.includes("hello-broker")) return;
          clearTimeout(timer);
          resolve(buf);
        };
        sock.on("data", look);
        look();
      });
      expect(body.startsWith("OK\n")).toBe(true);
      expect(body).toContain("hello-broker");
    } finally {
      sock.destroy();
      proc.kill();
    }
  });

  it.skipIf(process.platform === "win32")("keeps UTF-8 from the remote CLI", async () => {
    const proc = spawn("python3", ["-c", brokerSource()], { stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no broker port")), 4000);
      let buf = "";
      proc.stdout?.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const match = buf.match(/CCC_BROKER (\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      proc.on("exit", () => {
        clearTimeout(timer);
        reject(new Error("broker exited"));
      });
    });
    const handle = openRemoteCli({ port, command: "printf 'größe\\n'", cols: 80, rows: 24 });
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no utf-8 output")), 4000);
        let buf = "";
        handle.onData((chunk) => {
          buf += chunk;
          if (buf.includes("größe")) {
            clearTimeout(timer);
            resolve(buf);
          }
        });
      });
      expect(text).toContain("größe");
      const listing = await remoteList(port, "/tmp");
      expect(listing.path).toBe("/tmp");
      expect(Array.isArray(listing.entries)).toBe(true);
    } finally {
      handle.kill();
      proc.kill();
    }
  });

  it.skipIf(process.platform === "win32")("reads and writes a remote file", async () => {
    const proc = spawn("python3", ["-c", brokerSource()], { stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no broker port")), 4000);
      let buf = "";
      proc.stdout?.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const match = buf.match(/CCC_BROKER (\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-remote-file-"));
    const file = path.join(dir, "note.ts");
    fs.writeFileSync(file, "export const n = 1\n");
    try {
      const view = await remoteReadFile(port, file);
      expect(view.kind).toBe("text");
      expect(view.content).toBe("export const n = 1\n");
      await remoteWriteFile(port, file, "export const n = 2\n");
      expect(fs.readFileSync(file, "utf8")).toBe("export const n = 2\n");
    } finally {
      proc.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
