import { hashId } from "./sessions";

/** Where a live session belongs. Clicking its character opens that tab. */
export type SessionPlace = "local" | "github" | "server";

export function sessionPlace(s: { where?: string; origin?: string }): SessionPlace {
  if (s.where === "remote") return "server";
  if (s.origin === "github") return "github";
  return "local";
}

export function placeLabel(place: SessionPlace): string {
  if (place === "github") return "GitHub";
  if (place === "server") return "Server";
  return "Lokal";
}

/**
 * Cool and soft names. The pool is large so two live sessions rarely share one.
 * Assignment is stable for a session id and unique among the ids passed in.
 */
export const SESSION_NAMES = [
  "Mochi", "Luna", "Pip", "Nori", "Kiko", "Miso", "Nimbus", "Coco",
  "Milo", "Yuki", "Sora", "Hana", "Kumo", "Pebble", "Maple", "Olive",
  "Juniper", "Cedar", "Brook", "Wren", "Finch", "Lark", "Robin", "Dove",
  "Sunny", "Honey", "Clover", "Poppy", "Daisy", "Berry", "Peach", "Plum",
  "Mango", "Kiwi", "Lychee", "Matcha", "Boba", "Tofu", "Pudding", "Cookie",
  "Waffle", "Noodle", "Ramen", "Wasabi", "Ginger", "Pepper", "Basil", "Sage",
  "Moss", "Fern", "Willow", "Aspen", "Birch", "Hazel", "Rowan", "Ivy",
  "Lotus", "Iris", "Violet", "Coral", "Pearl", "Opal", "Amber", "Jade",
  "Onyx", "Quartz", "Flint", "Comet", "Nova", "Orbit", "Nebula", "Puffin",
  "Otter", "Fawn", "Koala", "Blink", "Nib", "Spark", "Ember", "Mist",
  "Dew", "Frost", "Breeze", "Dawn", "Sol", "Pixel", "Byte", "Glow",
  "Chirp", "Zippy", "Cinnamon", "Nutmeg", "Starling", "Sparrow",
] as const;

export function assignSessionNames(ids: string[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  const pool = SESSION_NAMES.length;
  for (const id of ids) {
    const base = hashId(id) % pool;
    let name = "";
    for (let step = 0; step < pool; step++) {
      const candidate = SESSION_NAMES[(base + step) % pool];
      if (!used.has(candidate)) {
        name = candidate;
        break;
      }
    }
    if (!name) name = `Pip ${used.size + 1}`;
    used.add(name);
    out.set(id, name);
  }
  return out;
}
