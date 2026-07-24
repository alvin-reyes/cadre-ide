import { useEffect, useState } from "react";
import { KeyRound, Cpu, Eye, EyeOff, Check } from "lucide-react";
import { Modal } from "./components/Modal";
import { useSettingsStore } from "../stores/settingsStore";
import { useCadre } from "./useCadre";
import { PROVIDERS } from "../lib/engine/providers";
import { secretGet, secretSet, isTauri } from "../lib/secrets";
import { RepoSection } from "./RepoRegistry";

/**
 * Settings — the CTO's control panel for API keys and models. Keys are written to
 * the OS keychain (SecretsStore); the Anthropic key doubles as the planning brain's
 * credential and the Claude fleet's token. Models pick which model the planning
 * brain and the dev fleet run on.
 */

const PLANNING_MODEL_SUGGESTIONS = ["claude-opus-4-8", "claude-opus-4-20250514", "claude-sonnet-4-6"];

/** Providers that expose a settable key here, in display order. */
const KEY_PROVIDERS = [
  { secretKey: "anthropic_api_key", label: "Anthropic (Claude)", hint: "sk-ant-…", claude: true },
  { secretKey: "moonshot_api_key", label: "Moonshot (Kimi)", hint: "sk-…" },
  { secretKey: "deepseek_api_key", label: "DeepSeek", hint: "sk-…" },
];

