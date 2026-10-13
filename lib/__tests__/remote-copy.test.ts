import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { brokerSource } from "../server/remote-broker";
import { remotePut, remoteRead, saveRemoteTree } from "../server/remote-copy";
import { handleRemoteTransfer } from "../server/remote-transfer-http";
import { tarArchiveSize, tarEnd, tarMemberPrefix, tarPadding } from "../server/remote-tar";
import { encodePathHeader, MAX_TRANSFER_BYTES } from "../remote-transfer";

function pythonBin(): string | null {
  for (const bin of ["python", "python3", "py"]) {
    const probe = spawnSync(bin, ["-c", "print(1)"], { encoding: "utf8" });
    if (probe.status === 0 && probe.stdout.trim() === "1") return bin;
  }
  return null;
}

function startBroker(): Promise<{ port: number; stop: () => void }> {
  const bin = pythonBin();
  if (!bin) throw new Error("python missing");
  const script = path.join(os.tmpdir(), `ccc-broker-${process.pid}.py`);
  const stub = [
    "import sys, types",
    "for name in ('fcntl', 'pty', 'termios'):",
    "    sys.modules[name] = types.ModuleType(name)",
    "sys.modules['termios'].TIOCSWINSZ = 0",
    "import os",
    "os.environ['CCC_PORT'] = '0'",
    "exec(open(sys.argv[1], encoding='utf-8').read())",
  ].join("\n");
  const stubPath = path.join(os.tmpdir(), `ccc-broker-stub-${process.pid}.py`);
  fs.writeFileSync(script, brokerSource());
  fs.writeFileSync(stubPath, stub);
  const proc = spawn(bin, [stubPath, script], { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  proc.stderr?.on("data", (chunk) => {
    err += chunk.toString("utf8");
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(err || "no broker port"));
    }, 8000);
    let buf = "";
    proc.stdout?.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const match = buf.match(/CCC_BROKER (\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve({
        port: Number(match[1]),
        stop: () => {
          proc.kill();
          fs.rmSync(script, { force: true });
          fs.rmSync(stubPath, { force: true });
        },
      });
    });
    proc.on("exit", () => {
      clearTimeout(timer);
      reject(new Error(err || "broker exited"));
    });
  });
}

function onceBody(res: http.IncomingMessage): Promise<{ status: number; raw: Buffer }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    res.on("end", () => resolve({ status: res.statusCode || 0, raw: Buffer.concat(chunks) }));
    res.on("error", reject);
  });
}

async function upload(port: number, root: string, rel: string, body: Buffer, kind = "file"): Promise<{ status: number; raw: Buffer }> {
  const headers: Record<string, string | number> = {
    "x-ccc-dir": encodePathHeader(root),
    "x-ccc-rel": encodePathHeader(rel),
    "x-ccc-kind": kind,
    "content-length": kind === "dir" ? 0 : body.length,
  };
  const req = http.request({ hostname: "127.0.0.1", port, path: "/api/remote/upload", method: "POST", headers });
  const done = onceBody(await new Promise<http.IncomingMessage>((resolve, reject) => {
    req.on("response", resolve);
    req.on("error", reject);
    if (kind === "dir") req.end();
    else req.end(body);
  }));
  return done;
}

