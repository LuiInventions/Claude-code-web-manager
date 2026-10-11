"use client";

import { useEffect, useState } from "react";
import { Cpu, FolderOpen, KeyRound, Rocket, Sparkles, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, Card, Input } from "./ui";

interface ProviderOpt {
  id: string;
  label: string;
  keysUrl: string;
  listModels: boolean;
  defaultModel: string;
  models: string[];
}

interface CodeCliOpt {
  id: string;
  label: string;
  bin: string;
  hint: string;
  installed: boolean;
}

export default function SetupScreen({ onReady }: { onReady: () => void }) {
  const [projectsDir, setProjectsDir] = useState("");
  const [codeCli, setCodeCli] = useState("claude");
  const [codeClis, setCodeClis] = useState<CodeCliOpt[]>([]);
  const [providers, setProviders] = useState<ProviderOpt[]>([]);
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const desktop = typeof window !== "undefined" ? window.cccDesktop : undefined;

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(
        (c: {
          providers?: ProviderOpt[];
          aiProvider?: string;
          aiModel?: string;
          projectsDir?: string;
          codeCli?: string;
          codeClis?: CodeCliOpt[];
        }) => {
          setProviders(c.providers ?? []);
          setCodeClis(c.codeClis ?? []);
          if (c.projectsDir) setProjectsDir(c.projectsDir);
          if (c.codeCli) setCodeCli(c.codeCli);
          if (c.aiProvider) setProvider(c.aiProvider);
          if (c.aiModel) setModel(c.aiModel);
        },
      )
      .catch(() => {});
  }, []);

  const pick = async () => {
    const dir = await desktop?.pickFolder();
    if (dir) setProjectsDir(dir);
  };

  // Switching provider resets the model to that provider's default so the
  // dropdown never shows a model that belongs to a different provider.
  const onProvider = (id: string) => {
    setProvider(id);
    const p = providers.find((x) => x.id === id);
    if (p) setModel(p.defaultModel);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!projectsDir.trim()) throw new Error("Bitte einen Projektordner wählen.");

      // AI key is optional — only save it if provided.
      if (apiKey.trim()) {
        const sec = await fetch("/api/secrets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ providerKeys: { [provider]: apiKey.trim() } }),
        });
        if (!sec.ok) throw new Error("Key konnte nicht gespeichert werden.");
      }

      const set = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectsDir: projectsDir.trim(),
          codeCli,
          aiProvider: provider,
          aiModel: model.trim() || undefined,
          // Stamp this version so the welcome screen doesn't reappear until the
          // next update (config.ready gate). The GitHub token is left intact.
          setupComplete: true,
        }),
      });
      const d = await set.json();
      if (d.error) throw new Error(d.error);

      onReady();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const current = providers.find((p) => p.id === provider);
  const modelOptions = current?.models ?? [];

  return (
    <div className="flex h-screen items-center justify-center overflow-auto bg-elevated p-6">
      <div className="w-full max-w-lg space-y-4">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold text-ink">Willkommen</h1>
          <p className="text-sm text-faint">
            Einmalige Einrichtung — alles bleibt lokal auf diesem Rechner.
          </p>
        </div>

        <Card className="space-y-3 p-5">
          <Field
            icon={FolderOpen}
            title="Projektordner"
            hint="Erforderlich. Direkte Unterordner werden als lokale Projekte gelistet."
          />
          <div className="flex gap-2">
            <Input
              value={projectsDir}
              onChange={(e) => setProjectsDir(e.target.value)}
              placeholder="C:\Users\you\projects"
              className="font-mono text-[13px]"
            />
            {desktop && (
              <Button variant="secondary" icon={FolderOpen} onClick={pick}>
                Wählen
              </Button>
            )}
          </div>
        </Card>

        <Card className="space-y-2 p-5">
          <Field
            icon={Terminal}
            title="Code-CLI"
            hint="Welche CLI die Sitzungen startet. Später unter Einstellungen änderbar."
          />
          <div className="grid gap-2">
            {(codeClis.length ? codeClis : [{ id: "claude", label: "Claude Code", bin: "claude", hint: "", installed: true }]).map(
              (c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCodeCli(c.id)}
                  className={`cursor-pointer rounded-md border px-3 py-2 text-left transition-colors ${
                    codeCli === c.id
                      ? "border-accent bg-surface"
                      : "border-line bg-raised hover:border-line"
                  }`}
                >
                  <div className="text-sm font-medium text-ink">{c.label}</div>
                  {c.hint && <div className="text-xs text-faint">{c.hint}</div>}
                  {!c.installed && (
                    <div className="text-xs text-danger">
                      `{c.bin}` ist nicht im PATH
                    </div>
                  )}
                </button>
              ),
            )}
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <Field
            icon={Sparkles}
            title="AI-Provider (optional)"
            hint="Für Prompt-Verbesserung & Session-Review. Ohne Key bleibt die App nutzbar — nur diese KI-Funktionen sind dann aus."
          />
          <select
            value={provider}
            onChange={(e) => onProvider(e.target.value)}
            className="h-9 w-full cursor-pointer rounded-md border border-line bg-raised px-2.5 text-sm text-ink outline-none focus:border-accent"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          {modelOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <Cpu className="size-4 shrink-0 text-faint" />
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-9 w-full cursor-pointer rounded-md border border-line bg-raised px-2.5 text-sm text-ink outline-none focus:border-accent"
              >
                {model && !modelOptions.includes(model) && (
                  <option value={model}>{model} (aktuell)</option>
                )}
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <KeyRound className="size-4 shrink-0 text-faint" />
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`${current?.label ?? "API"}-Key (optional)`}
              className="font-mono text-[13px]"
            />
          </div>
          {current && (
            <p className="text-xs text-faint">
              Key holen:{" "}
              <a
                href={current.keysUrl}
                target="_blank"
                rel="noreferrer"
                className="cursor-pointer text-accent hover:underline"
              >
                {current.keysUrl}
              </a>
            </p>
          )}
        </Card>

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button
          variant="primary"
          icon={Rocket}
          onClick={submit}
          loading={busy}
          disabled={!projectsDir.trim()}
          className="w-full"
        >
          Loslegen
        </Button>
      </div>
    </div>
  );
}

function Field({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
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
