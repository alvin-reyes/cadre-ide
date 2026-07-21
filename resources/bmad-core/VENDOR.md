# Vendored BMAD-METHOD (bmad-core)

This directory is a **pinned, unmodified copy** of the `bmad-core/` folder from the upstream
BMAD-METHOD project. Cadre uses it two ways (see the design spec, §3.3 and §7):

1. **Prompt engine** — `BmadAdapter` parses these personas / templates / tasks and composes them into
   the system prompts for the planning brain and the `claude -p` fleet agents. Cadre does **not** invent
   its own prompts.
2. **Project scaffold** — onboarding installs a copy of this into a new user project as `.bmad-core/`.

## Pin

- **Source:** https://github.com/bmad-code-org/BMAD-METHOD
- **Version:** `v4.44.3` (BMAD v4 "classic" `.bmad-core` contract)
- **License:** MIT — Copyright (c) 2025 BMad Code, LLC (see `LICENSE` in this directory)

## Updating

Re-vendor from a newer **v4** tag (do not jump to v6 — that is the incompatible `_bmad/` "Skills
Architecture"; Cadre detects-and-refuses v6 until it is explicitly supported). Keep this copy unmodified
so the parse contract stays predictable; project-specific changes belong in the *user's* installed
`.bmad-core/`, not here.
