"use client";

import { useCallback, useEffect, useState } from "react";
import { AudioLines, Check, FolderOpen, KeyRound, Save, Server, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge, Button, Card, Input, Spinner } from "../ui";

interface ProviderOpt {
  id: string;
  label: string;
  keysUrl: string;
  listModels: boolean;
}

interface PublicConfig {
  projectsDir: string;
  aiProvider: string;
  aiModel: string;
  hasAiKey: boolean;
  providers: ProviderOpt[];
  providerStatus: Record<string, boolean>;
  hasCartesiaKey: boolean;
  hasPicovoiceKey: boolean;
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
  const [projectsDir, setProjectsDir] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [voice, setVoice] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [aiKey, setAiKey] = useState("");
  const [cartesiaKey, setCartesiaKey] = useState("");
  const [picovoiceKey, setPicovoiceKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(
    () =>
      fetch("/api/settings")
        .then((r) => r.json())
        .then((c: PublicConfig) => {
          setCfg(c);
          setProjectsDir(c.projectsDir);
          setModel(c.aiModel);
          setVoice(c.cartesiaVoice);
        }),
    [],
  );

  const loadModels = useCallback(
    () =>
      fetch("/api/models")
        .then((r) => r.json())
        .then((d) => setModels(d.models ?? []))
        .catch(() => setModels([])),
    [],
  );

  useEffect(() => {
    loadConfig().catch(() => {});
    loadModels();
    fetch("/api/voice/voices")
      .then((r) => r.json())
      .then((d) => setVoices(d.voices ?? []))
      .catch(() => {});
  }, [loadConfig, loadModels]);

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const saveSettings = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setCfg(d);
      setModel(d.aiModel);
      setVoice(d.cartesiaVoice);
      setProjectsDir(d.projectsDir);
      flashSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveSecret = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await fetch("/api/secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      await loadConfig();
      flashSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const changeProvider = async (id: string) => {
    await saveSettings({ aiProvider: id });
    setAiKey("");
    await loadModels();
  };

  if (!cfg)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );

  const provider = cfg.providers.find((p) => p.id === cfg.aiProvider);
  const canList = Boolean(provider?.listModels) && models.length > 0;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <Card className="space-y-3 p-5">
          <Label
            icon={FolderOpen}
            title="Local Projects folder"
            hint="Direct subfolders are listed as projects (Local Projects & index)."
          />
          <div className="flex gap-2">
            <Input
              value={projectsDir}
              onChange={(e) => setProjectsDir(e.target.value)}
              placeholder="C:\Users\you\projects"
              className="font-mono text-[13px]"
            />
            <Button
              variant="secondary"
              onClick={() => saveSettings({ projectsDir })}
              disabled={!projectsDir.trim()}
            >
              Save
            </Button>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <Label
              icon={Sparkles}
              title="AI provider"
              hint="Prompt improver + session review. Optional — without a key these are disabled."
            />
            <Badge tone={cfg.hasAiKey ? "running" : "neutral"} dot>
              {cfg.hasAiKey ? "active" : "no key"}
            </Badge>
          </div>

          <select
            value={cfg.aiProvider}
            onChange={(e) => changeProvider(e.target.value)}
            className="h-9 w-full cursor-pointer rounded-md border border-line bg-raised px-2.5 text-sm text-ink outline-none focus:border-accent"
          >
            {cfg.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {cfg.providerStatus[p.id] ? " ✓" : ""}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <Input
              type="password"
              value={aiKey}
              onChange={(e) => setAiKey(e.target.value)}
              placeholder={`${provider?.label ?? "API"} key${cfg.hasAiKey ? " (set — leave blank to keep)" : ""}`}
              className="font-mono text-[13px]"
            />
            <Button
              variant="secondary"
              onClick={() => {
                saveSecret({ providerKeys: { [cfg.aiProvider]: aiKey } });
                setAiKey("");
              }}
              disabled={!aiKey.trim()}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              onClick={() => saveSecret({ providerKeys: { [cfg.aiProvider]: "" } })}
              disabled={!cfg.hasAiKey}
            >
              Clear
            </Button>
          </div>

          {provider && (
            <p className="text-xs text-faint">
              Get a key:{" "}
              <a
                href={provider.keysUrl}
                target="_blank"
                rel="noreferrer"
                className="cursor-pointer text-accent hover:underline"
              >
                {provider.keysUrl}
              </a>
            </p>
          )}

          <div className="h-px bg-line" />
          <Label icon={Sparkles} title="Model" hint="Used for prompt improvement & review." />
          <div className="flex gap-2">
            {canList ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-9 w-full cursor-pointer rounded-md border border-line bg-raised px-2.5 text-sm text-ink outline-none focus:border-accent"
              >
                {model && !models.includes(model) && <option value={model}>{model} (current)</option>}
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="model id"
                className="font-mono text-[13px]"
              />
            )}
            <Button
              variant="secondary"
              onClick={() => saveSettings({ aiModel: model })}
              disabled={!model.trim()}
            >
              Save
            </Button>
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <Label
            icon={AudioLines}
            title="Voice (Cartesia)"
            hint="Voice for text-to-speech output. Default: Sebastian – Orator."
          />
          {voices.length > 0 ? (
            <div className="flex gap-2">
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="h-9 w-full cursor-pointer rounded-md border border-line bg-raised px-2.5 text-sm text-ink outline-none focus:border-accent"
              >
                {voice && !voices.some((v) => v.id === voice) && (
                  <option value={voice}>{voice} (current)</option>
                )}
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.gender ? ` · ${v.gender}` : ""}
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => saveSettings({ cartesiaVoice: voice })}>
                Save
              </Button>
            </div>
          ) : (
            <p className="text-xs text-faint">
              {cfg.hasCartesiaKey ? "Loading voices…" : "No Cartesia key set — voices unavailable."}
            </p>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <KeyRow
            icon={AudioLines}
            title="Cartesia API key"
            hint="Speech (STT + TTS). Encrypted at rest."
            has={cfg.hasCartesiaKey}
            value={cartesiaKey}
            onChange={setCartesiaKey}
            onSave={() => {
              saveSecret({ cartesiaApiKey: cartesiaKey });
              setCartesiaKey("");
            }}
            onClear={() => saveSecret({ cartesiaApiKey: "" })}
          />
          <div className="h-px bg-line" />
          <KeyRow
            icon={KeyRound}
            title="Picovoice Access key"
            hint="Local wake-word. Encrypted at rest."
            has={cfg.hasPicovoiceKey}
            value={picovoiceKey}
            onChange={setPicovoiceKey}
            onSave={() => {
              saveSecret({ picovoiceAccessKey: picovoiceKey });
              setPicovoiceKey("");
            }}
            onClear={() => saveSecret({ picovoiceAccessKey: "" })}
          />
          <div className="h-px bg-line" />
          <div className="flex items-center justify-between gap-3">
            <Label icon={Server} title="Server" hint="Local access only." />
            <span className="flex items-center gap-2 font-mono text-xs text-muted">
              {cfg.host}:{cfg.port}
              <Badge tone="accent">loopback</Badge>
            </span>
          </div>
        </Card>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-3 text-xs text-faint">
          {saved ? (
            <span className="flex items-center gap-1.5 text-running">
              <Check className="size-3.5" /> Saved
            </span>
          ) : saving ? (
            <span className="flex items-center gap-1.5">
              <Save className="size-3.5" /> Saving…
            </span>
          ) : (
            <span>Changes apply immediately — no restart needed.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function KeyRow({
  icon,
  title,
  hint,
  has,
  value,
  onChange,
  onSave,
  onClear,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  has: boolean;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label icon={icon} title={title} hint={hint} />
        <Badge tone={has ? "running" : "danger"} dot>
          {has ? "set" : "missing"}
        </Badge>
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={has ? "•••••••• (leave blank to keep)" : "enter key"}
          className="font-mono text-[13px]"
        />
        <Button variant="secondary" onClick={onSave} disabled={!value.trim()}>
          Save
        </Button>
        <Button variant="ghost" onClick={onClear} disabled={!has}>
          Clear
        </Button>
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
