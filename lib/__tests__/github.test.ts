import { describe, it, expect, vi, afterEach } from "vitest";
import { parseRepo, parseNextPageUrl, listRepos } from "../github";

describe("parseRepo", () => {
  it("maps the GitHub API shape to GithubRepo", () => {
    const raw = {
      name: "demo",
      full_name: "octocat/demo",
      clone_url: "https://github.com/octocat/demo.git",
      private: true,
      description: "hi",
      default_branch: "main",
      updated_at: "2026-06-01T00:00:00Z",
      extra: "ignored",
    };
    expect(parseRepo(raw)).toEqual({
      name: "demo",
      fullName: "octocat/demo",
      cloneUrl: "https://github.com/octocat/demo.git",
      private: true,
      description: "hi",
      defaultBranch: "main",
      updatedAt: "2026-06-01T00:00:00Z",
    });
  });
});

describe("parseNextPageUrl", () => {
  it("extracts the rel=next url", () => {
    const link =
      '<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=5>; rel="last"';
    expect(parseNextPageUrl(link)).toBe("https://api.github.com/user/repos?page=2");
  });
  it("returns null when there is no next page", () => {
    expect(parseNextPageUrl('<...>; rel="last"')).toBeNull();
    expect(parseNextPageUrl(null)).toBeNull();
  });
});

describe("listRepos", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("follows pagination via the Link header", async () => {
    const page1 = {
      ok: true,
      status: 200,
      headers: new Headers({
        link: '<https://api.github.com/user/repos?page=2>; rel="next"',
      }),
      json: async () => [
        {
          name: "a",
          full_name: "u/a",
          clone_url: "https://github.com/u/a.git",
          private: false,
          description: null,
          default_branch: "main",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    };
    const page2 = {
      ok: true,
      status: 200,
      headers: new Headers({}),
      json: async () => [
        {
          name: "b",
          full_name: "u/b",
          clone_url: "https://github.com/u/b.git",
          private: true,
          description: "x",
          default_branch: "dev",
          updated_at: "2026-02-01T00:00:00Z",
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    vi.stubGlobal("fetch", fetchMock);

    const repos = await listRepos("tok");
    expect(repos.map((r) => r.name)).toEqual(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
