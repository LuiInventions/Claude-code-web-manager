export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0e14",
        color: "#e6e6e6",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>404 — nicht gefunden</h1>
        <p style={{ fontSize: 14, opacity: 0.7 }}>Diese Seite existiert nicht.</p>
      </div>
    </div>
  );
}
