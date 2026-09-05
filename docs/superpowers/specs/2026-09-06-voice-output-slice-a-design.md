# Voice Output — Slice A (Design)

**Date:** 2026-09-06
**Status:** Approved for planning
**Scope:** Cadre speaks milestone events aloud so you can leave the machine while agents run. Output only — no microphone, no speech recognition, no voice commands.

## Problem

A fleet run is long and mostly silent. The information worth waiting for — a story reaching `Done`, one going `Failed` or `Blocked`, the fleet finishing — is only visible if you are looking at the screen. In practice that means watching a board instead of doing something else, which is the opposite of what an autonomous fleet is for.

## Spike findings (measured, not assumed)

A throwaway probe run **inside Tauri's WKWebView** (not Chrome — the distinction is load-bearing) established:

| Capability | Result |
|---|---|
| `speechSynthesis` | available, **68 system voices** (Samantha, Albert, …) |
| `getVoices()` at call time | **returns `[]`** until `voiceschanged` fires |
| `webkitSpeechRecognition` exists | true |
| `webkitSpeechRecognition` **starts** | **`ERROR: service-not-allowed`** |
| `getUserMedia` | granted in dev, real mic |

Two consequences shape this slice:

1. **Output is essentially free.** No permissions, no network, no dependency, no API key. That is why this slice comes before voice *input*.
2. **The Web Speech recognition path is dead in this shell** — it exists and then refuses to start. Slice B will need a real STT engine (cloud or bundled), which is a separate decision and explicitly out of scope here.

## Decisions settled

1. **Milestones only.** Story reaching `Done` / `Failed` / `Blocked`, and fleet completion. Not every toast — toasts fire constantly ("Saved file.md"), and a feature that talks that much gets muted permanently.
2. **Off by default.** An app that unexpectedly speaks is a bad surprise. `voiceAnnouncements` defaults to `false`; the user opts in from Settings.
3. **Two emit points, one listener.** Announcements ride a `cadre:milestone` window event, mirroring the existing `cadre:new-terminal` pattern, rather than scattering `speak()` calls through the codebase.
4. **No microphone anywhere in this slice.** No `getUserMedia`, no `NSMicrophoneUsageDescription`, no capability change. Slice A must not require a permission prompt.

## Architecture

### 1. Pure core (`src/lib/voice/announce.ts`)

Vitest runs **node-only over `src/**/*.test.ts`** — there is no DOM and no `speechSynthesis`. So all phrasing logic lives outside the component, or it cannot be tested.

```ts
export type Milestone =
  | { kind: "story"; epic: number; story: number; status: Status; title?: string }
  | { kind: "fleet"; done: number; failed: number; blocked: number };

/** The phrase to speak, or null when this event is not worth announcing. */
export function announcementFor(m: Milestone): string | null;

/** Terminal statuses only — everything else is null. */
export function isAnnounceableStatus(status: Status): boolean;
```

`announcementFor` owns every wording decision: which statuses speak, how a story is identified aloud (`"Story 1.2, Add login, is done"` — the number alone is unmemorable), and how counts are pluralised (`"1 story failed"` not `"1 stories failed"`). A `Draft`/`Approved`/`InProgress`/`InReview` transition returns `null`.

**Speech is not text.** Phrases are written to be *heard*: no markdown, no file paths, no punctuation that a synthesiser reads aloud. A story title containing backticks or a path is stripped to something speakable.

### 2. Speaker adapter (`src/lib/voice/speaker.ts`)

```ts
export interface Speaker {
  available(): boolean;
  speak(text: string): void;
  cancel(): void;
}

export function createSpeechSynthesisSpeaker(opts: {
  voiceName?: string;
  rate?: number;
}): Speaker;
```

Behind an interface so the announcer can be unit-tested with a fake that records what it was asked to say, and so slice D could later swap in a different engine.

**The async-voices trap, from the spike:** `getVoices()` returns `[]` on first call and populates after `voiceschanged`. A naive implementation resolves the user's chosen voice to `undefined` and silently falls back to the system default. The adapter resolves the voice lazily at `speak()` time, not at construction.

