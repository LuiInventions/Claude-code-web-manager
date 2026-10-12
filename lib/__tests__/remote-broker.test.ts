import { spawn } from "node:child_process";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { brokerLaunchCommand, brokerSource } from "../server/remote-broker";

describe("remote session broker", () => {
  it("does not echo the result markers in the launch command", () => {
    const cmd = brokerLaunchCommand();
    expect(cmd.includes("CCC_BROKER_MISSING")).toBe(false);
    expect(/CCC_BROKER \d/.test(cmd)).toBe(false);
    expect(cmd.includes("CCC_BROKER_%s")).toBe(true);
  });

  it("spawns a command over the local broker", async () => {
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
});
