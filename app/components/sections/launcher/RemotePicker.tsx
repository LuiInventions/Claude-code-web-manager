"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "../../ui";
import type { RemotePublicStatus } from "@/lib/remote-ssh";

export interface RemoteTarget {
  ready: boolean;
  dir: string;
  label: string;
}

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
  needsOtp: false,
  codiumReady: false,
  codiumUrl: "",
  codiumError: "",
};

/**
 * Saved servers under the launcher's Remote source.
 * Login is two fields: user@IP and password. The 2FA field appears only after
 * ssh has accepted the password and the server asks for a code.
 */
export default function RemotePicker({
  onTarget,
}: {
  onTarget: (target: RemoteTarget | null) => void;
}) {
  const [status, setStatus] = useState<RemotePublicStatus>(EMPTY);
  const [serverId, setServerId] = useState("");
  const [adding, setAdding] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [dir, setDir] = useState("~");
  const [saveLogin, setSaveLogin] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    fetch("/api/remote")
      .then((r) => r.json())
      .then((d: RemotePublicStatus) => setStatus({ ...EMPTY, ...d, servers: d.servers ?? [] }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, status.connecting || status.needsOtp ? 1000 : 3000);
    return () => clearInterval(t);
  }, [load, status.connecting, status.needsOtp]);

  const selected = status.servers.find((s) => s.id === serverId);
  const connectedHere = status.connected && !adding && status.serverId === serverId && serverId !== "";

  useEffect(() => {
    if (!connectedHere) {
      onTarget(null);
      return;
    }
    onTarget({
      ready: true,
      dir: dir.trim() || "~",
      label: `${status.user}@${status.host}`,
    });
  }, [connectedHere, dir, onTarget, status.host, status.user]);

  const pick = (id: string) => {
    setAdding(false);
    setServerId(id);
    setPassword("");
    setOtp("");
    const server = status.servers.find((s) => s.id === id);
    if (!server) {
      setLogin("");
      setDir("~");
      setSaveLogin(false);
      return;
    }
    setLogin(`${server.user}@${server.host}`);
    setDir(server.dir || "~");
    setSaveLogin(server.hasPassword);
  };

  const startNew = () => {
    setAdding(true);
    setServerId("");
    setLogin("");
    setPassword("");
    setOtp("");
    setDir("~");
    setSaveLogin(false);
  };

  const connect = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/remote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          host: login,
          user: "",
          password,
          otp: "",
          saveLogin,
          dir,
        }),
      });
      const data = (await res.json()) as RemotePublicStatus;
      setStatus({ ...EMPTY, ...data, servers: data.servers ?? [] });
      if (res.ok) {
        setPassword("");
        setOtp("");
        setAdding(false);
        if (data.serverId) setServerId(data.serverId);
        if (data.dir) setDir(data.dir);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const sendOtp = async () => {
    const code = otp.trim();
    if (!code) return;
    setOtp("");
    const res = await fetch("/api/remote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "otp", otp: code }),
    });
    const data = (await res.json()) as RemotePublicStatus;
    setStatus({ ...EMPTY, ...data, servers: data.servers ?? [] });
  };

  const disconnect = async () => {
    await fetch("/api/remote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "disconnect" }),
    });
    load();
  };

  const saveDir = () => {
    if (!status.connected) return;
    void fetch("/api/remote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "dir", dir: dir.trim() || "~" }),
    });
  };

  const passwordReady = password.trim().length > 0 || (saveLogin && Boolean(selected?.hasPassword));
  const loginReady = login.includes("@") && login.split("@").every((part) => part.trim().length > 0);
  const showForm = adding || (!connectedHere && (serverId !== "" || status.servers.length === 0));

  return (
    <div className="space-y-2">
      {!status.needsOtp && (
      <div className="flex items-center gap-2">
        <select
          value={adding ? "" : serverId}
          onChange={(e) => pick(e.target.value)}
          aria-label="Gespeicherter Server"
          className="h-9 min-w-0 flex-1 cursor-pointer rounded-md border border-line bg-raised px-2.5 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="">Server wählen…</option>
          {status.servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.user}@{s.host}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={startNew}
          className="inline-flex h-9 shrink-0 cursor-pointer items-center rounded-md border border-line bg-raised px-2.5 text-xs text-muted transition-colors hover:text-ink"
        >
          Neu
        </button>
      </div>
      )}

      {connectedHere && (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
            Verbunden mit {status.user}@{status.host}
          </span>
          <Input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            onBlur={saveDir}
            aria-label="Ordner auf dem Server"
            className="h-8 w-36 font-mono text-[12px]"
            spellCheck={false}
          />
          <Button type="button" size="sm" variant="danger" onClick={() => void disconnect()}>
            Trennen
          </Button>
        </div>
      )}

      {status.needsOtp && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (otp.trim()) void sendOtp();
          }}
        >
          <p className="text-[12px] text-muted">Der Server verlangt einen 2FA-Code.</p>
          <Input
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="2FA-Code"
            aria-label="2FA-Code"
            autoComplete="one-time-code"
            inputMode="numeric"
            spellCheck={false}
            autoFocus
          />
          <Button type="submit" size="sm" variant="primary" disabled={!otp.trim()}>
            Senden
          </Button>
        </form>
      )}

      {showForm && !status.needsOtp && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!submitting && !status.connecting && loginReady && passwordReady && !status.connected)
              void connect();
          }}
        >
          <Input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="user@IP"
            aria-label="user@IP"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-[13px]"
          />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={saveLogin && selected?.hasPassword ? "gespeichert" : "Passwort"}
            aria-label="Passwort"
            autoComplete="current-password"
          />
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={saveLogin}
              onChange={(e) => setSaveLogin(e.target.checked)}
              className="size-3.5 accent-[var(--accent)]"
            />
            IP und Passwort speichern
          </label>
          <p className="text-[11px] text-faint">Anmeldung über ssh. Ein 2FA-Code wird erst abgefragt, wenn der Server ihn verlangt.</p>
          {status.connected && (
            <p className="text-[12px] text-muted">Zuerst die bestehende Verbindung trennen.</p>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              loading={submitting || status.connecting}
              disabled={!loginReady || !passwordReady || status.connected}
            >
              Verbinden
            </Button>
            {status.connected && (
              <Button type="button" size="sm" variant="danger" onClick={() => void disconnect()}>
                Trennen
              </Button>
            )}
          </div>
          {status.error && <p className="text-[12px] text-danger">{status.error}</p>}
        </form>
      )}
    </div>
  );
}
