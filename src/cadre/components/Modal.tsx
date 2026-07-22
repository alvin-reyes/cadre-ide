import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Accessible modal dialog: role="dialog" + aria-modal, Escape-to-close, focus moved
 * in on open and returned on close, a Tab focus-trap, and a theme-aware scrim.
 * Shared by Settings, Team, and any future dialog so a11y lives in one place.
 */
export function Modal({
  label,
  title,
  onClose,
  children,
  width = 520,
  maxHeightVh = 88,
}: {
  /** Accessible name for the dialog (screen readers). */
  label: string;
  /** Visual header content (left side). */
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  maxHeightVh?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      // Swallow the app's global shortcuts while a dialog is open, so Ctrl+`/Ctrl+T
      // don't toggle the terminal behind the modal.
      if ((e.ctrlKey || e.metaKey) && (e.key === "`" || e.key === "t" || e.key === "T")) {
        e.stopPropagation();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // Return focus to the trigger — but only if it's still in the document
      // (it may have unmounted while the dialog was open), else don't strand focus.
      const el = restoreFocus.current;
      if (el && el.isConnected) el.focus();
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "var(--c-scrim)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900, padding: "var(--c-space-5)" }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="cadre-bubble"
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: "100%",
          maxHeight: `${maxHeightVh}vh`,
          overflow: "auto",
          background: "var(--c-surface-1)",
          border: "1px solid var(--c-border-strong)",
          borderRadius: "var(--c-radius-lg)",
          boxShadow: "var(--c-elev-3)",
          outline: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "var(--c-space-3) var(--c-space-4)", borderBottom: "1px solid var(--c-border)", position: "sticky", top: 0, background: "var(--c-surface-1)", zIndex: 1 }}>
          {title}
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            aria-label="Close dialog"
            title="Close (Esc)"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "var(--c-radius-sm)", background: "transparent", border: "none", color: "var(--c-text-muted)", cursor: "pointer" }}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
