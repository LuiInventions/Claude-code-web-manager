"use client";

import { useCallback, useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { Button } from "../ui";
import { useAppCommands } from "../app-commands";
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
  codiumReady: false,
  codiumUrl: "",
  needsOtp: false,
  codiumError: "",
};

/**
 * VS Codium on the user's own server. Login lives in the launcher under
 * Remote. This tab only embeds the editor once that ssh session is up.
 */
export default function RemoteCodiumSection() {
  const { navigate } = useAppCommands();
  const [status, setStatus] = useState<RemotePublicStatus>(EMPTY);
  const [reload, setReload] = useState(0);

  const load = useCallback(() => {
    fetch("/api/remote")
      .then((r) => r.json())
      .then((d: RemotePublicStatus) => setStatus(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  const retry = () => {
    void fetch("/api/remote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "codium" }),
    }).then(() => load());
  };

  const disconnect = () => {
    void fetch("/api/remote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "disconnect" }),
    }).then(() => load());
  };

  if (!status.connected) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="max-w-md space-y-3 text-center">
          <Monitor className="mx-auto size-8 text-faint" />
          <h2 className="text-sm font-semibold text-ink">VS Codium</h2>
          <p className="text-sm text-muted">
            Nicht mit dem Server verbunden. Die Anmeldung mit user@IP und Passwort
            liegt im Launcher unter Remote.
          </p>
          <Button variant="primary" onClick={() => navigate("launcher")}>
            Zum Launcher
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 py-2">
        <div className="mr-auto min-w-0">
          <h2 className="text-sm font-semibold text-ink">VS Codium</h2>
          <p className="truncate text-[11px] text-faint">
            {status.user}@{status.host}
          </p>
        </div>
        {status.codiumUrl && (
          <Button size="sm" onClick={() => setReload((n) => n + 1)}>
            Neu laden
          </Button>
        )}
        {!status.codiumReady && (
          <Button size="sm" onClick={retry}>
            Erneut versuchen
          </Button>
        )}
        <Button size="sm" variant="danger" onClick={disconnect}>
          Trennen
        </Button>
      </header>
      {status.codiumUrl ? (
        <iframe
          key={`${status.codiumUrl}:${reload}`}
          title="VS Codium"
          src={status.codiumUrl}
          className="min-h-0 w-full flex-1 border-0 bg-surface"
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write"
        />
      ) : (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div className="max-w-md space-y-2">
            <p className="text-sm text-muted">
              {status.codiumError || "VS Codium startet auf dem Server…"}
            </p>
            <p className="text-xs text-faint">
              Auf dem Server werden `codium` oder `code serve-web` erwartet.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
