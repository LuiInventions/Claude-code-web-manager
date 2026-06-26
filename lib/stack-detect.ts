/**
 * Stack/language detection from a project's top-level file names.
 * `detectStackFromFiles` is pure (unit-tested); framework enrichment reads a
 * parsed package.json (also pure given the parsed object).
 */

export interface StackResult {
  primary: string;
  tags: string[];
}

type Has = (name: string) => boolean;
type HasExt = (ext: string) => boolean;

interface Rule {
  test: (has: Has, hasExt: HasExt) => boolean;
  primary: string;
  tag: string;
}

// First matching rule (in order) wins `primary`; every match contributes a tag.
const RULES: Rule[] = [
  { test: (h) => h("cargo.toml"), primary: "Rust", tag: "Rust" },
  { test: (h) => h("go.mod"), primary: "Go", tag: "Go" },
  { test: (_h, e) => e(".csproj") || e(".sln"), primary: ".NET", tag: ".NET" },
  {
    test: (h) => h("pom.xml") || h("build.gradle") || h("build.gradle.kts"),
    primary: "JVM",
    tag: "JVM",
  },
  { test: (h) => h("pubspec.yaml"), primary: "Flutter", tag: "Flutter" },
  {
    test: (h) =>
      h("requirements.txt") ||
      h("pyproject.toml") ||
      h("setup.py") ||
      h("pipfile"),
    primary: "Python",
    tag: "Python",
  },
  { test: (h) => h("gemfile"), primary: "Ruby", tag: "Ruby" },
  { test: (h) => h("composer.json"), primary: "PHP", tag: "PHP" },
  { test: (h) => h("package.json"), primary: "Node.js", tag: "Node" },
];

export function detectStackFromFiles(files: string[]): StackResult {
  const set = new Set(files.map((f) => f.toLowerCase()));
  const has: Has = (name) => set.has(name.toLowerCase());
  const hasExt: HasExt = (ext) =>
    files.some((f) => f.toLowerCase().endsWith(ext.toLowerCase()));

  let primary = "Unknown";
  const tags: string[] = [];
  for (const rule of RULES) {
    if (rule.test(has, hasExt)) {
      if (primary === "Unknown") primary = rule.primary;
      tags.push(rule.tag);
    }
  }
  if (has("dockerfile")) tags.push("Docker");
  return { primary, tags: [...new Set(tags)] };
}

export function frameworksFromPackageJson(pkg: unknown): string[] {
  if (!pkg || typeof pkg !== "object") return [];
  const p = pkg as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) };
  const mapping: [string, string][] = [
    ["next", "Next.js"],
    ["nuxt", "Nuxt"],
    ["react-native", "React Native"],
    ["react", "React"],
    ["vue", "Vue"],
    ["svelte", "Svelte"],
    ["@angular/core", "Angular"],
    ["@nestjs/core", "NestJS"],
    ["express", "Express"],
    ["fastify", "Fastify"],
    ["electron", "Electron"],
    ["vite", "Vite"],
    ["astro", "Astro"],
    ["tailwindcss", "Tailwind"],
  ];
  const tags: string[] = [];
  for (const [dep, label] of mapping) if (deps[dep]) tags.push(label);
  return tags;
}
