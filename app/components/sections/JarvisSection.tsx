"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Trash2 } from "lucide-react";
import Markdown from "../Markdown";
import { Badge, Button, Textarea } from "../ui";

interface ToolNote {
  name: string;
  ok: boolean;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  tools?: ToolNote[];
}

export default function JarvisSection() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [hasKey, setHasKey] = useState(true);
  const [modelLabel, setModelLabel] = useState("GPT 6 Luna");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    fetch("/api/jarvis")
      .then((res) => res.json())
      .then((data: { messages?: ChatMessage[]; hasKey?: boolean; modelLabel?: string }) => {
        if (stop) return;
        setMessages(data.messages ?? []);
        setHasKey(data.hasKey !== false);
        if (data.modelLabel) setModelLabel(data.modelLabel);
        setLoaded(true);
      })
      .catch(() => {
        if (!stop) {
          setError("Der Verlauf konnte nicht geladen werden.");
          setLoaded(true);
        }
      });
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  async function send() {
    const sent = text.trim();
    if (!sent || pending || !hasKey) return;
    setText("");
    setError("");
    setPending(true);
    setMessages((prev) => [
      ...prev,
      { id: `local_${Date.now()}`, role: "user", text: sent, createdAt: new Date().toISOString() },
    ]);
    try {
      const res = await fetch("/api/jarvis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: sent }),
      });
      const data = (await res.json()) as { messages?: ChatMessage[]; error?: string };
      if (data.messages) setMessages(data.messages);
      if (!res.ok) setError(data.error || "Jarvis konnte nicht antworten.");
    } catch {
      setError("Jarvis ist nicht erreichbar.");
      setText(sent);
    } finally {
      setPending(false);
    }
  }

  async function clearHistory() {
    if (!window.confirm("Den Jarvis-Verlauf löschen?")) return;
    setError("");
    const res = await fetch("/api/jarvis", { method: "DELETE" });
    const data = (await res.json()) as { messages?: ChatMessage[] };
    setMessages(data.messages ?? []);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-sm font-semibold text-ink">Jarvis</h2>
          <p className="text-[11px] text-faint">Steuert die App über den lokalen MCP-Server</p>
        </div>
        <Badge tone="accent">{modelLabel}</Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={Trash2}
          onClick={() => void clearHistory()}
          disabled={pending || messages.length === 0}
        >
          Verlauf löschen
        </Button>
      </header>

      {!hasKey && (
        <p className="border-b border-warn/30 bg-warn/10 px-5 py-2 text-[13px] text-warn">
          Kein OpenAI-API-Key. Trage ihn in den Einstellungen bei OpenAI ein. Jarvis nutzt {modelLabel}.
        </p>
      )}
      {error && (
        <p className="border-b border-danger/30 bg-danger/10 px-5 py-2 text-[13px] text-danger">{error}</p>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-4" role="log" aria-live="polite">
        {loaded && messages.length === 0 && !pending && (
          <div className="grid h-full place-items-center text-center">
            <div className="max-w-sm">
              <Bot className="mx-auto mb-3 size-8 text-accent" />
              <p className="text-sm font-medium text-ink">Frag Jarvis</p>
              <p className="mt-1 text-[13px] text-muted">
                Zum Beispiel: Zeig die laufenden GitHub-Sessions und lies den Verlauf von Session 1.
              </p>
            </div>
          </div>
        )}
        {messages.map((entry) => (
          <article
            key={entry.id}
            className={
              entry.role === "user"
                ? "ml-auto max-w-[75%] rounded-lg bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] px-3 py-2"
                : "mr-auto max-w-[75%] rounded-lg border border-line bg-raised px-3 py-2"
            }
          >
            <p className="mb-1 text-[11px] text-faint">{entry.role === "user" ? "Du" : "Jarvis"}</p>
            {entry.role === "assistant" ? (
              <Markdown>{entry.text}</Markdown>
            ) : (
              <p className="whitespace-pre-wrap text-sm text-ink">{entry.text}</p>
            )}
            {entry.tools && entry.tools.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {entry.tools.map((tool, index) => (
                  <span
                    key={`${entry.id}_${tool.name}_${index}`}
                    className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted"
                  >
                    {tool.ok ? tool.name : `${tool.name} fehlgeschlagen`}
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
        {pending && <p className="text-[13px] text-muted">Jarvis arbeitet…</p>}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-line px-5 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Textarea
          rows={2}
          value={text}
          placeholder={hasKey ? "Nachricht an Jarvis" : "Zuerst den OpenAI-Key in den Einstellungen setzen"}
          disabled={pending || !hasKey}
          className="min-h-0 resize-none"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button type="submit" variant="primary" loading={pending} disabled={!text.trim() || !hasKey}>
          Senden
        </Button>
      </form>
    </div>
  );
}
