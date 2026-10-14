import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listImageSetCache,
  removeImageSetCache,
  saveImageSetBytes,
  saveImageSetFile,
} from "../server/image-set-cache";

const temps: string[] = [];
const setName = "image_setabcdefgh";

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccc-set-"));
  temps.push(dir);
  return dir;
}

describe("image set cache", () => {
  it("stores an upload and lists only real image files", async () => {
    const root = await tempDir();
    await saveImageSetBytes({
      name: setName,
      fileName: "foto.png",
      body: [Buffer.from("bild")],
      length: 4,
      root,
    });
    await fs.writeFile(path.join(root, setName, "notiz.txt"), "x");
    const images = await listImageSetCache(setName, root);
    expect(images.map((image) => image.name)).toEqual(["foto.png"]);
    expect(await fs.readFile(images[0].path, "utf8")).toBe("bild");
  });

  it("copies a local source and refuses a symlink or a bad name", async () => {
    const root = await tempDir();
    const source = path.join(root, "quelle.png");
    await fs.writeFile(source, "png");
    const dest = await saveImageSetFile(setName, "quelle.png", source, root);
    expect(path.basename(dest)).toBe("quelle.png");
    expect(await fs.readFile(dest, "utf8")).toBe("png");

    const link = path.join(root, "link.png");
    let linked = false;
    try {
      await fs.symlink(source, link);
      linked = true;
    } catch {
      linked = false;
    }
    if (linked) {
      await expect(saveImageSetFile(setName, "link.png", link, root)).rejects.toThrow("Datei fehlt.");
    }
    await expect(saveImageSetFile("nicht-erlaubt", "a.png", source, root)).rejects.toThrow("Nur Bildordner.");
    await expect(saveImageSetBytes({
      name: setName,
      fileName: "../a.png",
      body: [Buffer.from("x")],
      length: 1,
      root,
    })).rejects.toThrow("Dateiname ungültig.");
  });

  it("removes the local copy", async () => {
    const root = await tempDir();
    await saveImageSetBytes({
      name: setName,
      fileName: "a.png",
      body: [Buffer.from("a")],
      length: 1,
      root,
    });
    await removeImageSetCache(setName, root);
    expect(await listImageSetCache(setName, root)).toEqual([]);
  });
});
