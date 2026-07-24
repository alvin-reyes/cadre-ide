import { useEffect, useState } from "react";
import { Eye, EyeOff, Check, LogIn, Zap } from "lucide-react";
import { BrandLogo } from "./BrandLogo";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../stores/settingsStore";
import { useCadre } from "./useCadre";
import { secretGet, secretSet, secretHas, isTauri } from "../lib/secrets";
import { reportError } from "../lib/reportError";

/**
 * Sign-In screen — shown when no usable credential is detected on first launch.
 * Lets the user pick a provider and enter their key (or toggle Claude login for
 * dispatch). On "Continue", sets authProvider + fleetProvider so the whole stack
 * routes through that provider.
 *
 * NOT a hard gate: existing users with an Anthropic key already in the keychain
 * bypass this screen entirely (CadreApp skips it when hasCredential is true).
 */

type ProviderId = "claude" | "deepseek" | "kimi";

const PROVIDER_OPTIONS: { id: ProviderId; label: string; hint: string }[] = [
  { id: "claude", label: "Claude (Anthropic)", hint: "Use your Claude Max/Pro login or an Anthropic API key" },
  { id: "deepseek", label: "DeepSeek", hint: "DeepSeek API key — sk-…" },
  { id: "kimi", label: "Kimi (Moonshot)", hint: "Moonshot API key — sk-…" },
];

const inputStyle = {
  width: "100%",
  background: "var(--c-surface-2)",
  border: "1px solid var(--c-border-strong)",
  borderRadius: "var(--c-radius)",
  outline: "none",
  color: "var(--c-text)",
  fontSize: "var(--c-fs-sm)",
  fontFamily: "var(--c-font-mono)",
  padding: "7px 10px",
} as const;

