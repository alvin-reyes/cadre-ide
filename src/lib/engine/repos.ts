export interface RepoRef { id: string; name: string; path: string; verify?: string }
export const DEFAULT_REPO_ID = "main";

export function parseRepos(manifestJson: string): RepoRef[] {
  let manifest: { name?: string; repos?: unknown } = {};
  try { manifest = JSON.parse(manifestJson) ?? {}; } catch { /* fall through to default */ }
  const name = typeof manifest.name === "string" && manifest.name ? manifest.name : DEFAULT_REPO_ID;
  const raw = Array.isArray(manifest.repos) ? manifest.repos : [];
  const repos: RepoRef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.path !== "string") continue;
    repos.push({
      id: o.id,
      name: typeof o.name === "string" && o.name ? o.name : o.id,
      path: o.path,
      ...(typeof o.verify === "string" && o.verify ? { verify: o.verify } : {}),
    });
  }
  return repos.length > 0 ? repos : [{ id: DEFAULT_REPO_ID, name, path: "." }];
}

export function resolveRepoPath(projectRoot: string, path: string): string {
  if (path === "." || path === "") return projectRoot;
  if (path.startsWith("/")) return path;
  // POSIX join + normalize (../, ./) — the app runs on macOS/Linux paths.
  const parts = `${projectRoot}/${path}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return "/" + out.join("/");
}

export function repoWorktreePath(projectRoot: string, repoId: string, epic: number, story: number): string {
  return `${projectRoot}/.cadre/worktrees/${repoId}/${epic}.${story}`;
}

export function findRepo(repos: RepoRef[], id: string): RepoRef {
  return repos.find((r) => r.id === id) ?? repos[0] ?? { id: DEFAULT_REPO_ID, name: DEFAULT_REPO_ID, path: "." };
}
