import { describe, expect, it } from "vitest";
import { windowsOpensshCandidates } from "../server/ssh-bin";

describe("OpenSSH lookup", () => {
  it("points Windows at ssh.exe instead of a bare ssh name", () => {
    const found = windowsOpensshCandidates({ SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" });
    expect(found.map((pair) => pair.ssh)).toEqual([
      "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
      "C:\\Windows\\Sysnative\\OpenSSH\\ssh.exe",
    ]);
    expect(found.every((pair) => pair.keygen.endsWith("ssh-keygen.exe"))).toBe(true);
  });
});
