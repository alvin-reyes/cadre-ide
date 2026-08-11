import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Accessible modal dialog: role="dialog" + aria-modal, Escape-to-close, focus moved
 * in on open and returned on close, a Tab focus-trap, and a theme-aware scrim.
 * Shared by Settings, Team, and any future dialog so a11y lives in one place.
 */

// Module-level stack of open modals (most-recently-opened last). Every <Modal>
// registers itself on mount and unregisters on unmount. Escape is only honored
// by the TOP modal, so a modal-in-modal (e.g. Settings → ConnectionModal) closes
// just the inner dialog per keypress instead of collapsing every open layer —
// capture-phase keydown listeners on the shared `document` target all fire, and
// e.stopPropagation() does NOT stop sibling same-target listeners (only
// stopImmediatePropagation does), so without this every layer would react.
//
// Exported for unit tests (the repo has no DOM/RTL harness, so the Escape
// arbitration is verified through these primitives rather than a rendered mount).
const modalStack: symbol[] = [];

/** Register a newly-opened modal as the topmost; returns its stack token. */
export function pushModal(): symbol {
  const token = Symbol("modal");
  modalStack.push(token);
  return token;
}

/** Remove a modal from the stack on close/unmount (safe if already gone). */
export function popModal(token: symbol): void {
  const idx = modalStack.lastIndexOf(token);
  if (idx !== -1) modalStack.splice(idx, 1);
}

/** True only if `token` is the topmost open modal — i.e. the one Escape targets. */
export function isTopModal(token: symbol): boolean {
  return modalStack.length > 0 && modalStack[modalStack.length - 1] === token;
}
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

    // Register this instance as the topmost open modal.
    const token = pushModal();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Only the topmost modal reacts. stopImmediatePropagation() (not just
        // stopPropagation) also blocks sibling capture-phase listeners on this
        // same `document` target — i.e. any lower modal's handler — so one
        // Escape closes exactly one layer.
        if (!isTopModal(token)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
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
      popModal(token);
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
