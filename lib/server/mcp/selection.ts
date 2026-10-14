/** The cloned repo the GitHub launcher tools act on, until another select. */
export interface SelectedRepo {
  fullName: string;
  name: string;
  localPath: string;
}

const g = globalThis as unknown as { __cccMcpRepo?: SelectedRepo | null };

export function rememberRepo(repo: SelectedRepo): void {
  g.__cccMcpRepo = repo;
}

export function rememberedRepo(): SelectedRepo | null {
  return g.__cccMcpRepo ?? null;
}

/** Test hook. */
export function resetRememberedRepo(): void {
  g.__cccMcpRepo = null;
}
