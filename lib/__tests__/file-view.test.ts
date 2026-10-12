import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readViewFile, viewFromBuffer, writeViewFile } from "../file-view";

describe("file view", () => {
  it("treats source as editable text and a png as an image", () => {
    const text = viewFromBuffer("/tmp/app.ts", "app.ts", Buffer.from("export const n = 1\n"));
    expect(text.kind).toBe("text");
    expect(text.content).toContain("export const n");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    const image = viewFromBuffer("/tmp/pic.png", "pic.png", png);
    expect(image.kind).toBe("image");
    expect(image.dataUrl?.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("round-trips a text edit on disk", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-file-"));
    const file = path.join(dir, "note.py");
    fs.writeFileSync(file, "print(1)\n");
    try {
      const view = await readViewFile(file);
      expect(view.kind).toBe("text");
      expect(view.content).toBe("print(1)\n");
      await writeViewFile(file, "print(2)\n");
      expect(fs.readFileSync(file, "utf8")).toBe("print(2)\n");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