export function SignIn({ onDone }: { onDone: () => void }) {
  const setAuthProvider = useSettingsStore((s) => s.setAuthProvider);
  const setAnthropicApiKey = useSettingsStore((s) => s.setAnthropicApiKey);
  const dispatchUseLogin = useSettingsStore((s) => s.dispatchUseLogin);
  const setDispatchUseLogin = useSettingsStore((s) => s.setDispatchUseLogin);
  const setFleetProvider = useCadre((s) => s.setFleetProvider);

  const [provider, setProvider] = useState<ProviderId>("claude");

  // Per-provider key state
  const [anthropicKey, setAnthropicKey] = useState("");
  const [deepseekKey, setDeepseekKey] = useState("");
  const [kimiKey, setKimiKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  // Detect whether this is a real Tauri build (before any mock is installed).
  // We snapshot it once on mount so the button doesn't flicker after demo starts.
  const [isRealTauri] = useState(() => isTauri());

  // Advisory Claude-login status (null = unchecked, true/false = result)
  const [claudeLoginStatus, setClaudeLoginStatus] = useState<boolean | null>(null);
  const [checkingClaudeLogin, setCheckingClaudeLogin] = useState(false);

  // Part B fix 2: reset reveal when switching providers so a revealed key
  // from one provider is never visible in plaintext on a different provider.
  useEffect(() => { setReveal(false); }, [provider]);

  // Load any existing key from the keychain so the field pre-fills
  useEffect(() => {
    secretGet("deepseek_api_key").then((k) => { if (k) setDeepseekKey(k); });
    secretGet("moonshot_api_key").then((k) => { if (k) setKimiKey(k); });
    secretGet("anthropic_api_key").then((k) => { if (k) setAnthropicKey(k); });
  }, []);

  // Current key for the active non-claude provider
  const currentKey = provider === "deepseek" ? deepseekKey : provider === "kimi" ? kimiKey : anthropicKey;

  // Continue is enabled when there's a usable credential for the chosen path
  const hasCredential =
    provider === "claude"
      ? dispatchUseLogin || anthropicKey.trim().length > 0
      : currentKey.trim().length > 0;

  // Advisory-only: probe for Claude CLI credentials on disk (never blocks, never gates).
  async function handleCheckClaudeLogin() {
    if (checkingClaudeLogin) return;
    setCheckingClaudeLogin(true);
    try {
      const result = await invoke<boolean>("claude_auth_status");
      setClaudeLoginStatus(result);
    } catch {
      // Treat any IPC error as "not detected" — purely advisory
      setClaudeLoginStatus(false);
    } finally {
      setCheckingClaudeLogin(false);
    }
  }

  async function handleContinue() {
    if (!hasCredential || busy) return;
    setBusy(true);
    try {
      // Persist keys to keychain
      if (provider === "claude" && anthropicKey.trim()) {
        setAnthropicApiKey(anthropicKey.trim()); // also mirrors to keychain via store
      } else if (provider === "deepseek" && deepseekKey.trim()) {
        await secretSet("deepseek_api_key", deepseekKey.trim());
      } else if (provider === "kimi" && kimiKey.trim()) {
        await secretSet("moonshot_api_key", kimiKey.trim());
      }

      // Set authProvider and fleetProvider to the chosen provider
      setAuthProvider(provider);
      setFleetProvider(provider);

      setSaved(true);
      setTimeout(() => {
        onDone();
      }, 600);
    } catch {
      /* keychain errors are best-effort */
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function handleDemo() {
    if (demoLoading) return;
    setDemoLoading(true);
    try {
      const { enterDemoMode } = await import("../lib/demo/demoMode");
      await enterDemoMode();
      onDone();
    } catch (e) {
      console.error("[demo] enterDemoMode failed:", e);
      // Surface as toast + AI Log entry (project error convention).
      reportError("demo entry", e);
      setDemoLoading(false);
    }
  }

  return (
    <div
      className="cadre-ui"
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--c-bg)",
      }}
    >
      <div
        style={{
          width: 460,
          background: "var(--c-surface-1)",
          border: "1px solid var(--c-border-strong)",
          borderRadius: "var(--c-radius-lg)",
          padding: "var(--c-space-6)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--c-space-5)",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", marginBottom: "var(--c-space-2)" }}>
            <BrandLogo size={34} />
          </div>
          <div style={{ fontSize: "var(--c-fs-md)", fontWeight: 600, color: "var(--c-text)", marginBottom: 4 }}>
            Choose your AI provider
          </div>
          <div style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", lineHeight: 1.5 }}>
            Your key is stored in the OS keychain — never written to disk in plaintext.
          </div>
        </div>

        {!isTauri() && (
          <div style={{ padding: "8px 12px", borderRadius: "var(--c-radius)", background: "var(--c-warning-subtle)", color: "var(--c-warning)", fontSize: "var(--c-fs-xs)" }}>
            Browser preview — keys can't be saved to the OS keychain here. Run the desktop app (`npm run tauri dev`) to store them securely.
          </div>
        )}

        {/* Provider picker */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--c-space-2)" }}>
          <div style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550, color: "var(--c-text-secondary)", marginBottom: 2 }}>Provider</div>
          {PROVIDER_OPTIONS.map((opt) => {
            const active = provider === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => { setProvider(opt.id); setSaved(false); }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  padding: "10px 14px",
                  borderRadius: "var(--c-radius)",
                  background: active ? "var(--c-accent-subtle)" : "var(--c-surface-2)",
                  border: `1px solid ${active ? "var(--c-accent-ring)" : "var(--c-border-strong)"}`,
                  color: active ? "var(--c-accent)" : "var(--c-text)",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550 }}>{opt.label}</span>
                <span style={{ fontSize: "var(--c-fs-xs)", color: active ? "var(--c-accent)" : "var(--c-text-muted)", opacity: 0.85 }}>{opt.hint}</span>
              </button>
            );
          })}
        </div>

        {/* Credential section — varies by provider */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--c-space-3)" }}>

          {provider === "claude" && (
            <>
              {/* Claude login toggle */}
              <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={dispatchUseLogin}
                  onChange={(e) => setDispatchUseLogin(e.target.checked)}
                  style={{ marginTop: 3, accentColor: "var(--c-accent)", cursor: "pointer", flexShrink: 0 }}
                />
                <span>
                  <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550, color: "var(--c-text-secondary)" }}>
                    Use my Claude login (Max / Pro) for dispatch
                  </span>
                  <span style={{ display: "block", fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", marginTop: 2, lineHeight: 1.45 }}>
                    Fleet agents use your <code>claude</code> CLI login — no API key needed.
                    Planning needs an API key: add an Anthropic key, or use DeepSeek/Kimi as your planning provider.
                  </span>
                </span>
              </label>

              {/* Advisory: Check claude CLI login status */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={handleCheckClaudeLogin}
                  disabled={checkingClaudeLogin}
                  style={{
                    fontSize: "var(--c-fs-xs)",
                    padding: "4px 10px",
                    borderRadius: "var(--c-radius)",
                    border: "1px solid var(--c-border-strong)",
                    background: "var(--c-surface-2)",
                    color: "var(--c-text-secondary)",
                    cursor: checkingClaudeLogin ? "default" : "pointer",
                    flexShrink: 0,
                  }}
                >
                  {checkingClaudeLogin ? "Checking…" : "Check login"}
                </button>
                {claudeLoginStatus === true && (
                  <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-success)" }}>
                    ✓ Claude CLI login detected
                  </span>
                )}
                {claudeLoginStatus === false && (
                  <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>
                    No login found — run <code>claude login</code> in a terminal
                  </span>
                )}
              </div>

              {/* Optional Anthropic key for planning */}
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550, color: "var(--c-text-secondary)" }}>
                    Anthropic API key
                  </span>
                  <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>
                    {dispatchUseLogin ? "optional — needed for planning" : "sk-ant-…"}
                  </span>
                </div>
                <MaskedInput
                  value={anthropicKey}
                  onChange={(v) => { setAnthropicKey(v); setSaved(false); }}
                  placeholder="sk-ant-…"
                  reveal={reveal}
                  onRevealToggle={() => setReveal((r) => !r)}
                />
                {dispatchUseLogin && !anthropicKey.trim() && (
                  <div style={{ marginTop: 6, fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", lineHeight: 1.45 }}>
                    Login powers the fleet with no key. Planning needs an API key — add an Anthropic key, or pick DeepSeek/Kimi as your planning provider.
                  </div>
                )}
              </div>
            </>
          )}

          {provider === "deepseek" && (
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550, color: "var(--c-text-secondary)" }}>DeepSeek API key</span>
                <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>sk-…</span>
              </div>
              <MaskedInput
                value={deepseekKey}
                onChange={(v) => { setDeepseekKey(v); setSaved(false); }}
                placeholder="sk-…"
                reveal={reveal}
                onRevealToggle={() => setReveal((r) => !r)}
              />
            </div>
          )}

          {provider === "kimi" && (
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550, color: "var(--c-text-secondary)" }}>Kimi (Moonshot) API key</span>
                <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>sk-…</span>
              </div>
              <MaskedInput
                value={kimiKey}
                onChange={(v) => { setKimiKey(v); setSaved(false); }}
                placeholder="sk-…"
                reveal={reveal}
                onRevealToggle={() => setReveal((r) => !r)}
              />
            </div>
          )}
        </div>

        {/* Continue button */}
        <button
          onClick={handleContinue}
          disabled={!hasCredential || busy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            padding: "10px 20px",
            borderRadius: "var(--c-radius)",
            background: saved
              ? "var(--c-success-subtle)"
              : hasCredential
              ? "var(--c-accent)"
              : "var(--c-surface-3)",
            color: saved
              ? "var(--c-success)"
              : hasCredential
              ? "var(--c-on-accent)"
              : "var(--c-text-muted)",
            border: "none",
            fontSize: "var(--c-fs-sm)",
            fontWeight: 600,
            cursor: hasCredential && !busy ? "pointer" : "default",
            width: "100%",
          }}
        >
          {saved ? (
            <><Check size={16} strokeWidth={2.5} /> Saved — continue</>
          ) : (
            <><LogIn size={16} strokeWidth={2} /> Continue</>
          )}
        </button>

        <div style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)", textAlign: "center", lineHeight: 1.45 }}>
          You can change providers later in <b style={{ color: "var(--c-text-muted)" }}>Settings</b>.
        </div>

        {/* Demo button — only shown in browser (not real Tauri) */}
        {!isRealTauri && (
          <div style={{ borderTop: "1px solid var(--c-border)", paddingTop: "var(--c-space-4)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--c-space-2)" }}>
            <button
              onClick={handleDemo}
              disabled={demoLoading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 18px",
                borderRadius: "var(--c-radius)",
                background: "transparent",
                border: "1px solid var(--c-border-strong)",
                color: "var(--c-text-secondary)",
                fontSize: "var(--c-fs-xs)",
                fontWeight: 550,
                cursor: demoLoading ? "default" : "pointer",
                opacity: demoLoading ? 0.6 : 1,
              }}
            >
              <Zap size={13} strokeWidth={2} />
              {demoLoading ? "Loading demo…" : "Try the demo (no key required)"}
            </button>
            <div style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)", textAlign: "center" }}>
              Explore all screens with a pre-seeded project — no sign-in needed.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Masked password input with reveal toggle — mirrors the KeyField pattern from Settings.tsx. */
