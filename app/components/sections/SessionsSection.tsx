"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Boxes, RefreshCw } from "lucide-react";
import { Button, EmptyState, Input } from "../ui";
import type { VisualSession } from "@/lib/sessions";
import type { CodeCliId } from "@/lib/code-clis";
import type { RemotePublicStatus } from "@/lib/remote-ssh";
import ClaudeCmdPane from "./launcher/ClaudeCmdPane";

const OfficeView = dynamic(() => import("../sessions/OfficeView"), { ssr: false });

const CLI_BUTTONS: { id: CodeCliId; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "grok", label: "Grok" },
  { id: "codex", label: "Codex" },
];

interface RemotePane {
  id: string;
  cli: CodeCliId;
  cwd: string;
  projectName: string;
  createdAt: number;
}

/**
 * Sessions tab. Local launcher sessions stay in the pixel office. When the
 * user's server is not connected, this tab asks for IP, password and a 2FA
 * code and logs in through the ssh command line. Once connected, Claude, Grok
 * and Codex start on that server and show up in the same office.
 */
export default function SessionsSection() {
  const [sessions, setSessions] = useState<VisualSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [remote, setRemote] = useState<RemotePublicStatus | null>(null);
  const [panes, setPanes] = useState<RemotePane[]>([]);
  const [activePane, setActivePane] = useState<string>("");
  const dismissed = useRef(new Set<string>());
  const wasConnected = useRef(false);

  const load = useCallback(() => {
    fetch("/api/launcher/live-sessions")
      .then((r) => r.json())
      .then((d: { sessions?: VisualSession[] }) => {
        setSessions(d.sessions ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const loadRemote = useCallback(() => {
    fetch("/api/remote")
      .then((r) => r.json())
      .then((d: RemotePublicStatus) => setRemote(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    loadRemote();
    const t = setInterval(loadRemote, remote?.connecting ? 1000 : 2500);
    return () => clearInterval(t);
  }, [loadRemote, remote?.connecting]);

  useEffect(() => {
    const alive = new Set(sessions.map((s) => s.id));
    for (const id of dismissed.current) {
      if (!alive.has(id)) dismissed.current.delete(id);
    }
    setPanes((prev) => {
      const known = new Set(prev.map((p) => p.id));
      const added: RemotePane[] = [];
      for (const s of sessions) {
        if (s.where !== "remote" || s.status !== "running") continue;
        if (known.has(s.id) || dismissed.current.has(s.id)) continue;
        const cli: CodeCliId = s.cli === "grok" || s.cli === "codex" ? s.cli : "claude";
        added.push({
          id: s.id,
          cli,
          cwd: s.cwd || "~",
          projectName: s.projectName || `Server · ${cli}`,
          createdAt: s.startedAt,
        });
      }
      return added.length ? [...prev, ...added] : prev;
    });
  }, [sessions]);

  useEffect(() => {
    if (!remote) return;
    if (wasConnected.current && !remote.connected) setPanes([]);
    wasConnected.current = remote.connected;
  }, [remote]);

  const startRemote = (cli: CodeCliId, cwd: string) => {
    const id = `r_${cli}_${Date.now()}`;
    const label = CLI_BUTTONS.find((b) => b.id === cli)?.label ?? cli;
    const pane: RemotePane = {
      id,
      cli,
      cwd,
      projectName: `Server · ${label}`,
      createdAt: Date.now(),
    };
    setPanes((prev) => [...prev, pane]);
    setActivePane(id);
  };

  const closePane = (id: string) => {
    dismissed.current.add(id);
    setPanes((prev) => prev.filter((p) => p.id !== id));
    setActivePane((cur) => (cur === id ? "" : cur));
    void fetch(`/api/launcher/live-sessions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  };

  const shown = panes.find((p) => p.id === activePane) ?? panes[0];
  const connected = remote?.connected === true;
  const showCard = loaded && sessions.length === 0 && panes.length === 0 && !connected;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-sm font-semibold text-ink">Sessions</h2>
          <p className="text-[11px] text-faint">
            {sessions.length} live launcher session{sessions.length === 1 ? "" : "s"}
            {connected ? ` · ${remote?.user}@${remote?.host}` : ""}
          </p>
        </div>
        <button
          onClick={() => {
            load();
            loadRemote();
          }}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-line text-faint transition-colors hover:text-ink"
          title="Refresh"
        >
          <RefreshCw className="size-4" />
        </button>
      </header>

      {loaded && !showCard && (
        <RemoteLogin
          status={remote}
          busy={remote?.connecting === true}
          onRefresh={loadRemote}
          onStart={startRemote}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {showCard ? (
            <div className="grid h-full place-items-center p-6">
              <div className="w-full max-w-md">
                <RemoteLogin
                  status={remote}
                  busy={remote?.connecting === true}
                  onRefresh={loadRemote}
                  onStart={startRemote}
                  stacked
                />
              </div>
            </div>
          ) : loaded && sessions.length === 0 && panes.length === 0 ? (
            <div className="grid h-full place-items-center">
              <EmptyState
                icon={Boxes}
                title="Noch keine Session"
                description="Starte Claude, Grok oder Codex auf dem Server. Die Session erscheint hier im Büro."
              />
            </div>
          ) : sessions.length > 0 ? (
            <OfficeView sessions={sessions} />
          ) : null}
        </div>

        {shown && (
          <div className="flex w-[46%] min-w-[340px] max-w-[640px] flex-col border-l border-line">
            <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
              {panes.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActivePane(p.id)}
                  className={
                    p.id === shown.id
                      ? "cursor-pointer rounded-md bg-selected px-2 py-1 text-[12px] text-ink"
                      : "cursor-pointer rounded-md px-2 py-1 text-[12px] text-muted hover:bg-raised"
                  }
                >
                  {p.projectName}
                </button>
              ))}
              <button
                onClick={() => closePane(shown.id)}
                className="ml-auto cursor-pointer rounded-md px-2 py-1 text-[12px] text-faint hover:text-ink"
              >
                Beenden
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              {panes.map((p) => (
                <div
                  key={p.id}
                  className={p.id === shown.id ? "flex min-h-0 flex-1 flex-col" : "hidden"}
                >
                  <ClaudeCmdPane
                    id={p.id}
                    cwd={p.cwd}
                    prompt=""
                    model=""
                    effort=""
                    where="remote"
                    cli={p.cli}
                    projectName={p.projectName}
                    createdAt={p.createdAt}
                    layoutNonce={p.id === shown.id ? 1 : 0}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <footer className="border-t border-line px-5 py-2 text-[11px] text-faint">
        Pixel office inspired by{" "}
        <a
          className="cursor-pointer text-accent hover:underline"
          href="https://github.com/pixel-agents-hq/pixel-agents"
          target="_blank"
          rel="noreferrer"
        >
          pixel-agents
        </a>
        .
      </footer>
    </div>
  );
}

function RemoteLogin({
  status,
  busy,
  stacked,
  onRefresh,
  onStart,
}: {
  status: RemotePublicStatus | null;
  busy: boolean;
  stacked?: boolean;
  onRefresh: () => void;
  onStart: (cli: CodeCliId, cwd: string) => void;
}) {
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [dir, setDir] = useState("~");
  const [saveLogin, setSaveLogin] = useState(false);
  const [pickedId, setPickedId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const prefilled = useRef(false);

  useEffect(() => {
    if (!status || prefilled.current) return;
    prefilled.current = true;
    setHost(status.host);
    setUser(status.user);
    setDir(status.dir || "~");
    setSaveLogin(status.saveLogin);
  }, [status]);

  const connect = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/remote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          host,
          user,
          password,
          otp,
          saveLogin,
          dir,
        }),
      });
      if (res.ok) setPassword("");
      setOtp("");
    } finally {
      setSubmitting(false);
      onRefresh();
    }
  };

  const disconnect = async () => {
    await fetch("/api/remote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "disconnect" }),
    });
    onRefresh();
  };

  const start = async (cli: CodeCliId) => {
    const cwd = dir.trim() || "~";
    await fetch("/api/remote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "dir", dir: cwd }),
    });
    onStart(cli, cwd);
  };

  if (status?.connected) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
        <span className="text-[12px] text-muted">
          Verbunden mit {status.user}@{status.host}
        </span>
        <Input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          aria-label="Ordner auf dem Server"
          className="h-8 w-48 font-mono text-[12px]"
          spellCheck={false}
        />
        {CLI_BUTTONS.map((b) => (
          <Button key={b.id} size="sm" variant="primary" onClick={() => void start(b.id)}>
            {b.label}
          </Button>
        ))}
        <Button size="sm" variant="danger" className="ml-auto" onClick={() => void disconnect()}>
          Trennen
        </Button>
      </div>
    );
  }

  const picked = status?.servers?.find((s) => s.id === pickedId);
  const passwordReady =
    password.trim().length > 0 || (saveLogin && Boolean(picked?.hasPassword));
  const chooseServer = (id: string) => {
    setPickedId(id);
    setPassword("");
    setOtp("");
    const server = status?.servers?.find((s) => s.id === id);
    if (!server) {
      setHost("");
      setUser("");
      setDir("~");
      setSaveLogin(false);
      return;
    }
    setHost(server.host);
    setUser(server.user);
    setDir(server.dir || "~");
    setSaveLogin(server.hasPassword);
  };
  const hostReady = host.trim().length > 0 && (user.trim().length > 0 || host.includes("@"));

  const fields = (
    <>
      <Input
        value={host}
        onChange={(e) => setHost(e.target.value)}
        placeholder="IP oder user@IP"
        aria-label="Server-IP"
        autoComplete="off"
        spellCheck={false}
        className="font-mono text-[13px]"
      />
      <Input
        value={user}
        onChange={(e) => setUser(e.target.value)}
        placeholder="Benutzer"
        aria-label="Benutzer"
        autoComplete="username"
        spellCheck={false}
      />
      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={saveLogin && picked?.hasPassword ? "gespeichert" : "Passwort"}
        aria-label="Passwort"
        autoComplete="current-password"
      />
      <Input
        value={otp}
        onChange={(e) => setOtp(e.target.value)}
        placeholder="2FA-Code"
        aria-label="2FA-Code"
        autoComplete="one-time-code"
        inputMode="numeric"
        spellCheck={false}
      />
      {!stacked && (
        <Input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder="Ordner, z. B. ~"
          aria-label="Ordner auf dem Server"
          spellCheck={false}
          className="font-mono text-[13px]"
        />
      )}
    </>
  );

  return (
    <form
      className={
        stacked
          ? "space-y-3 rounded-lg border border-line bg-elevated p-4"
          : "flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5"
      }
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && hostReady && passwordReady) void connect();
      }}
    >
      {stacked && (
        <div>
          <h3 className="text-sm font-semibold text-ink">Server verbinden</h3>
          <p className="mt-1 text-[12px] text-muted">
            Anmeldung über die ssh-Kommandozeile. Der 2FA-Code wird nicht gespeichert.
          </p>
        </div>
      )}
      {(status?.servers?.length ?? 0) > 0 && (
        <div className={stacked ? "flex gap-2" : "flex basis-full gap-2"}>
          <select
            value={pickedId}
            onChange={(e) => chooseServer(e.target.value)}
            aria-label="Gespeicherter Server"
            className="h-9 min-w-0 flex-1 cursor-pointer rounded-md border border-line bg-raised px-2.5 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="">Gespeicherter Server…</option>
            {status?.servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.user}@{s.host}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" onClick={() => chooseServer("")}>
            Neu
          </Button>
        </div>
      )}
      {stacked ? <div className="space-y-2">{fields}</div> : fields}
      {stacked && (
        <Input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder="Ordner auf dem Server, z. B. ~"
          aria-label="Ordner auf dem Server"
          spellCheck={false}
          className="font-mono text-[13px]"
        />
      )}
      <label className="flex items-center gap-2 text-[12px] text-muted">
        <input
          type="checkbox"
          checked={saveLogin}
          onChange={(e) => setSaveLogin(e.target.checked)}
          className="size-3.5 accent-[var(--accent)]"
        />
        IP und Passwort speichern
      </label>
      <Button
        type="submit"
        size="sm"
        variant="primary"
        loading={busy || submitting}
        disabled={!hostReady || !passwordReady}
      >
        Verbinden
      </Button>
      {!stacked && (
        <span className="text-[11px] text-faint">2FA wird nicht gespeichert.</span>
      )}
      {status?.error && (
        <p className={stacked ? "text-sm text-danger" : "basis-full text-[12px] text-danger"}>
          {status.error}
        </p>
      )}
      {status?.error && status.detail && (
        <pre className="basis-full max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-faint">
          {status.detail}
        </pre>
      )}
    </form>
  );
}
