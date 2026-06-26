"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Lightweight Markdown renderer for review reports. No typography plugin in this
 * project, so basic elements are styled inline with the app's design tokens.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-muted">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mb-1 mt-3 text-base font-semibold text-ink" {...p} />,
          h2: (p) => <h2 className="mb-1 mt-3 text-sm font-semibold text-accent" {...p} />,
          h3: (p) => <h3 className="mb-1 mt-2 text-sm font-medium text-ink" {...p} />,
          p: (p) => <p className="text-muted" {...p} />,
          ul: (p) => <ul className="ml-4 list-disc space-y-0.5" {...p} />,
          ol: (p) => <ol className="ml-4 list-decimal space-y-0.5" {...p} />,
          li: (p) => <li className="text-muted" {...p} />,
          strong: (p) => <strong className="text-ink" {...p} />,
          a: (p) => <a className="text-accent underline" {...p} />,
          code: (p) => (
            <code className="rounded bg-raised px-1 py-0.5 font-mono text-[12px] text-ink" {...p} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
