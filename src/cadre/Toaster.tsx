import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useToastStore } from "../stores/toastStore";

/** Bottom-right stack of transient action toasts. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 1000,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => {
        const color =
          t.kind === "success" ? "var(--c-success)" : t.kind === "error" ? "var(--c-danger)" : "var(--c-accent)";
        const Icon = t.kind === "success" ? CheckCircle2 : t.kind === "error" ? AlertCircle : Info;
        return (
          <div
            key={t.id}
            className="cadre-toast"
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--c-overlay)",
              border: "1px solid var(--c-border-strong)",
              borderLeft: `3px solid ${color}`,
              borderRadius: "var(--c-radius)",
              padding: "9px 12px",
              boxShadow: "var(--c-elev-2)",
              minWidth: 200,
              maxWidth: 380,
              fontSize: "var(--c-fs-sm)",
              color: "var(--c-text)",
            }}
          >
            <Icon size={15} strokeWidth={2} style={{ color, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              onClick={() => remove(t.id)}
              title="Dismiss"
              style={{ background: "transparent", border: "none", color: "var(--c-text-muted)", cursor: "pointer", display: "inline-flex", padding: 0 }}
            >
              <X size={13} strokeWidth={2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
