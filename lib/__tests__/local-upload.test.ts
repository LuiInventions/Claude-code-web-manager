import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expandDroppedPaths } from "../local-tree";
import { droppedItemsOrError, imageMime, isImageSetFolder } from "../remote-upload-flow";
import { removeLocalImageSet, writeLocalBody, writeLocalTree } from "../server/local-upload";
import { brokerSource } from "../server/remote-broker";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccc-upload-"));
  temps.push(dir);
  return dir;
}

describe("dropped folder", () => {
  it("refuses a 0-byte folder the browser could not open", () => {
    const unread = droppedItemsOrError([], [{ name: "fotos", size: 0 }]);
    expect(unread.ok).toBe(false);
    if (!unread.ok) expect(unread.error).toBe("Ordner konnte nicht gelesen werden.");
    const file = droppedItemsOrError([], [{ name: "a.txt", size: 4 }]);
    expect(file.ok).toBe(true);
    const nested = droppedItemsOrError([], [{ name: "a.txt", size: 0, webkitRelativePath: "fotos/a.txt" }]);
    expect(nested.ok).toBe(true);
  });

  it("keeps the folder name and nested files", async () => {
    const root = await tempDir();
    const folder = path.join(root, "fotos");
    await fs.mkdir(path.join(folder, "leer"), { recursive: true });
    await fs.writeFile(path.join(folder, "a.png"), "bild");
    const items = await expandDroppedPaths([folder]);
    expect(items.map((item) => item.rel).sort()).toEqual(["fotos", "fotos/a.png", "fotos/leer"]);
    const file = items.find((item) => item.rel === "fotos/a.png");
    expect(file?.size).toBe(4);
    expect(file?.dir).toBeUndefined();
    expect(items.find((item) => item.rel === "fotos/leer")?.dir).toBe(true);
  });
});

describe("local image set", () => {
  it("copies a tree into the chosen folder and deletes only an image set", async () => {
    const src = await tempDir();
    const dest = await tempDir();
    const file = path.join(src, "a.png");
    await fs.writeFile(file, "bild");
    const written = await writeLocalTree({
      dir: dest,
      items: [
        { rel: "image_setabcdefgh", size: 0, dir: true, source: src },
        { rel: "image_setabcdefgh/a.png", size: 4, source: file },
      ],
    });
    expect(written.files).toBe(1);
    expect(await fs.readFile(path.join(dest, "image_setabcdefgh", "a.png"), "utf8")).toBe("bild");

    await expect(removeLocalImageSet(dest, "not-a-set")).rejects.toThrow("Nur Bildordner.");
    await expect(removeLocalImageSet(dest, "../image_setabcdefgh")).rejects.toThrow("Nur Bildordner.");
    await removeLocalImageSet(dest, "image_setabcdefgh");
    await expect(fs.stat(path.join(dest, "image_setabcdefgh"))).rejects.toThrow();
  });

  it("writes one uploaded body under the folder", async () => {
    const dest = await tempDir();
    await writeLocalBody({
      dir: dest,
      rel: "notes/a.txt",
      kind: "file",
      body: [Buffer.from("hallo")],
      length: 5,
    });
    expect(await fs.readFile(path.join(dest, "notes", "a.txt"), "utf8")).toBe("hallo");
    expect(isImageSetFolder("image_setabcdefgh")).toBe(true);
    expect(isImageSetFolder("image_set-old")).toBe(false);
    expect(imageMime("shot.PNG")).toBe("image/png");
    expect(imageMime("notes.txt")).toBeNull();
    expect(brokerSource()).toContain('op == "RMSET"');
  });
});
