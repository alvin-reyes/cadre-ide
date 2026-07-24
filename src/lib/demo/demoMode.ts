/**
 * demoMode.ts — Demo mode flag and entry point.
 *
 * isDemoMode()    → read the current flag
 * setDemoMode(on) → set the flag
 * enterDemoMode() → TODO(Task 4): install backend, seed the project, navigate
 */

// Module-level flag (in-memory for this session)
let _demoMode = false;

/** Returns true when running in browser demo mode (not real Tauri). */
export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  // Check module flag, URL param, or localStorage marker
  if (_demoMode) return true;
  if (typeof URLSearchParams !== "undefined") {
    const params = new URLSearchParams(
      typeof window.location !== "undefined" ? window.location.search : ""
    );
    if (params.get("demo") === "1") return true;
  }
  if (typeof localStorage !== "undefined") {
    if (localStorage.getItem("cadre-demo") === "1") return true;
  }
  return false;
}

/** Explicitly set or clear demo mode. */
export function setDemoMode(on: boolean): void {
  _demoMode = on;
  if (typeof localStorage !== "undefined") {
    if (on) {
      localStorage.setItem("cadre-demo", "1");
    } else {
      localStorage.removeItem("cadre-demo");
    }
  }
}

/**
 * Enter demo mode: install the mock backend, seed the demo project, and
 * navigate the app into the seeded state.
 *
 * TODO(Task 4): implement seeding (demoContent), installMockBackend, and
 * navigation into the demo project. Leave this stub resolving so callers
 * can call it now and have the module load without errors.
 */
export async function enterDemoMode(): Promise<void> {
  setDemoMode(true);
  // TODO(Task 4): install mock backend + seed project + navigate
}
