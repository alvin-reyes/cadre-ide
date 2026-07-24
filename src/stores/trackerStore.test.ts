import { describe, it, expect } from "vitest";
import { parseRepoFromRemote } from "./trackerStore";

describe("parseRepoFromRemote", () => {
  // ── SSH form ────────────────────────────────────────────────────────────────

  it("parses SSH URL with .git suffix", () => {
    expect(parseRepoFromRemote("git@github.com:owner/repo.git")).toBe(
      "owner/repo"
    );
  });

  it("parses SSH URL without .git suffix", () => {
    expect(parseRepoFromRemote("git@github.com:owner/repo")).toBe("owner/repo");
  });

  it("preserves org/repo casing in SSH form", () => {
    expect(parseRepoFromRemote("git@github.com:MyOrg/MyRepo.git")).toBe(
      "MyOrg/MyRepo"
    );
  });

  // ── HTTPS form ──────────────────────────────────────────────────────────────

  it("parses HTTPS URL with .git suffix", () => {
    expect(
      parseRepoFromRemote("https://github.com/owner/repo.git")
    ).toBe("owner/repo");
  });

  it("parses HTTPS URL without .git suffix", () => {
    expect(
      parseRepoFromRemote("https://github.com/owner/repo")
    ).toBe("owner/repo");
  });

  it("parses HTTP (non-TLS) HTTPS URL", () => {
    expect(
      parseRepoFromRemote("http://github.com/owner/repo.git")
    ).toBe("owner/repo");
  });

  // ── Non-GitHub / unparseable ────────────────────────────────────────────────

  it("returns null for a GitLab SSH URL", () => {
    expect(parseRepoFromRemote("git@gitlab.com:owner/repo.git")).toBeNull();
  });

  it("returns null for a GitLab HTTPS URL", () => {
    expect(
      parseRepoFromRemote("https://gitlab.com/owner/repo.git")
    ).toBeNull();
  });

  it("returns null for a Bitbucket URL", () => {
    expect(
      parseRepoFromRemote("https://bitbucket.org/owner/repo.git")
    ).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseRepoFromRemote("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(parseRepoFromRemote("   ")).toBeNull();
  });

  it("returns null for a completely unrecognised string", () => {
    expect(parseRepoFromRemote("not-a-url")).toBeNull();
  });
});
