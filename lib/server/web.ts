import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

export interface ReadablePage {
  url: string;
  title: string;
  text: string;
}

const TIMEOUT_MS = 12_000;
const MAX_HTML = 2_000_000; // ~2 MB Roh-HTML
const MAX_TEXT = 12_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/** Lädt eine URL und extrahiert ihren lesbaren Hauptinhalt als Text. */
export async function fetchReadable(url: string): Promise<ReadablePage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Ungültige URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Nur http(s) erlaubt: ${url}`);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let html: string;
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": UA, accept: "text/html,*/*" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
    const raw = await res.text();
    html = raw.length > MAX_HTML ? raw.slice(0, MAX_HTML) : raw;
  } catch (e) {
    throw new Error(`Konnte ${url} nicht laden: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  const { document } = parseHTML(html);
  let title = document.title?.trim() ?? "";
  let text = "";
  try {
    const article = new Readability(document).parse();
    if (article) {
      title = (article.title || title).trim();
      text = (article.textContent || "").trim();
    }
  } catch {
    /* fällt unten auf Body-Text zurück */
  }
  if (!text) {
    text = (document.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  if (!text) throw new Error(`Kein lesbarer Inhalt auf ${url}`);
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + "\n…[gekürzt]";

  return { url, title, text };
}
