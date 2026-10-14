import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import OpenAI from "openai";
import { friendlyAiError } from "../../openai";
import { readSecrets } from "../../secrets";
import { readJson, writeJson } from "../../store";
import { mcpUrl } from "../mcp/endpoint";
import { clipText } from "../mcp/errors";
import { MCP_INSTRUCTIONS } from "../mcp/server";
import { jarvisSystemPrompt, type JarvisToolSpec } from "./prompt";
import { runToolLoop, type JarvisToolNote, type LoopItem } from "./turn";

export const JARVIS_MODEL = "gpt-6-luna";
export const JARVIS_MODEL_LABEL = "GPT 6 Luna";
const HISTORY_FILE = "jarvis-chat.json";
const MAX_STORED = 80;
const MAX_CONTEXT = 30;
const MAX_TEXT = 16_000;
const TOOL_TEXT_CAP = 24_000;

export interface JarvisMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  tools?: JarvisToolNote[];
}

export interface JarvisHistory {
  messages: JarvisMessage[];
}

export class JarvisRequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = "JarvisRequestError";
  }
}

let busy = false;

export function hasJarvisKey(): boolean {
  return Boolean(readSecrets().providerKeys?.openai?.trim());
}

export function loadJarvisHistory(): JarvisHistory {
  const raw = readJson<JarvisHistory>(HISTORY_FILE, { messages: [] });
  const messages = Array.isArray(raw.messages) ? raw.messages.filter(isMessage).slice(-MAX_STORED) : [];
  return { messages };
}

export function clearJarvisHistory(): JarvisHistory {
  const empty = { messages: [] };
  writeJson(HISTORY_FILE, empty);
  return empty;
}

/** Append the user's line, let GPT 6 Luna call MCP, and store the reply. */
export async function askJarvis(userText: string): Promise<JarvisHistory> {
  const text = userText.trim();
  if (!text) throw new JarvisRequestError("Schreib eine Nachricht.");
  if (text.length > MAX_TEXT) throw new JarvisRequestError("Die Nachricht ist zu lang.");
  if (!hasJarvisKey()) {
    throw new JarvisRequestError(
      "Kein OpenAI-API-Key. Trage ihn in den Einstellungen bei OpenAI ein. Jarvis nutzt GPT 6 Luna.",
    );
  }
  const url = mcpEndpoint();
  if (busy) throw new JarvisRequestError("Jarvis antwortet noch.", 409);
  busy = true;
  let history: JarvisHistory = { messages: [] };
  try {
    history = loadJarvisHistory();
    history.messages.push(message("user", text));
    saveHistory(history);
    const answer = await withMcp(url, async (client) => {
      const tools = (await listAllTools(client)).map(toSpec);
      const prompt = jarvisSystemPrompt(MCP_INSTRUCTIONS, tools);
      const openai = lunaClient();
      const functions = tools.map(toFunctionTool);
      return runToolLoop({
        messages: history.messages.slice(-MAX_CONTEXT).map(forModel),
        callModel: (items) => callLuna(openai, prompt, functions, items),
        callTool: (name, args) => callMcpTool(client, name, args),
      });
    });
    history.messages.push(message("assistant", answer.text || "Ich habe keine Antwort erhalten.", answer.tools));
    saveHistory(history);
    return loadJarvisHistory();
  } catch (err) {
    const note = err instanceof JarvisRequestError ? err.message : friendlyAiError(err);
    const last = history.messages[history.messages.length - 1];
    if (last?.role === "user") {
      history.messages.push(message("assistant", note));
      try {
        saveHistory(history);
      } catch {
        /* report the reply error */
      }
    }
    if (err instanceof JarvisRequestError) throw err;
    throw new JarvisRequestError(note);
  } finally {
    busy = false;
  }
}

