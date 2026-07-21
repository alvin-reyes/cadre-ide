<h1 align="center">Cadre</h1>

<p align="center"><b>The OS for agentic development.</b></p>

<p align="center">
A keyboard-first, terminal-centric desktop IDE that lets an architect / product owner run a
<b>disciplined</b> fleet of AI agents — where both the <i>method</i> (BMAD) and the <i>engineering</i>
(TDD, review, machine-verified QA gates) are <b>enforced, not hoped for</b>.
</p>

<p align="center">
Built with <a href="https://v2.tauri.app/">Tauri v2</a> (Rust) + React 19 + TypeScript +
<a href="https://xtermjs.org/">xterm.js</a>. Drives <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a> agents in live PTYs.
</p>

---

## What it is

Cadre turns the [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) into a real IDE. You don't
skip from an idea to a pile of generated code — you pass through **requirements → architecture →
context-engineered stories → implementation → machine-verified QA**. The single load-bearing rule:
**Cadre runs the tests itself and writes `Done`; agents never self-report success.**

It is the evolution of [ADE](https://github.com/alvin-reyes/better-agentic-ide) (a keyboard-first
agentic terminal), refocused around the disciplined loop.

**Status:** early — building the v0.0 walking skeleton. See the design spec in
[`docs/superpowers/specs/`](docs/superpowers/specs/).

## Build from source

Prerequisites: **Node.js 18+**, **Rust (stable)**, and [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
(`npm install -g @anthropic-ai/claude-code`) for the agent features.

```bash
npm install
npm run tauri dev      # development
npm run tauri build    # production
```

Run the Rust engine tests:

```bash
cd src-tauri && cargo test
```

## License

ISC
