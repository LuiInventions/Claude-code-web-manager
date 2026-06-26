import { describe, it, expect } from "vitest";
import {
  summarizeBots,
  botSummaryToMarkdown,
  botSummaryToSpeech,
  dedupeBotRuns,
  type BotRun,
} from "../bot-summary";

function run(partial: Partial<BotRun> & { id: string }): BotRun {
  return {
    projectName: "proj",
    prompt: "tu was",
    status: "done",
    startedAt: 1000,
    ...partial,
  };
}

describe("summarizeBots", () => {
  it("nummeriert Instanzen chronologisch (frühester Start = Instanz 1)", () => {
    const s = summarizeBots(
      [
        run({ id: "b", startedAt: 2000 }),
        run({ id: "a", startedAt: 1000 }),
        run({ id: "c", startedAt: 3000 }),
      ],
      9999,
    );
    expect(s.done.map((t) => [t.id, t.instance])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(s.instances).toEqual([1, 2, 3]);
    expect(s.total).toBe(3);
    expect(s.generatedAt).toBe(9999);
  });

  it("bricht gleiche Startzeiten stabil über die id", () => {
    const s = summarizeBots(
      [run({ id: "z", startedAt: 1000 }), run({ id: "a", startedAt: 1000 })],
      0,
    );
    expect(s.done.map((t) => t.id)).toEqual(["a", "z"]);
  });

  it("verteilt Status auf erledigt / in Arbeit / offen", () => {
    const s = summarizeBots(
      [
        run({ id: "1", status: "done", startedAt: 1 }),
        run({ id: "2", status: "running", startedAt: 2 }),
        run({ id: "3", status: "error", startedAt: 3 }),
        run({ id: "4", status: "stopped", startedAt: 4 }),
      ],
      0,
    );
    expect(s.done.map((t) => t.instance)).toEqual([1]);
    expect(s.inProgress.map((t) => t.instance)).toEqual([2]);
    expect(s.open.map((t) => t.instance)).toEqual([3, 4]);
  });

  it("liefert leere Buckets ohne Bots", () => {
    const s = summarizeBots([], 5);
    expect(s.done).toEqual([]);
    expect(s.inProgress).toEqual([]);
    expect(s.open).toEqual([]);
    expect(s.instances).toEqual([]);
    expect(s.total).toBe(0);
    expect(s.generatedAt).toBe(5);
  });
});

describe("dedupeBotRuns", () => {
  it("entfernt doppelte ids und bevorzugt den ersten Eintrag (live vor Historie)", () => {
    const live = run({ id: "x", status: "running", prompt: "live" });
    const persisted = run({ id: "x", status: "done", prompt: "alt" });
    const out = dedupeBotRuns([live, persisted]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "x", status: "running", prompt: "live" });
  });

  it("behält verschiedene ids", () => {
    const out = dedupeBotRuns([run({ id: "a" }), run({ id: "b" })]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("botSummaryToMarkdown", () => {
  it("listet jede Instanz mit Nummer, Projekt und Prompt unter der richtigen Überschrift", () => {
    const md = botSummaryToMarkdown(
      summarizeBots(
        [
          run({ id: "1", status: "done", projectName: "alpha", prompt: "tests schreiben", startedAt: 1 }),
          run({ id: "2", status: "running", projectName: "beta", prompt: "api bauen", startedAt: 2 }),
          run({ id: "3", status: "error", projectName: "gamma", prompt: "bug fixen", startedAt: 3 }),
        ],
        0,
      ),
    );
    expect(md).toContain("# Bot-Übersicht");
    expect(md).toContain("## Erledigt");
    expect(md).toContain("## In Arbeit");
    expect(md).toContain("## Offen");
    expect(md).toMatch(/Instanz 1.*alpha.*tests schreiben/);
    expect(md).toMatch(/Instanz 2.*beta.*api bauen/);
    expect(md).toMatch(/Instanz 3.*gamma.*bug fixen/);
    // Offen nennt den Grund
    expect(md).toMatch(/Instanz 3[\s\S]*Fehler/);
  });

  it("kennzeichnet gestoppte Bots als gestoppt", () => {
    const md = botSummaryToMarkdown(
      summarizeBots([run({ id: "1", status: "stopped", startedAt: 1 })], 0),
    );
    expect(md).toMatch(/gestoppt/i);
  });

  it("zeigt eine Zusammenfassungszeile mit Zählern", () => {
    const md = botSummaryToMarkdown(
      summarizeBots(
        [
          run({ id: "1", status: "done", startedAt: 1 }),
          run({ id: "2", status: "running", startedAt: 2 }),
        ],
        0,
      ),
    );
    expect(md).toMatch(/1 erledigt/);
    expect(md).toMatch(/1 in Arbeit/);
    expect(md).toMatch(/0 offen/);
  });

  it("beschriftet leere Aufträge als interaktiv", () => {
    const md = botSummaryToMarkdown(
      summarizeBots([run({ id: "1", status: "running", prompt: "", startedAt: 1 })], 0),
    );
    expect(md).toMatch(/interaktiv/i);
  });

  it("meldet sauber, wenn keine Bots aktiv sind", () => {
    const md = botSummaryToMarkdown(summarizeBots([], 0));
    expect(md).toContain("# Bot-Übersicht");
    expect(md).toMatch(/keine Bots/i);
  });
});

describe("botSummaryToSpeech", () => {
  it("formuliert einen kurzen deutschen Satz mit den Zählern", () => {
    const text = botSummaryToSpeech(
      summarizeBots(
        [
          run({ id: "1", status: "done", startedAt: 1 }),
          run({ id: "2", status: "done", startedAt: 2 }),
          run({ id: "3", status: "running", startedAt: 3 }),
          run({ id: "4", status: "error", startedAt: 4 }),
        ],
        0,
      ),
    );
    expect(text).toMatch(/2/);
    expect(text).toMatch(/erledigt/i);
    expect(text).not.toMatch(/[#*_]/); // keine Markdown-Zeichen für TTS
  });

  it("nutzt Singular bei genau einer Aufgabe", () => {
    const text = botSummaryToSpeech(
      summarizeBots([run({ id: "1", status: "done", startedAt: 1 })], 0),
    );
    expect(text).toMatch(/eine Aufgabe|1 Aufgabe/i);
  });

  it("sagt klar an, wenn es nichts zu berichten gibt", () => {
    const text = botSummaryToSpeech(summarizeBots([], 0));
    expect(text).toMatch(/keine/i);
    expect(text).not.toMatch(/[#*_]/);
  });
});