### 3. Emission (two points)

- **`src/stores/bmadStore.ts` → `setStatus`** — the single choke point every status change already routes through (the engine's `setStatus` dep routes here too, so CLI-driven changes surface as well). After a successful write, dispatch `cadre:milestone` for terminal statuses.
- **`src/cadre/useCadre.ts` → the fleet `allDone` resolution (~line 1129)** — dispatch a `fleet` milestone with the run's tallies.

Emission is unconditional and cheap (a `CustomEvent` with no listener is a no-op). **The settings check lives in the listener, not the emitter** — so turning voice off cannot accidentally suppress a future non-voice consumer of the same event.

### 4. Listener (`src/cadre/VoiceAnnouncer.tsx`)

A render-null component mounted once in `CadreApp`. Subscribes to `cadre:milestone`, reads `voiceAnnouncements` / `voiceName` / `voiceRate` from `settingsStore`, and calls the speaker. Mounted once so two views cannot double-speak.

### 5. Settings

Three fields in `settingsStore`, following the existing `gateOnReview` pattern:

| Field | Default |
|---|---|
| `voiceAnnouncements` | `false` |
| `voiceName` | `undefined` (system default) |
| `voiceRate` | `1.0` |

The Settings panel gets a toggle, a voice picker populated after `voiceschanged`, and a **Test voice** button — without one, a user cannot tell a misconfigured voice from a broken feature.

## Data flow

```
setStatus(epic, story, "Done")            fleet allDone resolves
        │                                          │
        └──> window.dispatchEvent("cadre:milestone") <──┘
                          │
                 VoiceAnnouncer (mounted once)
                          │
              voiceAnnouncements enabled?  ──no──> drop
                          │ yes
                 announcementFor(milestone)  ──null──> drop
                          │ phrase
                    Speaker.speak(phrase)
```

## Error handling

A synthesiser failure must never break a fleet run. The speaker catches everything and reports through `reportError()` **once per session**, then degrades to silent — satisfying the errors-are-never-silent convention without a toast storm if the audio device disappears mid-run.

If `speechSynthesis` is unavailable, the Settings toggle is disabled with an explanation rather than silently doing nothing.

## Safety / invariants

- **No engine changes.** Presentation only; nothing touches `src/lib/engine/`, the Rust state machine, or story status. The "engine writes Done" invariant is untouched — voice only *observes* that it happened.
- **No new permissions.** No microphone, no capability change, no Info.plist entry.
- **Demo mode keeps working.** No new Tauri command, so `mockBackend.ts` needs no change.
- **Emission cannot fail a dispatch.** `dispatchEvent` is synchronous and side-effect-free here; the announcer's own errors are caught inside the listener.

## Testing strategy

Node-environment tests over the pure core, which is where the real branching lives:

- `isAnnounceableStatus` — `Done`/`Failed`/`Blocked` true; `Draft`/`Approved`/`InProgress`/`InReview` false.
- `announcementFor` — a story phrase includes the epic/story number and title; a title containing markdown or a path is reduced to something speakable; a non-terminal status returns `null`; fleet counts pluralise correctly at 0, 1 and many; an all-succeeded run reads differently from one with failures.
- The announcer's gating, driven through a **fake `Speaker`**: disabled setting speaks nothing; a `null` phrase speaks nothing; an enabled setting speaks exactly once per milestone.

UI behaviour (the Settings toggle, the voice picker, actual audible output) is verified manually and through the demo-mode Playwright scripts, per the existing convention. **Audible output cannot be asserted automatically** — the tests prove what was *sent* to the speaker, not what was heard.

## Non-goals (Slice A)

- Any microphone use, speech recognition, or voice commands (slices B and C).
- Speaking errors, toasts, or the AI Log.
- Per-project voice settings — it is a machine-level preference.
- Reading story *content* aloud; only milestone announcements.
- Notification sounds or system notifications, which are a different feature.
