"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, X } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { Button, cn } from "../ui";

export function CenterDialog({
  title,
  subtitle,
  busy,
  onClose,
  children,
  solid = false,
  plain = false,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  busy?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Solid fill. Upload dialogs use this so the box is not glass. */
  solid?: boolean;
  /** Flat theme surface. The image dialog uses this. */
  plain?: boolean;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-6"
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
        tabIndex={-1}
        className={cn(
          "relative max-h-[92vh] w-full overflow-y-auto p-6 outline-none",
          wide ? "max-w-3xl" : "max-w-lg",
          plain
            ? "rounded-xl border border-line bg-surface shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
            : "rounded-2xl border-2",
          !plain &&
            (solid
              ? "border-[#7c5cff] bg-[#1a1030] shadow-[0_24px_70px_rgba(0,0,0,0.55)]"
              : "glass-pane border"),
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="transfer-title" className="text-sm font-semibold text-ink">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 truncate font-mono text-[11px] text-faint" title={subtitle}>
                {subtitle}
              </p>
            )}
          </div>
          {!busy && (
            <button
              type="button"
              aria-label="Schliessen"
              onClick={onClose}
              className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-faint hover:text-ink"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function TransferProgress({
  label,
  written,
  total,
  detail,
}: {
  label: string;
  written: number;
  total: number;
  detail?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((written / total) * 100)) : 0;
  return (
    <div className="grid justify-items-center gap-4 py-6 text-center" aria-live="polite">
      {total > 0 ? (
        <p className="text-5xl font-semibold tabular-nums tracking-tight text-ink">{pct}%</p>
      ) : (
        <Loader2 className="size-10 animate-spin text-accent motion-reduce:animate-none" />
      )}
      <div className="max-w-full">
        <p className="text-sm font-medium text-ink">{label}</p>
        {detail && <p className="mt-1 truncate text-xs text-muted">{detail}</p>}
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-150 motion-reduce:transition-none"
          style={{ width: `${total > 0 ? pct : 8}%` }}
        />
      </div>
      <p className="text-xs text-faint">
        {total > 0 ? `${formatBytes(written)} / ${formatBytes(total)}` : "Wird vorbereitet…"}
      </p>
    </div>
  );
}

export function TransferSuccess({
  title,
  summary,
  onClose,
  onOpen,
}: {
  title: string;
  summary: string;
  onClose: () => void;
  onOpen?: () => void;
}) {
  return (
    <div className="grid justify-items-center gap-3 py-6 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-running/15 text-running">
        <Check className="size-8" />
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="text-xs text-muted">{summary}</p>
      <div className="mt-2 flex gap-2">
        {onOpen && (
          <Button type="button" variant="secondary" onClick={onOpen}>
            Ordner öffnen
          </Button>
        )}
        <Button type="button" variant="primary" onClick={onClose}>
          Schliessen
        </Button>
      </div>
    </div>
  );
}
