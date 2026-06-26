"use client";

import { useEffect, useState } from "react";
import { AudioLines, Check, Cpu, FolderOpen, KeyRound, Save, Server } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge, Button, Card, Input, Spinner } from "../ui";

interface PublicConfig {
  projectsDir: string;
  openaiModel: string;
  hasApiKey: boolean;
  hasCartesiaKey: boolean;
  cartesiaVoice: string;
  host: string;
  port: number;
}

interface VoiceOption {
  id: string;
  name: string;
  gender: string;
}

export default function SettingsSection() {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [projectsDir, setProjectsDir] = useState("");
  const [model, setModel] = useState("");
  const [voice, setVoice] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((c: PublicConfig) => {
        setCfg(c);
        setProjectsDir(c.projectsDir);
        setModel(c.openaiModel);
        setVoice(c.cartesiaVoice);
      })
      .catch(() => {});
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => setModels(d.models ?? []))
      .catch(() => {});
    fetch("/api/voice/voices")
      .then((r) => r.json())
      .then((d) => setVoices(d.voices ?? []))
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectsDir, openaiModel: model, cartesiaVoice: voice }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setCfg(d);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!cfg)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <Card className="space-y-3 p-5">
          <Label
            icon={FolderOpen}
            title="Projektordner"
            hint="Direkte Unterordner werden als Projekte gelistet (Dashboard & Jarvis-Index)."
          />
          <Input
            value={projectsDir}
            onChange={(e) => setProjectsDir(e.target.value)}
            placeholder="C:\Users\you\projects"
            className="font-mono text-[13px]"
          />
        </Card>

        <Card className="space-y-3 p-5">
          <Label icon={Cpu} title="OpenAI-Modell" hint="Für Jarvis-Reasoning und den Prompt-Verbesserer." />
          {models.length > 0 ? (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-9 w-full cursor-pointer rounded-md border border-line bg-raised px-2.5 text-sm text-ink outline-none focus:border-accent"
            >
              {model && !models.includes(model) && <option value={model}>{model} (aktuell)</option>}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <Input value={model} onChange={(e) => setModel(e.target.value)} className="font-mono text-[13px]" />
          )}
        </Card>

        <Card className="space-y-3 p-5">
          <Label
            icon={AudioLines}
            title="Jarvis-Stimme (Cartesia)"
            hint="Deutsche Stimme für die Sprachausgabe. Default: Sebastian – Orator."
          />
          {voices.length > 0 ? (
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="h-9 w-full cursor-pointer rounded-md border border-line bg-raised px-2.5 text-sm text-ink outline-none focus:border-accent"
            >
              {voice && !voices.some((v) => v.id === voice) && (
                <option value={voice}>{voice} (aktuell)</option>
              )}
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.gender ? ` · ${v.gender}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-faint">
              {cfg.hasCartesiaKey
                ? "Stimmen werden geladen…"
                : "Kein Cartesia-Key gesetzt — Stimmen nicht verfügbar."}
            </p>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <Label icon={KeyRound} title="OpenAI API-Key" hint="Reasoning + Prompt-Verbesserer. Nur serverseitig." />
            {cfg.hasApiKey ? (
              <Badge tone="running" dot>
                gesetzt
              </Badge>
            ) : (
              <Badge tone="danger" dot>
                fehlt
              </Badge>
            )}
          </div>
          <div className="h-px bg-line" />
          <div className="flex items-center justify-between gap-3">
            <Label icon={AudioLines} title="Cartesia API-Key" hint="Sprache (STT + TTS). Nur serverseitig." />
            {cfg.hasCartesiaKey ? (
              <Badge tone="running" dot>
                gesetzt
              </Badge>
            ) : (
              <Badge tone="danger" dot>
                fehlt
              </Badge>
            )}
          </div>
          <div className="h-px bg-line" />
          <div className="flex items-center justify-between gap-3">
            <Label icon={Server} title="Server" hint="Nur lokal erreichbar." />
            <span className="flex items-center gap-2 font-mono text-xs text-muted">
              {cfg.host}:{cfg.port}
              <Badge tone="accent">loopback</Badge>
            </span>
          </div>
        </Card>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-3">
          <Button variant="primary" icon={saved ? Check : Save} onClick={save} loading={saving}>
            {saved ? "Gespeichert" : "Speichern"}
          </Button>
          <span className="text-xs text-faint">Änderungen gelten sofort — kein Neustart nötig.</span>
        </div>
      </div>
    </div>
  );
}

function Label({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-faint" />
      <div>
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="text-xs text-faint">{hint}</div>
      </div>
    </div>
  );
}
