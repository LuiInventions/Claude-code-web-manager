"use client";

import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

/** Minimal className joiner (no dependency). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ----------------------------------------------------------------- Button */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-50";
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary:
    "border border-line bg-raised text-ink hover:bg-selected hover:border-line-strong",
  ghost: "text-muted hover:bg-raised hover:text-ink",
  danger: "bg-danger text-white hover:bg-danger-hover",
};
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-4 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  loading,
  className,
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
}) {
  return (
    <button
      className={cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : Icon ? (
        <Icon className="size-4" />
      ) : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors cursor-pointer hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      <Icon className="size-4" />
    </button>
  );
}

/* ------------------------------------------------------------------- Card */
export function Card({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-line bg-surface", className)}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ Badge */
type Tone = "neutral" | "running" | "accent" | "warn" | "danger" | "info";
const PILL_TONE: Record<Tone, string> = {
  neutral: "border-line bg-raised text-muted",
  running: "border-running/30 bg-running/10 text-running",
  accent: "border-accent/30 bg-accent/10 text-accent",
  warn: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-danger/30 bg-danger/10 text-danger",
  info: "border-info/30 bg-info/10 text-info",
};

export function Badge({
  tone = "neutral",
  dot,
  pulse,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        PILL_TONE[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={cn("size-1.5 rounded-full bg-current", pulse && "dot-running")}
        />
      )}
      {children}
    </span>
  );
}

/* --------------------------------------------------------- Input / Textarea */
export function Input({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-line bg-raised px-3 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-accent",
        className,
      )}
      {...rest}
    />
  );
}

export function Textarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-accent",
        className,
      )}
      {...rest}
    />
  );
}

/* ---------------------------------------------------------------- Spinner */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted", className)} />;
}

/* ------------------------------------------------------------- EmptyState */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl border border-line bg-surface text-faint">
        <Icon className="size-6" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
