"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, X } from "lucide-react";
import { Button, Input, cn } from "../ui";
import ClaudeCmdPane from "./launcher/ClaudeCmdPane";
import SshLoginPane from "./SshLoginPane";
import type { RemotePublicStatus } from "@/lib/remote-ssh";

const EMPTY: RemotePublicStatus = {
  connected: false,
  connecting: false,
  host: "",
  user: "",
  dir: "~",
  serverId: "",
  servers: [],
  saveLogin: false,
  hasSavedPassword: false,
  error: "",
  detail: "",
  needsPassword: false,
  needsOtp: false,
};

const BOX_COUNTS = [1, 2, 3, 4, 5, 6] as const;

interface Box {
  id: string;
  createdAt: number;
}

function gridShape(n: number): { cols: number; rows: number } {
  const cols = n <= 2 ? 1 : 2;
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
}

export default function RemoteSection() {
  const [status, setStatus] = useState<RemotePublicStatus>(EMPTY);
  const [login, setLogin] = useState("");
  const [picked, setPicked] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [saveLogin, setSaveLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [boxCount, setBoxCount] = useState(1);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [cli, setCli] = useState("claude");

  const load = useCallback(() => {
    fetch("/api/remote")
      .then((r) => r.json())
      .then((d: RemotePublicStatus) =>
        setStatus({ ...EMPTY, ...d, servers: d.servers ?? [] }),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const wait = status.connecting || status.needsPassword || status.needsOtp;
    const t = setInterval(load, wait ? 1000 : 3000);
    return () => clearInterval(t);
  }, [load, status.connecting, status.needsPassword, status.needsOtp]);

  useEffect(() => {
    if (!status.connected) setBoxes([]);
  }, [status.connected]);

  useEffect(() => {
    if (status.needsPassword) setSaveLogin(status.saveLogin);
  }, [status.needsPassword, status.saveLogin]);

  useEffect(() => {
    let cancelled = false;
    const pull = () =>
      fetch("/api/settings")
        .then((r) => r.json())
        .then((c: { codeCli?: string }) => {
          if (!cancelled && c.codeCli) setCli(c.codeCli);
        })
        .catch(() => {});
    void pull();
    const t = setInterval(pull, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/remote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as RemotePublicStatus;
      setStatus({ ...EMPTY, ...data, servers: data.servers ?? [] });
      return data;
    } finally {
      setBusy(false);
    }
  };

  const begin = async () => {
    const target = login.trim();
    const saved = status.servers.find((s) => s.id === picked);
    const data = await post({
      action: "begin",
      host: target,
      user: "",
      dir: saved?.dir || "~",
    });
    if (data.connecting || data.connected) setPassword("");
  };

  const sendPassword = async () => {
    const typed = password;
    const saved = status.servers.find((s) => s.id === status.serverId);
    const data = await post({
      action: "password",
      password: typed,
      saveLogin,
      useSaved: !typed && Boolean(saved?.hasPassword),
    });
    if (!data.error) setPassword("");
  };

  const sendOtp = async () => {
    const code = otp.trim();
    const data = await post({ action: "otp", otp: code });
    if (!data.error) setOtp("");
  };

  const disconnect = () => {
    void post({ action: "disconnect" });
    setPassword("");
    setOtp("");
  };

  const current = status.servers.find((s) => s.id === status.serverId);
  const showLogin = !status.connecting && !status.connected && !status.needsPassword && !status.needsOtp;
  const { cols, rows } = gridShape(boxes.length || 1);

  const startEmpty = () => {
    if (!status.connected) return;
    const stamp = Date.now().toString(36);
    const started = Date.now();
    const batch = Array.from({ length: boxCount }, (_, i) => ({
      id: `r_${stamp}_${i}`,
      createdAt: started + i,
    }));
    setBoxes((prev) => [...batch, ...prev]);
  };

  return (
    <div className="flex h-full min-h-0">
      {status.connected && (
        <aside className="flex w-56 shrink-0 flex-col gap-3 border-r border-line bg-elevated p-4">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wide text-faint">Server</div>
            <div className="truncate text-sm text-ink">
              {status.user}@{status.host}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Boxes</span>
            <div className="flex overflow-hidden rounded-md border border-line">
              {BOX_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setBoxCount(n)}
                  className={cn(
                    "cursor-pointer px-2 py-1.5 text-xs font-medium transition-colors",
                    boxCount === n ? "bg-selected text-ink" : "bg-raised text-muted hover:text-ink",
                  )}
                >
                  ×{n}
                </button>
              ))}
            </div>
          </div>
          <Button variant="primary" icon={Play} className="w-full" onClick={startEmpty}>
            Start without prompt ({boxCount}×)
          </Button>
          <Button variant="danger" size="sm" className="mt-auto w-full" onClick={disconnect}>
            Trennen
          </Button>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {status.connected ? (
          <div
            className="grid min-h-0 flex-1 gap-2 p-2"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
          >
            {boxes.length === 0 && (
              <div className="grid place-items-center text-sm text-faint">
                Start without prompt öffnet die Code-CLI auf dem Server.
              </div>
            )}
            {boxes.map((box) => (
              <div
                key={box.id}
                className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-line"
              >
                <button
                  type="button"
                  onClick={() => setBoxes((prev) => prev.filter((b) => b.id !== box.id))}
                  title="Stop / close box"
                  aria-label="Close box"
                  className="absolute right-1.5 top-1.5 z-20 inline-flex size-7 cursor-pointer items-center justify-center rounded-md border border-line bg-surface/80 text-faint backdrop-blur transition-colors hover:text-danger"
                >
                  <X className="size-4" />
                </button>
                <ClaudeCmdPane
                  id={box.id}
                  cwd={status.dir || "~"}
                  prompt=""
                  model=""
                  effort=""
                  where="remote"
                  cli={cli}
                  projectName={`${status.user}@${status.host}`}
                  createdAt={box.createdAt}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid flex-1 place-items-center px-6">
            <form
              className="w-full max-w-md space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (status.needsOtp) void sendOtp();
                else if (status.needsPassword) void sendPassword();
                else void begin();
              }}
            >
              <div>
                <h2 className="text-sm font-semibold text-ink">Remote</h2>
                <p className="text-xs text-faint">
                  {status.needsOtp
                    ? "Der Server verlangt einen 2FA-Code."
                    : status.needsPassword
                      ? "SSH fragt nach dem Passwort."
                      : status.connecting
                        ? "SSH läuft. Die nächste Abfrage erscheint hier, sobald die Kommandozeile danach fragt."
                        : "Zuerst user@IP. Passwort und 2FA kommen erst, wenn SSH danach fragt."}
                </p>
              </div>
              {status.error && <p className="text-xs text-danger">{status.error}</p>}

              {showLogin && (
                <>
                  {status.servers.length > 0 && (
                    <select
                      value={picked}
                      aria-label="Gespeicherter Server"
                      onChange={(e) => {
                        const id = e.target.value;
                        setPicked(id);
                        const saved = status.servers.find((s) => s.id === id);
                        setLogin(saved ? `${saved.user}@${saved.host}` : "");
                      }}
                      className="h-9 w-full cursor-pointer rounded-md border border-line bg-raised px-2.5 text-sm text-ink outline-none focus:border-accent"
                    >
                      <option value="">Neu</option>
                      {status.servers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.user}@{s.host}
                        </option>
                      ))}
                    </select>
                  )}
                  <Input
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    placeholder="user@IP"
                    aria-label="user@IP"
                    autoFocus
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <Button variant="primary" type="submit" className="w-full" loading={busy} disabled={!login.trim()}>
                    Verbinden
                  </Button>
                </>
              )}

              {status.needsPassword && (
                <>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Passwort"
                    aria-label="Passwort"
                    autoFocus
                    autoComplete="current-password"
                  />
                  {current?.hasPassword && (
                    <p className="text-xs text-faint">
                      Leer lassen, um das gespeicherte Passwort zu verwenden.
                    </p>
                  )}
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={saveLogin}
                      onChange={(e) => setSaveLogin(e.target.checked)}
                    />
                    IP und Passwort speichern
                  </label>
                  <Button variant="primary" type="submit" className="w-full" loading={busy}>
                    Weiter
                  </Button>
                </>
              )}

              {status.needsOtp && (
                <>
                  <Input
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="2FA-Code"
                    aria-label="2FA-Code"
                    autoFocus
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    spellCheck={false}
                  />
                  <Button variant="primary" type="submit" className="w-full" loading={busy} disabled={!otp.trim()}>
                    Senden
                  </Button>
                </>
              )}

              {(status.connecting || status.needsPassword || status.needsOtp) && (
                <Button type="button" variant="ghost" className="w-full" onClick={disconnect}>
                  Abbrechen
                </Button>
              )}
            </form>
          </div>
        )}
      </div>

      <aside className="flex w-[38%] min-w-[18rem] max-w-[36rem] shrink-0 flex-col border-l border-line bg-surface">
        <div className="border-b border-line px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-faint">
          SSH
        </div>
        <div className="min-h-0 flex-1 p-1">
          <SshLoginPane />
        </div>
      </aside>
    </div>
  );
}
