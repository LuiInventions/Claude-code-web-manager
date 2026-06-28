"use client";

import { useState } from "react";
import { FolderOpen, KeyRound, Rocket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, Card, Input } from "./ui";

export default function SetupScreen({ onReady }: { onReady: () => void }) {
  const [projectsDir, setProjectsDir] = useState("");
  const [openai, setOpenai] = useState("");
  const [cartesia, setCartesia] = useState("");
  const [picovoice, setPicovoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const desktop = typeof window !== "undefined" ? window.cccDesktop : undefined;

  const pick = async () => {
    const dir = await desktop?.pickFolder();
    if (dir) setProjectsDir(dir);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!projectsDir.trim()) throw new Error("Bitte einen Projektordner wählen.");
      if (!openai.trim()) throw new Error("OpenAI API-Key ist erforderlich.");

      const sec = await fetch("/api/secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          openaiApiKey: openai.trim(),
          cartesiaApiKey: cartesia.trim(),
          picovoiceAccessKey: picovoice.trim(),
        }),
      });
      if (!sec.ok) throw new Error("Keys konnten nicht gespeichert werden.");

      const set = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectsDir: projectsDir.trim() }),
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
            hint="Direkte Unterordner werden als Projekte gelistet."
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

        <Card className="space-y-3 p-5">
          <Field
            icon={KeyRound}
            title="OpenAI API-Key"
            hint="Erforderlich. Wird verschlüsselt gespeichert."
          />
          <Input
            type="password"
            value={openai}
            onChange={(e) => setOpenai(e.target.value)}
            placeholder="sk-..."
            className="font-mono text-[13px]"
          />
          <Field
            icon={KeyRound}
            title="Cartesia API-Key (optional)"
            hint="Für Sprachausgabe (TTS)."
          />
          <Input
            type="password"
            value={cartesia}
            onChange={(e) => setCartesia(e.target.value)}
            placeholder="leer lassen, wenn nicht genutzt"
            className="font-mono text-[13px]"
          />
          <Field
            icon={KeyRound}
            title="Picovoice Access-Key (optional)"
            hint="Für lokales Wake-Word."
          />
          <Input
            type="password"
            value={picovoice}
            onChange={(e) => setPicovoice(e.target.value)}
            placeholder="leer lassen, wenn nicht genutzt"
            className="font-mono text-[13px]"
          />
        </Card>

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button
          variant="primary"
          icon={Rocket}
          onClick={submit}
          loading={busy}
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
