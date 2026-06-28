"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "./Shell";
import SetupScreen from "./SetupScreen";
import { Spinner } from "./ui";

export default function AppGate() {
  const [ready, setReady] = useState<boolean | null>(null);

  const check = useCallback(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((c: { ready?: boolean }) => setReady(Boolean(c.ready)))
      .catch(() => setReady(false));
  }, []);

  useEffect(() => check(), [check]);

  if (ready === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  return ready ? <Shell /> : <SetupScreen onReady={check} />;
}
