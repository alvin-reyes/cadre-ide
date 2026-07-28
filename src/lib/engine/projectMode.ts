export type ProjectMode = "build" | "maintain";

/**
 * Resolve a project's working mode. A repo that already carries greenfield plan
 * artifacts (a PRD, or sharded stories) is a Build project being resumed; a repo
 * with neither is an existing app opened for Maintenance/Support work.
 */
export function detectProjectMode(input: { hasPrd: boolean; hasStories: boolean }): ProjectMode {
  return input.hasPrd || input.hasStories ? "build" : "maintain";
}
