/**
 * Best-effort detection of a project's test/verify command from its manifest
 * files, so brownfield sign-off can pre-fill the real gate instead of guessing.
 * Pure — takes file contents (or undefined if absent) and returns a command.
 */
export interface ManifestFiles {
  packageJson?: string;
  cargoToml?: string;
  goMod?: string;
  pyproject?: string;
  makefile?: string;
  /** presence of these lockfiles hints the JS package manager */
  pnpmLock?: boolean;
  yarnLock?: boolean;
  bunLock?: boolean;
}

function jsRunner(f: ManifestFiles): string {
  if (f.pnpmLock) return "pnpm";
  if (f.yarnLock) return "yarn";
  if (f.bunLock) return "bun";
  return "npm";
}

export function detectVerifyCommand(f: ManifestFiles): string | null {
  if (f.packageJson) {
    try {
      const pkg = JSON.parse(f.packageJson) as { scripts?: Record<string, string> };
      if (pkg.scripts?.test) {
        const runner = jsRunner(f);
        return runner === "npm" ? "npm test" : `${runner} test`;
      }
    } catch {
      /* malformed package.json — fall through */
    }
  }
  if (f.cargoToml) return "cargo test";
  if (f.goMod) return "go test ./...";
  if (f.pyproject) return "pytest";
  if (f.makefile && /^test:/m.test(f.makefile)) return "make test";
  return null;
}
