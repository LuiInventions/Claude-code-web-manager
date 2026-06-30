import * as path from "path";
import { describe, expect, it } from "vitest";

import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
} from "../pixel-agents/assetLoader";

/**
 * Regression guard for the v1.5.0 "brown screen" bug in the Sessions tab.
 *
 * Two failures combined to leave the office empty (just its brown background):
 *   1. `public/**` was not packaged, so the vendored sprites/layout were absent
 *      from the installed app, and
 *   2. the office-assets route resolved them via process.cwd(), which the
 *      packaged Electron main chdir()s to userData — the wrong directory.
 *
 * The route now resolves the app root from CCC_APP_ROOT (falling back to cwd).
 * This test mirrors that resolution against the real, shipped asset tree and
 * asserts the loaders return data — if the assets vanish or the loaders break,
 * the office goes brown again and this fails.
 */
const APP_ROOT = process.env.CCC_APP_ROOT || process.cwd();
const ASSETS_ROOT = path.join(APP_ROOT, "public", "pixel-agents-assets");

describe("office assets load from the app root", () => {
  it("loads the character spritesheets", async () => {
    const chars = await loadCharacterSprites(ASSETS_ROOT);
    expect(chars).not.toBeNull();
    expect(chars!.characters.length).toBeGreaterThan(0);
  });

  it("loads floor and wall tiles", async () => {
    const floors = await loadFloorTiles(ASSETS_ROOT);
    const walls = await loadWallTiles(ASSETS_ROOT);
    expect(floors?.sprites.length ?? 0).toBeGreaterThan(0);
    expect(walls?.sets.length ?? 0).toBeGreaterThan(0);
  });

  it("loads furniture and the default layout the office rebuilds from", async () => {
    const furniture = await loadFurnitureAssets(ASSETS_ROOT);
    expect(furniture).not.toBeNull();
    expect(furniture!.catalog.length).toBeGreaterThan(0);

    const layout = loadDefaultLayout(ASSETS_ROOT) as { version?: number } | null;
    expect(layout).not.toBeNull();
    // useSessionMessages only applies the layout when version === 1.
    expect(layout!.version).toBe(1);
  });
});
