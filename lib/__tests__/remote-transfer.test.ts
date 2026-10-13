import path from "node:path";
import { describe, expect, it } from "vitest";
import { brokerSource } from "../server/remote-broker";
import {
  contentDisposition,
  decodePathHeader,
  encodePathHeader,
  joinRemote,
  localDestWith,
  MAX_TRANSFER_BYTES,
  planTransfer,
  remoteRelative,
  transferSummary,
} from "../remote-transfer";

describe("remote transfer paths", () => {
  it("keeps names inside the chosen folder", () => {
    expect(remoteRelative("ordner/bild.png")).toBe("ordner/bild.png");
    expect(remoteRelative("a\\b\\c.zip")).toBe("a/b/c.zip");
    expect(remoteRelative("/tmp/a")).toBe("tmp/a");
    expect(remoteRelative("a/./b")).toBe("a/b");
    expect(remoteRelative("..")).toBeNull();
    expect(remoteRelative("a/../../etc/passwd")).toBeNull();
    expect(remoteRelative("a/\0/b")).toBeNull();
    expect(joinRemote("/home/ada", "ordner/bild.png")).toBe("/home/ada/ordner/bild.png");
    expect(joinRemote("~", "a.txt")).toBe("~/a.txt");
    expect(joinRemote("/", "a")).toBe("/a");
  });

  it("does not let a Windows destination leave the picked folder", () => {
    const win = path.win32;
    expect(localDestWith(win, "C:\\picked", "ordner/bild.png")).toBe("C:\\picked\\ordner\\bild.png");
    expect(localDestWith(win, "C:\\picked", "a:b.zip")).toBe("C:\\picked\\a_b.zip");
    expect(localDestWith(win, "C:\\picked", "con")).toBe("C:\\picked\\con_");
    expect(localDestWith(win, "C:\\picked", "../Windows/notepad.exe")).toBeNull();
    expect(localDestWith(path.posix, "/picked", "../etc/passwd")).toBeNull();
  });

  it("rejects more than 10 GB and keeps the last duplicate", () => {
    expect(planTransfer([{ rel: "a.txt", size: 0 }]).ok).toBe(true);
    const over = planTransfer([{ rel: "big.bin", size: MAX_TRANSFER_BYTES + 1 }]);
    expect(over).toEqual({ ok: false, error: "Maximal 10 GB." });
    const edge = planTransfer([{ rel: "big.bin", size: MAX_TRANSFER_BYTES }]);
    expect(edge.ok).toBe(true);
    const dup = planTransfer([
      { rel: "a.txt", size: 5 },
      { rel: "a.txt", size: 2 },
      { rel: "leer", size: 0, dir: true },
    ]);
    expect(dup.ok).toBe(true);
    if (dup.ok) {
      expect(dup.plan.total).toBe(2);
      expect(dup.plan.files).toEqual([{ rel: "a.txt", size: 2 }]);
      expect(dup.plan.dirs).toEqual(["leer"]);
    }
    expect(planTransfer([{ rel: "..", size: 1 }])).toEqual({ ok: false, error: "Dateiname ungültig." });
    expect(transferSummary(1, 0)).toBe("1 Datei · 0 B");
    expect(transferSummary(2, 2048)).toBe("2 Dateien · 2.0 KB");
    expect(transferSummary(0, 0, 1)).toBe("1 Ordner");
  });

  it("round-trips unicode paths in headers", () => {
    const value = "größe/写真.zip";
    expect(decodePathHeader(encodePathHeader(value))).toBe(value);
    expect(contentDisposition("größe.zip")).toContain("filename*=UTF-8''");
    expect(contentDisposition('a"b')).toContain('filename="a_b"');
  });

  it("ships the streaming commands in the broker", () => {
    const src = brokerSource();
    expect(src).toContain("MAX_TRANSFER = 10 * 1024 * 1024 * 1024");
    expect(src).toContain('op == "PUT"');
    expect(src).toContain('op == "GET"');
    expect(src).toContain('op == "WALK"');
    expect(src).toContain('op == "MKDIR"');
  });
});
