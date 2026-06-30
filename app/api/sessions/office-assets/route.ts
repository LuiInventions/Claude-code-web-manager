import * as path from "path";
import { NextResponse } from "next/server";

import {
  loadCharacterSprites,
  loadFloorTiles,
  loadFurnitureAssets,
  loadPetSprites,
  loadWallTiles,
  loadDefaultLayout,
} from "@/lib/pixel-agents/assetLoader";

/**
 * Decodes the vendored pixel-agents PNG assets into the sprite pixel-grid format
 * the office canvas consumes, and serves it as one JSON payload.
 *
 * Upstream, the VS Code extension host / standalone server runs these exact
 * loaders and pushes the result to the webview over postMessage / WebSocket
 * (characterSpritesLoaded, furnitureAssetsLoaded, …). We have no such backend,
 * so this route runs the same loaders (vendored unchanged in
 * lib/pixel-agents/assetLoader.ts) once per process and hands the office the
 * data via useSessionMessages → the office's own setter functions.
 *
 * The decode is pure (PNG → pixel grids) and the assets are immutable, so the
 * result is memoised for the lifetime of the server process.
 */

export const runtime = "nodejs";
export const dynamic = "force-static";

/** App root that holds `public/`. In the packaged Electron app the main
 *  process chdir()s to userData (so `.data`/`projects` are writable), which
 *  moves `process.cwd()` away from the install dir — so it sets CCC_APP_ROOT to
 *  the real app root. In dev / `npm start` the env is unset and cwd is already
 *  the app root, so the fallback is correct. */
const APP_ROOT = process.env.CCC_APP_ROOT || process.cwd();

/** Assets vendored at public/pixel-agents-assets/, with the original `assets/`
 *  tree preserved inside it so the loaders' hardcoded `/assets/` segment
 *  resolves unchanged. */
const ASSETS_ROOT = path.join(APP_ROOT, "public", "pixel-agents-assets");

export interface OfficeAssetsPayload {
  characters: string[][][][]; // CharacterDirectionSprites[] flattened over JSON
  pets: unknown[];
  petNames: string[];
  floors: string[][][];
  walls: string[][][][];
  furniture: { catalog: unknown[]; sprites: Record<string, string[][]> };
  layout: Record<string, unknown> | null;
}

let cached: Promise<OfficeAssetsPayload> | null = null;

async function buildPayload(): Promise<OfficeAssetsPayload> {
  const [chars, pets, floors, walls, furniture] = await Promise.all([
    loadCharacterSprites(ASSETS_ROOT),
    loadPetSprites(ASSETS_ROOT),
    loadFloorTiles(ASSETS_ROOT),
    loadWallTiles(ASSETS_ROOT),
    loadFurnitureAssets(ASSETS_ROOT),
  ]);

  // Furniture sprites arrive as a Map — JSON needs a plain object.
  const furnitureSprites: Record<string, string[][]> = {};
  if (furniture) {
    for (const [id, sprite] of furniture.sprites) furnitureSprites[id] = sprite;
  }

  return {
    characters: (chars?.characters ?? []) as unknown as string[][][][],
    pets: pets?.pets ?? [],
    petNames: pets?.manifests.map((m) => m.name) ?? [],
    floors: floors?.sprites ?? [],
    walls: walls?.sets ?? [],
    furniture: { catalog: furniture?.catalog ?? [], sprites: furnitureSprites },
    layout: loadDefaultLayout(ASSETS_ROOT),
  };
}

export async function GET() {
  if (!cached) cached = buildPayload();
  try {
    return NextResponse.json(await cached);
  } catch (err) {
    cached = null; // allow a retry on next request
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "asset decode failed" },
      { status: 500 },
    );
  }
}
