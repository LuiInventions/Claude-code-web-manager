/** One prior chat line, or a tool result the model must see on the next step. */
export type LoopItem =
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; arguments: string; output: string; ok: boolean };

export interface ModelCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ModelStep {
  text: string;
  calls: ModelCall[];
}

export interface JarvisToolNote {
  name: string;
  ok: boolean;
}

const DEFAULT_STEPS = 8;

/**
 * Talk to the model, run the tool calls it asks for, and repeat until it answers.
 * The transcript passed to callModel includes every tool result from this turn.
 */
export async function runToolLoop(opts: {
  messages: { role: "user" | "assistant"; text: string }[];
  callModel: (items: LoopItem[]) => Promise<ModelStep>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<{ text: string; ok: boolean }>;
  maxSteps?: number;
}): Promise<{ text: string; tools: JarvisToolNote[] }> {
  const items: LoopItem[] = opts.messages.map((message) => ({
    kind: message.role,
    text: message.text,
  }));
  const tools: JarvisToolNote[] = [];
  const max = opts.maxSteps ?? DEFAULT_STEPS;
  let text = "";
  for (let step = 0; step < max; step++) {
    const reply = await opts.callModel(items);
    text = reply.text.trim();
    if (reply.calls.length === 0) return { text, tools };
    for (const call of reply.calls) {
      const parsed = parseArgs(call.arguments);
      if (!parsed.ok) {
        tools.push({ name: call.name, ok: false });
        items.push({
          kind: "tool",
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          output: "arguments were not a JSON object",
          ok: false,
        });
        continue;
      }
      const result = await opts.callTool(call.name, parsed.args);
      tools.push({ name: call.name, ok: result.ok });
      items.push({
        kind: "tool",
        id: call.id,
        name: call.name,
        arguments: call.arguments,
        output: result.text,
        ok: result.ok,
      });
    }
  }
  return {
    text: text || "Ich habe das Werkzeug-Limit erreicht. Sag mir, womit ich weitermachen soll.",
    tools,
  };
}

function parseArgs(raw: string): { ok: true; args: Record<string, unknown> } | { ok: false } {
  const text = raw.trim();
  if (!text) return { ok: true, args: {} };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
    return { ok: true, args: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}
