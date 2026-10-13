import { describe, expect, it } from "vitest";
import {
  confirmUploadQuestion,
  imageSetFolderName,
  imageSetPrompt,
  isImageFile,
  relativeUploadPath,
  takeImages,
  uniqueImageName,
  MAX_IMAGE_BYTES,
} from "../remote-upload-flow";
import { planTransfer } from "../remote-transfer";

describe("upload confirmation", () => {
  it("names one file or one folder and counts several items", () => {
    expect(confirmUploadQuestion([{ rel: "bericht.pdf", size: 12 }], "~/proj")).toBe(
      "Möchten Sie bericht.pdf (12 B) nach ~/proj hochladen?",
    );
    expect(
      confirmUploadQuestion(
        [
          { rel: "fotos/a.png", size: 10 },
          { rel: "fotos/b.png", size: 20 },
        ],
        "/var/app",
      ),
    ).toBe("Möchten Sie fotos (30 B) nach /var/app hochladen?");
    expect(
      confirmUploadQuestion(
        [
          { rel: "a.txt", size: 5 },
          { rel: "b.txt", size: 10 },
        ],
        "~",
      ),
    ).toBe("Möchten Sie 2 Dateien (15 B) nach ~ hochladen?");
    expect(confirmUploadQuestion([{ rel: "leer", size: 0, dir: true }], "~")).toBe(
      "Möchten Sie leer (0 B) nach ~ hochladen?",
    );
  });

  it("reads Uppy relative paths and folder-picker paths", () => {
    expect(relativeUploadPath({ name: "a.png", size: 1, relativePath: "/docs/a.png" })).toBe("docs/a.png");
    expect(relativeUploadPath({ name: "a.png", size: 1, webkitRelativePath: "ordner\\a.png" })).toBe("ordner/a.png");
    expect(relativeUploadPath({ name: "a.png", size: 1, relativePath: null })).toBe("a.png");
  });

  it("creates parent directories before nested files", () => {
    const planned = planTransfer([
      { rel: "fotos/urlaub/a.png", size: 4 },
      { rel: "fotos/leer", size: 0, dir: true },
    ]);
    expect(planned.ok).toBe(true);
    if (planned.ok) expect(planned.plan.dirs).toEqual(["fotos", "fotos/leer", "fotos/urlaub"]);
  });
});

describe("image set", () => {
  it("builds a letter-only folder and the same prompt sentence", () => {
    expect(imageSetFolderName(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]))).toBe("image_setabcdefgh");
    const random = imageSetFolderName();
    expect(random).toMatch(/^image_set[a-zA-Z]{8}$/);
    expect(imageSetPrompt("~/work/image_setabcdefgh")).toBe("in ~/work/image_setabcdefgh sind die bilder:");
  });

  it("accepts images up to 10 and 2 GB", () => {
    expect(isImageFile({ name: "a.PDF", type: "" })).toBe(false);
    expect(isImageFile({ name: "code.ts", type: "text/plain" })).toBe(false);
    expect(isImageFile({ name: "shot.png", type: "" })).toBe(true);
    expect(isImageFile({ name: "clip", type: "image/png" })).toBe(true);

    const many = Array.from({ length: 12 }, (_, i) => ({ name: `${i}.png`, type: "image/png", size: 10 }));
    const capped = takeImages([], many);
    expect(capped.take).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(capped.error).toBe("Maximal 10 Bilder.");

    const huge = takeImages([], [{ name: "big.png", type: "image/png", size: MAX_IMAGE_BYTES + 1 }]);
    expect(huge.take).toEqual([]);
    expect(huge.error).toBe("Maximal 2 GB.");

    const mixed = takeImages([{ size: 5 }], [
      { name: "note.txt", type: "text/plain", size: 1 },
      { name: "ok.jpg", type: "image/jpeg", size: 4 },
    ]);
    expect(mixed.take).toEqual([1]);
    expect(mixed.error).toBe("Nur Bilder.");
  });

  it("keeps image names unique inside the set", () => {
    const used = new Set<string>();
    expect(uniqueImageName("bild.png", used)).toBe("bild.png");
    expect(uniqueImageName("ordner/bild.png", used)).toBe("bild-2.png");
    expect(uniqueImageName("a<b>.txt", used)).toBe("a_b_.txt");
  });
});
