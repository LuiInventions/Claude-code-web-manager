import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchReadable } from "../server/web";

function mockFetch(body: string, init: { status?: number; contentType?: string } = {}) {
  const res = {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: { get: () => init.contentType ?? "text/html" },
    text: async () => body,
  };
  vi.stubGlobal("fetch", vi.fn(async () => res as unknown as Response));
}

afterEach(() => vi.unstubAllGlobals());

const ARTICLE = `<!doctype html><html><head><title>Mein Titel</title></head>
<body><nav>Menü Home About</nav><article><h1>Schlagzeile</h1>
<p>Dies ist ein ausreichend langer Absatz mit echtem Inhalt, den Readability als
Hauptinhalt der Seite erkennen sollte, weil er substanziell genug ist.</p>
<p>Noch ein inhaltsreicher Absatz, damit der Artikel als lesbar gilt.</p></article>
<footer>Impressum</footer></body></html>`;

describe("fetchReadable", () => {
  it("extrahiert Titel und lesbaren Text", async () => {
    mockFetch(ARTICLE);
    const page = await fetchReadable("https://example.com/post");
    expect(page.url).toBe("https://example.com/post");
    expect(page.title).toContain("Titel");
    expect(page.text).toContain("inhaltsreicher Absatz");
    expect(page.text).not.toContain("Impressum");
  });

  it("lehnt nicht-http(s)-URLs ab", async () => {
    await expect(fetchReadable("file:///etc/passwd")).rejects.toThrow();
  });

  it("wirft bei non-2xx", async () => {
    mockFetch("nope", { status: 404 });
    await expect(fetchReadable("https://example.com/x")).rejects.toThrow();
  });

  it("kappt sehr langen Text", async () => {
    const huge = "<html><body><article>" + "<p>wort wort wort wort wort.</p>".repeat(5000) + "</article></body></html>";
    mockFetch(huge);
    const page = await fetchReadable("https://example.com/huge");
    expect(page.text.length).toBeLessThanOrEqual(12_050);
  });

  it("fällt auf Body-Text zurück, wenn Readability nichts findet", async () => {
    mockFetch("<html><body>Nur etwas nackter Text ohne Artikelstruktur.</body></html>");
    const page = await fetchReadable("https://example.com/bare");
    expect(page.text).toContain("nackter Text");
  });
});