export function Settings({ onClose }: { onClose: () => void }) {
  const anthropicKey = useSettingsStore((s) => s.anthropicApiKey);
  const setAnthropicKey = useSettingsStore((s) => s.setAnthropicApiKey);
  const planningModel = useSettingsStore((s) => s.planningModel);
  const setPlanningModel = useSettingsStore((s) => s.setPlanningModel);
  const fleetModel = useSettingsStore((s) => s.fleetModel);
  const setFleetModel = useSettingsStore((s) => s.setFleetModel);
  const gateOnReview = useSettingsStore((s) => s.gateOnReview);
  const setGateOnReview = useSettingsStore((s) => s.setGateOnReview);
  const agentTimeoutMins = useSettingsStore((s) => s.agentTimeoutMins);
  const setAgentTimeoutMins = useSettingsStore((s) => s.setAgentTimeoutMins);
  const dispatchUseLogin = useSettingsStore((s) => s.dispatchUseLogin);
  const setDispatchUseLogin = useSettingsStore((s) => s.setDispatchUseLogin);
  const resumeSessions = useSettingsStore((s) => s.resumeSessions);
  const setResumeSessions = useSettingsStore((s) => s.setResumeSessions);
  const fleetProvider = useCadre((s) => s.fleetProvider);
  const setFleetProvider = useCadre((s) => s.setFleetProvider);

  const provider = PROVIDERS[fleetProvider] ?? PROVIDERS.claude;

  return (
    <Modal
      label="Settings — API keys and models"
      width={560}
      onClose={onClose}
      title={<span style={{ fontSize: "var(--c-fs-lg)", fontWeight: 600 as const, color: "var(--c-text)" }}>Settings</span>}
    >
        {!isTauri() && (
          <div style={{ margin: "var(--c-space-4) var(--c-space-4) 0", padding: "8px 12px", borderRadius: "var(--c-radius)", background: "var(--c-warning-subtle)", color: "var(--c-warning)", fontSize: "var(--c-fs-xs)" }}>
            Browser preview — keys can't be saved to the OS keychain here. Run the desktop app (`npm run tauri dev`) to store them securely.
          </div>
        )}

        {/* Keys */}
        <Section icon={KeyRound} title="API keys" subtitle="Stored in your OS keychain — never written to disk in plaintext.">
          {KEY_PROVIDERS.map((p) => (
            <KeyField
              key={p.secretKey}
              label={p.label}
              hint={p.hint}
              secretKey={p.secretKey}
              storeValue={p.claude ? anthropicKey : undefined}
              onSaveStore={p.claude ? setAnthropicKey : undefined}
            />
          ))}
        </Section>

        {/* Models */}
        <Section icon={Cpu} title="Models" subtitle="The planning brain thinks; the dev fleet builds. The engine verifies either way.">
          <Field label="Planning brain" hint="PM · Architect · Designer · sharding · plan validation · reviews">
            <input
              list="cadre-planning-models"
              value={planningModel}
              onChange={(e) => setPlanningModel(e.target.value)}
              placeholder="claude-opus-4-8"
              style={inputStyle}
            />
            <datalist id="cadre-planning-models">
              {PLANNING_MODEL_SUGGESTIONS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>

          <Field label="Dev fleet provider" hint="Which model provider the Dev/QA fleet runs on">
            <select value={fleetProvider} onChange={(e) => setFleetProvider(e.target.value)} style={inputStyle}>
              {Object.values(PROVIDERS).map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Dev fleet model" hint={`Override — blank uses ${provider.name}'s default (${provider.defaultModel})`}>
            <input
              value={fleetModel}
              onChange={(e) => setFleetModel(e.target.value)}
              placeholder={provider.defaultModel}
              style={inputStyle}
            />
          </Field>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={gateOnReview}
              onChange={(e) => setGateOnReview(e.target.checked)}
              style={{ marginTop: 3, accentColor: "var(--c-accent)", cursor: "pointer", flexShrink: 0 }}
            />
            <span>
              <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550 as const, color: "var(--c-text-secondary)" }}>Gate merge on code review</span>
              <span style={{ display: "block", fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>
                Run the adversarial review after each story verifies; block the merge (Blocked) if it fails. More thorough, more agent runs.
              </span>
            </span>
          </label>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={dispatchUseLogin}
              onChange={(e) => setDispatchUseLogin(e.target.checked)}
              style={{ marginTop: 3, accentColor: "var(--c-accent)", cursor: "pointer", flexShrink: 0 }}
            />
            <span>
              <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550 as const, color: "var(--c-text-secondary)" }}>Dispatch on my Claude login (not the API key)</span>
              <span style={{ display: "block", fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>
                Native-Claude fleet agents use your <code>claude</code> CLI login (e.g. Max plan) instead of the API key. Planning still uses the key.
              </span>
            </span>
          </label>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={resumeSessions}
              onChange={(e) => setResumeSessions(e.target.checked)}
              style={{ marginTop: 3, accentColor: "var(--c-accent)", cursor: "pointer", flexShrink: 0 }}
            />
            <span>
              <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550 as const, color: "var(--c-text-secondary)" }}>Resume sessions on retry</span>
              <span style={{ display: "block", fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>
                Re-dispatching a Failed/Blocked story resumes its prior <code>claude</code> session, so the retry keeps what it already tried instead of starting cold.
              </span>
            </span>
          </label>

          <Field label="Agent timeout" hint="Kill a Dev agent that hasn't finished in this many minutes (0 = no cap). A silent stall is usually a bad key.">
            <input
              type="number"
              min={0}
              value={agentTimeoutMins}
              onChange={(e) => setAgentTimeoutMins(Number(e.target.value))}
              style={{ ...inputStyle, width: 120 }}
            />
          </Field>
        </Section>

        {/* Repos */}
        <RepoSection />

        <div style={{ height: "var(--c-space-4)" }} />
    </Modal>
  );
}

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

function Section({ icon: Icon, title, subtitle, children }: { icon: typeof KeyRound; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "var(--c-space-4)", borderBottom: "1px solid var(--c-border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
        <Icon size={15} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
        <span style={{ fontSize: "var(--c-fs-md)", fontWeight: 600 as const, color: "var(--c-text)" }}>{title}</span>
      </div>
      <div style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", marginBottom: "var(--c-space-3)" }}>{subtitle}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--c-space-3)" }}>{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550 as const, color: "var(--c-text-secondary)" }}>{label}</span>
        {hint && <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * One API-key row. Claude's key lives in the settings store (already keychain-mirrored);
 * the rest hydrate from / save to the keychain directly. Masked with a reveal toggle;
 * a Save button commits and flashes a confirmation.
 */
function KeyField({
  label,
  hint,
  secretKey,
  storeValue,
  onSaveStore,
}: {
  label: string;
  hint: string;
  secretKey: string;
  storeValue?: string;
  onSaveStore?: (v: string) => void;
}) {
  const [value, setValue] = useState(storeValue ?? "");
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState(false);

  // Keychain-backed providers: load the stored key once on mount.
  useEffect(() => {
    if (onSaveStore) return; // store-backed value comes in via props
    let alive = true;
    secretGet(secretKey).then((k) => {
      if (alive && k) setValue(k);
    });
    return () => {
      alive = false;
    };
  }, [secretKey, onSaveStore]);

  // Keep the store-backed field in sync if it hydrates after mount.
  useEffect(() => {
    if (onSaveStore && storeValue !== undefined) setValue(storeValue);
  }, [storeValue, onSaveStore]);

  async function save() {
    if (onSaveStore) onSaveStore(value.trim());
    else await secretSet(secretKey, value.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <Field label={label} hint={hint}>
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            type={reveal ? "text" : "password"}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            placeholder={hint}
            autoComplete="off"
            spellCheck={false}
            style={{ ...inputStyle, paddingRight: 34 }}
          />
          <button
            onClick={() => setReveal((r) => !r)}
            title={reveal ? "Hide" : "Reveal"}
            tabIndex={-1}
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", display: "inline-flex", background: "transparent", border: "none", color: "var(--c-text-muted)", cursor: "pointer", padding: 4 }}
          >
            {reveal ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
          </button>
        </div>
        <button
          onClick={save}
          disabled={!value.trim()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: "var(--c-fs-sm)",
            fontWeight: 550 as const,
            padding: "0 14px",
            borderRadius: "var(--c-radius)",
            background: saved ? "var(--c-success-subtle)" : value.trim() ? "var(--c-accent)" : "var(--c-surface-3)",
            color: saved ? "var(--c-success)" : value.trim() ? "var(--c-on-accent)" : "var(--c-text-muted)",
            border: "none",
            cursor: value.trim() ? "pointer" : "default",
            flexShrink: 0,
          }}
        >
          {saved ? <Check size={14} strokeWidth={2.5} /> : null}
          {saved ? "Saved" : "Save"}
        </button>
      </div>
    </Field>
  );
}
