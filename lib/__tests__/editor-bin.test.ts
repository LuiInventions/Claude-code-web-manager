import { describe, expect, it } from "vitest";
import {
  decodeCliOutput,
  editorSpawnSpec,
  installedEditorCandidates,
  preferEditorHit,
} from "../editor-bin";

describe("editor binary", () => {
  it("runs a Windows .cmd shim through cmd.exe so help text is captured", () => {
    expect(
      editorSpawnSpec(
        "C:\\Program Files\\VSCodium\\bin\\codium.cmd",
        ["serve-web", "--help"],
        "win32",
        "C:\\Windows\\System32\\cmd.exe",
      ),
    ).toEqual({
      file: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        '""C:\\Program Files\\VSCodium\\bin\\codium.cmd" serve-web --help"',
      ],
      windowsVerbatimArguments: true,
    });
  });

  it("spawns a unix binary directly", () => {
    expect(editorSpawnSpec("/usr/bin/codium", ["serve-web", "--help"], "linux")).toEqual({
      file: "/usr/bin/codium",
      args: ["serve-web", "--help"],
    });
  });

  it("prefers the cmd shim over a bare name from where", () => {
    expect(
      preferEditorHit([
        "C:\\Program Files\\Microsoft VS Code\\bin\\code",
        "C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd",
      ]),
    ).toMatch(/code\.cmd$/);
  });

  it("lists VS Codium before VS Code in the usual install folders", () => {
    const found = installedEditorCandidates(
      { LOCALAPPDATA: "C:\\Users\\luis\\AppData\\Local", ProgramFiles: "C:\\Program Files" },
      "win32",
    );
    expect(found[0]).toBe("C:\\Users\\luis\\AppData\\Local\\Programs\\VSCodium\\bin\\codium.cmd");
    expect(found.some((p) => p.endsWith("code.cmd"))).toBe(true);
    expect(installedEditorCandidates({}, "linux")).toEqual([]);
  });

  it("reads UTF-16 help that would hide the word serve-web", () => {
    const raw = Buffer.from("serve-web --host\n", "utf16le");
    expect(raw.toString("utf8").includes("serve-web")).toBe(false);
    expect(decodeCliOutput(raw).includes("serve-web")).toBe(true);
    expect(decodeCliOutput(Buffer.from("serve-web\n", "utf8"))).toBe("serve-web\n");
  });
});
