"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          margin: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0e14",
          color: "#e6e6e6",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 480, padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Etwas ist schiefgelaufen</h1>
          <p style={{ fontSize: 14, opacity: 0.7 }}>{error.message}</p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 16,
              cursor: "pointer",
              borderRadius: 6,
              border: "1px solid #2a2f3a",
              background: "#161b22",
              color: "#e6e6e6",
              padding: "8px 16px",
              fontSize: 14,
            }}
          >
            Neu laden
          </button>
        </div>
      </body>
    </html>
  );
}