describe("remote copy", () => {
  it("builds a tar whose length matches the byte count", () => {
    const members = [
      { name: "leer", size: 0, dir: true },
      { name: "größe.txt", size: 4 },
      { name: "a.zip", size: 1 },
    ];
    const chunks = [
      tarMemberPrefix("leer", 0, true),
      tarMemberPrefix("größe.txt", 4),
      Buffer.from("bild"),
      tarPadding(4),
      tarMemberPrefix("a.zip", 1),
      Buffer.from("Z"),
      tarPadding(1),
      tarEnd(),
    ];
    const archive = Buffer.concat(chunks);
    expect(archive.length).toBe(tarArchiveSize(members));
    const bin = pythonBin();
    if (!bin) return;
    const file = path.join(os.tmpdir(), `ccc-tar-${process.pid}.tar`);
    fs.writeFileSync(file, archive);
    const listed = spawnSync(bin, ["-c", "import tarfile,sys; t=tarfile.open(sys.argv[1]); print('\\n'.join(m.name+' '+str(m.size) for m in t.getmembers()))", file], { encoding: "utf8" });
    fs.rmSync(file, { force: true });
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain("größe.txt 4");
    expect(listed.stdout).toContain("a.zip 1");
  });

  it.skipIf(!pythonBin())("streams files and folders through the broker, including binary and unicode names", async () => {
    const broker = await startBroker();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-remote-root-"));
    const local = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-remote-dest-"));
    const server = http.createServer((req, res) => {
      void handleRemoteTransfer(req, res, () => broker.port);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const httpPort = typeof address === "object" && address ? address.port : 0;
    const payload = Buffer.from([0, 255, 10, 13, 65]);
    try {
      const put = await upload(httpPort, root, "ordner/größe.bin", payload);
      expect(put.status).toBe(200);
      expect(JSON.parse(put.raw.toString("utf8")).ok).toBe(true);
      const empty = await upload(httpPort, root, "ordner/leer.txt", Buffer.alloc(0));
      expect(empty.status).toBe(200);
      const zip = await upload(httpPort, root, "pack.zip", Buffer.from("PK"));
      expect(zip.status).toBe(200);
      const made = await upload(httpPort, root, "leer", Buffer.alloc(0), "dir");
      expect(made.status).toBe(200);
      const escaped = await upload(httpPort, root, "../ausserhalb.txt", Buffer.from("no"));
      expect(escaped.status).toBe(400);
      expect(fs.existsSync(path.join(path.dirname(root), "ausserhalb.txt"))).toBe(false);

      const huge = http.request({
        hostname: "127.0.0.1",
        port: httpPort,
        path: "/api/remote/upload",
        method: "POST",
        headers: {
          "content-length": String(MAX_TRANSFER_BYTES + 1),
          "x-ccc-dir": encodePathHeader(root),
          "x-ccc-rel": encodePathHeader("big.bin"),
          "x-ccc-kind": "file",
        },
      });
      const hugeRes = onceBody(await new Promise<http.IncomingMessage>((resolve, reject) => {
        huge.on("response", resolve);
        huge.on("error", reject);
        huge.end();
      }));
      expect((await hugeRes).status).toBe(413);

      const saved = await saveRemoteTree({
        port: broker.port,
        remotePath: root,
        localDir: local,
        directory: true,
      });
      expect(saved.files).toBe(3);
      expect(saved.bytes).toBe(payload.length + 2);
      const folder = path.join(local, path.basename(root));
      expect(fs.readFileSync(path.join(folder, "ordner", "größe.bin"))).toEqual(payload);
      expect(fs.readFileSync(path.join(folder, "ordner", "leer.txt"))).toEqual(Buffer.alloc(0));
      expect(fs.readFileSync(path.join(folder, "pack.zip"))).toEqual(Buffer.from("PK"));
      expect(fs.statSync(path.join(folder, "leer")).isDirectory()).toBe(true);

      const one = path.join(root, "pack.zip");
      const got: Buffer[] = [];
      const size = await remoteRead(broker.port, one, async (chunk) => {
        got.push(Buffer.from(chunk));
      });
      expect(size).toBe(2);
      expect(Buffer.concat(got)).toEqual(Buffer.from("PK"));

      const direct = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-one-"));
      const fileSaved = await saveRemoteTree({
        port: broker.port,
        remotePath: one,
        localDir: direct,
        directory: false,
      });
      expect(fileSaved.files).toBe(1);
      expect(fs.readFileSync(path.join(direct, "pack.zip"))).toEqual(Buffer.from("PK"));
      fs.rmSync(direct, { recursive: true, force: true });

      await remotePut(broker.port, root, "direkt.txt", (async function* () {
        yield Buffer.from("hallo");
      })(), 5);
      expect(fs.readFileSync(path.join(root, "direkt.txt"), "utf8")).toBe("hallo");
    } finally {
      server.close();
      await once(server, "close");
      broker.stop();
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(local, { recursive: true, force: true });
    }
  });
});
