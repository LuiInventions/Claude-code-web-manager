import { describe, expect, it } from "vitest";
import { humanizeForSpeech } from "../voice";

describe("humanizeForSpeech", () => {
  it("turns an all-caps token into a pronounceable word instead of letters", () => {
    // The TTS would otherwise spell R-E-A-D-M-E.
    expect(humanizeForSpeech("Schau ins README")).toBe("Schau ins Readme");
  });

  it("handles several all-caps tokens, including short ones", () => {
    expect(humanizeForSpeech("Der PR braucht noch TODO und API")).toBe(
      "Der Pr braucht noch Todo und Api",
    );
  });

  it("normalizes each run of a hyphenated all-caps phrase", () => {
    expect(humanizeForSpeech("RED-GREEN-REFACTOR")).toBe("Red-Green-Refactor");
  });

  it("leaves single capital letters alone", () => {
    expect(humanizeForSpeech("Plan A und Variante B")).toBe("Plan A und Variante B");
  });

  it("does not mangle camelCase identifiers", () => {
    expect(humanizeForSpeech("ruf getURL auf")).toBe("ruf getURL auf");
  });

  it("keeps normal German text with umlauts untouched", () => {
    expect(humanizeForSpeech("Die Bots haben drei Aufgaben erledigt.")).toBe(
      "Die Bots haben drei Aufgaben erledigt.",
    );
  });

  it("handles empty input", () => {
    expect(humanizeForSpeech("")).toBe("");
  });
});