function MaskedInput({
  value,
  onChange,
  placeholder,
  reveal,
  onRevealToggle,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  reveal: boolean;
  onRevealToggle: () => void;
}) {
  return (
    <div style={{ position: "relative" }}>
      <input
        type={reveal ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        style={{ ...inputStyle, paddingRight: 34 }}
      />
      <button
        onClick={onRevealToggle}
        title={reveal ? "Hide" : "Reveal"}
        tabIndex={-1}
        style={{
          position: "absolute",
          right: 6,
          top: "50%",
          transform: "translateY(-50%)",
          display: "inline-flex",
          background: "transparent",
          border: "none",
          color: "var(--c-text-muted)",
          cursor: "pointer",
          padding: 4,
        }}
      >
        {reveal ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
      </button>
    </div>
  );
}

/**
 * Hook that returns whether the user has a usable credential for any provider.
 * Used by CadreApp to decide whether to show SignIn or go straight to Welcome.
 *
 * Returns: { checked: boolean; hasCredential: boolean }
 * - checked: false while still reading from keychain (avoid flash-of-signin)
 * - hasCredential: true if any provider has a key or Claude-login is enabled
 */
export function useHasCredential(): { checked: boolean; hasCredential: boolean } {
  const anthropicKey = useSettingsStore((s) => s.anthropicApiKey);
  const dispatchUseLogin = useSettingsStore((s) => s.dispatchUseLogin);
  const [checked, setChecked] = useState(false);
  const [keychainHas, setKeychainHas] = useState(false);

  useEffect(() => {
    // If already in settings store (hydrateSecrets already ran), use that
    if (anthropicKey.trim()) {
      setKeychainHas(true);
      setChecked(true);
      return;
    }
    // Otherwise probe the keychain for any provider key.
    // Part B fix 1: .catch ensures checked is set even if IPC rejects,
    // so the app never shows a permanent blank screen.
    Promise.all([
      secretHas("anthropic_api_key"),
      secretHas("deepseek_api_key"),
      secretHas("moonshot_api_key"),
    ]).then(([a, d, m]) => {
      setKeychainHas(a || d || m);
      setChecked(true);
    }).catch(() => setChecked(true));
  }, [anthropicKey]);

  const hasCredential = dispatchUseLogin || anthropicKey.trim().length > 0 || keychainHas;
  return { checked, hasCredential };
}
