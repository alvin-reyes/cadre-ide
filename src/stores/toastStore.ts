import { create } from "zustand";

/** Transient action feedback ("Signed off", "Dispatched", …). Auto-dismisses. */

export type ToastKind = "info" | "success" | "error";
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind) => void;
  remove: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, kind = "info") => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2800);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience for non-component callers (store actions). */
export const toast = (message: string, kind?: ToastKind) => useToastStore.getState().push(message, kind);
