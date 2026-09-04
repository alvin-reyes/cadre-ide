/**
 * viewerKind.test.ts — TDD for the pure viewer-dispatch module.
 *
 * Covers:
 *   - viewerKind: every supported extension, case-insensitivity, and the
 *     "text" fallback that preserves today's Monaco behaviour
 *   - .doc deliberately falling through to "text" (mammoth cannot read the
 *     legacy binary format; routing it to the docx viewer would surface an
 *     error that looks like a bug)
 *   - fileExt edge cases: dotfiles, no extension, a dot in a parent directory
 *   - imageMime: mapped types and the octet-stream fallback
 */
import { describe, it, expect } from "vitest";
import { fileExt, viewerKind, imageMime } from "./viewerKind";

describe("fileExt", () => {
  it("returns the lowercased extension", () => {
    expect(fileExt("/a/b/report.PDF")).toBe("pdf");
    expect(fileExt("notes.md")).toBe("md");
  });

  it("returns empty for a file with no extension", () => {
    expect(fileExt("/a/b/README")).toBe("");
  });

  it("treats a dotfile as having no extension", () => {
    expect(fileExt("/a/.gitignore")).toBe("");
  });

  it("ignores dots in parent directories", () => {
    expect(fileExt("/a.b/README")).toBe("");
    expect(fileExt("/a.b/notes.md")).toBe("md");
  });
});

describe("viewerKind", () => {
  it("routes PDFs", () => {
    expect(viewerKind("spec.pdf")).toBe("pdf");
    expect(viewerKind("SPEC.PDF")).toBe("pdf");
  });

  it("routes Markdown", () => {
    expect(viewerKind("readme.md")).toBe("markdown");
    expect(viewerKind("readme.markdown")).toBe("markdown");
  });

  it("routes docx", () => {
    expect(viewerKind("brief.docx")).toBe("docx");
  });

  it("routes images", () => {
    for (const p of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.svg", "a.webp", "a.bmp", "a.ico"]) {
      expect(viewerKind(p)).toBe("image");
    }
  });

  it("falls back to text for source files, so Monaco keeps them", () => {
    expect(viewerKind("src/main.tsx")).toBe("text");
    expect(viewerKind("Cargo.toml")).toBe("text");
    expect(viewerKind("/a/README")).toBe("text");
  });

  it("sends legacy .doc to text, not the docx viewer", () => {
    expect(viewerKind("old.doc")).toBe("text");
  });
});

describe("imageMime", () => {
  it("maps known image extensions", () => {
    expect(imageMime("a.png")).toBe("image/png");
    expect(imageMime("a.jpg")).toBe("image/jpeg");
    expect(imageMime("a.jpeg")).toBe("image/jpeg");
    expect(imageMime("a.svg")).toBe("image/svg+xml");
    expect(imageMime("a.ico")).toBe("image/x-icon");
  });

  it("falls back to octet-stream", () => {
    expect(imageMime("a.txt")).toBe("application/octet-stream");
  });
});
