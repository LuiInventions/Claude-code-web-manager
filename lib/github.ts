/**
 * Minimal GitHub REST client. Pure mappers (parseRepo, parseNextPageUrl) are
 * unit-tested; validateToken/listRepos hit the network and are kept thin.
 */
const API = "https://api.github.com";

export interface GithubRepo {
  name: string;
  fullName: string;
  cloneUrl: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  updatedAt: string;
}

export interface GithubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "jarvis-control-center",
  };
}

export function parseRepo(raw: unknown): GithubRepo {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    name: String(o.name ?? ""),
    fullName: String(o.full_name ?? ""),
    cloneUrl: String(o.clone_url ?? ""),
    private: Boolean(o.private),
    description: typeof o.description === "string" ? o.description : null,
    defaultBranch: String(o.default_branch ?? "main"),
    updatedAt: String(o.updated_at ?? ""),
  };
}

export function parseNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

export async function validateToken(token: string): Promise<GithubUser> {
  const res = await fetch(`${API}/user`, { headers: headers(token) });
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? "Token ungültig oder abgelaufen."
        : `GitHub-Fehler (${res.status}).`,
    );
  }
  const o = (await res.json()) as Record<string, unknown>;
  return {
    login: String(o.login ?? ""),
    name: typeof o.name === "string" ? o.name : null,
    avatarUrl: String(o.avatar_url ?? ""),
  };
}

/** Extract the best human-readable message from a GitHub error response. */
async function githubErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const e = (await res.json()) as {
      message?: string;
      errors?: Array<{ message?: string }>;
    };
    const detail = e.errors?.map((x) => x.message).filter(Boolean).join(", ");
    if (e.message) return detail ? `${e.message} (${detail})` : e.message;
  } catch {
    /* non-JSON body */
  }
  return fallback;
}

/** Create a new repository under the authenticated user's account. */
export async function createRepo(
  token: string,
  name: string,
  isPrivate: boolean,
): Promise<GithubRepo> {
  const res = await fetch(`${API}/user/repos`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name, private: isPrivate, auto_init: false }),
  });
  if (!res.ok) {
    throw new Error(
      await githubErrorMessage(res, `Repo konnte nicht erstellt werden (${res.status}).`),
    );
  }
  return parseRepo(await res.json());
}

/** Flip a repository between public and private. `fullName` is "owner/repo". */
export async function setRepoVisibility(
  token: string,
  fullName: string,
  isPrivate: boolean,
): Promise<GithubRepo> {
  const res = await fetch(`${API}/repos/${fullName}`, {
    method: "PATCH",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ private: isPrivate }),
  });
  if (!res.ok) {
    throw new Error(
      await githubErrorMessage(res, `Sichtbarkeit konnte nicht geändert werden (${res.status}).`),
    );
  }
  return parseRepo(await res.json());
}

export async function listRepos(token: string): Promise<GithubRepo[]> {
  const out: GithubRepo[] = [];
  let url: string | null =
    `${API}/user/repos?per_page=100&affiliation=owner,collaborator&sort=updated`;
  while (url) {
    const res: Response = await fetch(url, { headers: headers(token) });
    if (!res.ok) throw new Error(`GitHub-Fehler beim Laden der Repos (${res.status}).`);
    const batch = (await res.json()) as unknown[];
    for (const r of batch) out.push(parseRepo(r));
    url = parseNextPageUrl(res.headers.get("link"));
  }
  return out;
}