async function listAllTools(client: Client) {
  const tools: Awaited<ReturnType<Client["listTools"]>>["tools"] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

function mcpEndpoint(): string {
  const live = mcpUrl();
  if (live) return live;
  const stored = readJson<{ url?: string | null }>("mcp.json", {}).url;
  if (stored) return stored;
  throw new JarvisRequestError("Der MCP-Server läuft nicht. Starte Jarvis Control Center neu.");
}

function lunaClient(): OpenAI {
  const key = readSecrets().providerKeys?.openai?.trim();
  if (!key) {
    throw new JarvisRequestError(
      "Kein OpenAI-API-Key. Trage ihn in den Einstellungen bei OpenAI ein. Jarvis nutzt GPT 6 Luna.",
    );
  }
  return new OpenAI({
    apiKey: key,
    baseURL: "https://api.openai.com/v1",
    timeout: 120_000,
    maxRetries: 0,
  });
}

async function withMcp<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "jarvis-tab", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function toSpec(tool: { name: string; description?: string; inputSchema?: object }): JarvisToolSpec {
  const parameters =
    tool.inputSchema && typeof tool.inputSchema === "object"
      ? (tool.inputSchema as Record<string, unknown>)
      : null;
  return { name: tool.name, description: tool.description ?? "", parameters };
}

function toFunctionTool(tool: JarvisToolSpec): OpenAI.Responses.FunctionTool {
  const parameters = sanitizeSchema(tool.parameters);
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters,
    strict: false,
  };
}

function sanitizeSchema(schema: Record<string, unknown> | null | undefined): { [key: string]: unknown } {
  if (!schema) return { type: "object", properties: {} };
  const copy: { [key: string]: unknown } = { ...schema };
  delete copy.$schema;
  return copy;
}

async function callLuna(
  client: OpenAI,
  prompt: string,
  tools: OpenAI.Responses.FunctionTool[],
  items: LoopItem[],
): Promise<{ text: string; calls: { id: string; name: string; arguments: string }[] }> {
  const response = await client.responses.create({
    model: JARVIS_MODEL,
    instructions: prompt,
    input: items.flatMap(toResponseItem),
    tools,
    reasoning: { effort: "low" },
    store: false,
  });
  const calls = response.output.flatMap((item) => {
    if (item.type !== "function_call") return [];
    return [{ id: item.call_id, name: item.name, arguments: item.arguments || "{}" }];
  });
  return { text: response.output_text ?? "", calls };
}

function toResponseItem(item: LoopItem): OpenAI.Responses.ResponseInput {
  if (item.kind === "tool") {
    return [
      {
        type: "function_call",
        call_id: item.id,
        name: item.name,
        arguments: item.arguments || "{}",
      },
      {
        type: "function_call_output",
        call_id: item.id,
        output: item.output,
      },
    ];
  }
  return [{ role: item.kind, content: item.text }];
}

async function callMcpTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; ok: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((part) => {
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
  return { text: clipText(text || "(leeres Werkzeug-Ergebnis)", TOOL_TEXT_CAP).text, ok: result.isError !== true };
}

function forModel(entry: JarvisMessage): { role: "user" | "assistant"; text: string } {
  if (entry.role === "assistant" && entry.tools?.length) {
    const names = entry.tools.map((tool) => tool.name).join(", ");
    return { role: "assistant", text: `${entry.text}\n\nWerkzeuge: ${names}` };
  }
  return { role: entry.role, text: entry.text };
}

function message(role: "user" | "assistant", text: string, tools?: JarvisToolNote[]): JarvisMessage {
  return {
    id: `j_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    createdAt: new Date().toISOString(),
    ...(tools && tools.length ? { tools } : {}),
  };
}

function saveHistory(history: JarvisHistory): void {
  writeJson(HISTORY_FILE, { messages: history.messages.slice(-MAX_STORED) });
}

function isMessage(value: unknown): value is JarvisMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<JarvisMessage>;
  return (
    typeof row.id === "string" &&
    (row.role === "user" || row.role === "assistant") &&
    typeof row.text === "string" &&
    typeof row.createdAt === "string"
  );
}
