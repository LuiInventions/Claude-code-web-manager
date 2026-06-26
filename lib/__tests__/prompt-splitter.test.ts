import { describe, it, expect } from "vitest";
import { parseSplitResponse } from "../prompt-splitter";

describe("parseSplitResponse", () => {
  it("parses a plain JSON object with sessions", () => {
    const r = parseSplitResponse(
      '{"sessions":[{"title":"A","prompt":"do a"},{"prompt":"do b"}]}',
    );
    expect(r).toEqual([
      { title: "A", prompt: "do a" },
      { title: undefined, prompt: "do b" },
    ]);
  });

  it("unwraps a ```json code fence", () => {
    const r = parseSplitResponse('```json\n{"sessions":[{"prompt":"x"}]}\n```');
    expect(r).toEqual([{ title: undefined, prompt: "x" }]);
  });

  it("accepts a bare array too", () => {
    const r = parseSplitResponse('[{"prompt":"only"}]');
    expect(r).toHaveLength(1);
    expect(r[0].prompt).toBe("only");
  });

  it("drops empty prompts and clamps to 6", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ prompt: `p${i}` }));
    many.splice(1, 0, { prompt: "   " }); // an empty one
    const r = parseSplitResponse(JSON.stringify({ sessions: many }));
    expect(r).toHaveLength(6);
    expect(r.every((s) => s.prompt.trim().length > 0)).toBe(true);
  });

  it("returns [] for non-JSON or wrong shape", () => {
    expect(parseSplitResponse("not json")).toEqual([]);
    expect(parseSplitResponse('{"foo":1}')).toEqual([]);
  });
});
