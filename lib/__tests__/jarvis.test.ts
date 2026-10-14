import { describe, expect, it } from "vitest";
import { jarvisSystemPrompt } from "../server/jarvis/prompt";
import { runToolLoop } from "../server/jarvis/turn";

describe("jarvis prompt", () => {
  it("lists each tool and how to call it", () => {
    const prompt = jarvisSystemPrompt("Playbook.", [
      {
        name: "get_session_x_info",
        description: "Read one running session by its number.",
        parameters: {
          type: "object",
          properties: {
            where: { type: "string", enum: ["github", "local", "remote"], description: "Which area." },
            x: { type: "number", description: "Session number." },
          },
          required: ["where", "x"],
        },
      },
      {
        name: "list_active_github_sessions",
        description: "List running GitHub sessions.",
        parameters: { type: "object", properties: {} },
      },
    ]);
    expect(prompt).toContain("Playbook.");
    expect(prompt).toContain("get_session_x_info: Read one running session by its number.");
    expect(prompt).toContain("How to use: Call get_session_x_info with where (github|local|remote, required)");
    expect(prompt).toContain("x (number, required)");
    expect(prompt).toContain("How to use: Call list_active_github_sessions with no arguments.");
    expect(prompt).toContain("Reply in German.");
  });
});

describe("jarvis tool loop", () => {
  it("sends the tool result back and then returns the answer", async () => {
    const seen: string[] = [];
    const result = await runToolLoop({
      messages: [{ role: "user", text: "Lies Session 1." }],
      callModel: async (items) => {
        seen.push(items.map((item) => item.kind).join(","));
        if (seen.length === 1) {
          return {
            text: "",
            calls: [{ id: "c1", name: "get_session_x_info", arguments: "{\"where\":\"github\",\"x\":1}" }],
          };
        }
        return { text: "Session 1 zeigt den Build.", calls: [] };
      },
      callTool: async (name, args) => {
        expect(name).toBe("get_session_x_info");
        expect(args).toEqual({ where: "github", x: 1 });
        return { text: "build ok", ok: true };
      },
    });
    expect(seen[1]).toBe("user,tool");
    expect(result.text).toBe("Session 1 zeigt den Build.");
    expect(result.tools).toEqual([{ name: "get_session_x_info", ok: true }]);
  });

  it("stops after the step limit", async () => {
    const result = await runToolLoop({
      messages: [{ role: "user", text: "weiter" }],
      maxSteps: 2,
      callModel: async () => ({
        text: "",
        calls: [{ id: "c", name: "app_status", arguments: "{}" }],
      }),
      callTool: async () => ({ text: "ok", ok: true }),
    });
    expect(result.tools).toHaveLength(2);
    expect(result.text).toMatch(/Werkzeug-Limit/);
  });
});
