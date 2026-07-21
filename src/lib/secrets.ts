import { invoke } from "@tauri-apps/api/core";

/**
 * Thin frontend wrapper over the Rust SecretsStore (keyring). In the browser
 * preview there is no keychain, so every call degrades gracefully (get → null,
 * set/delete → no-op) and callers fall back to their in-memory/localStorage path.
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function secretGet(key: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return (await invoke<string | null>("secret_get", { key })) ?? null;
  } catch {
    return null;
  }
}

export async function secretSet(key: string, value: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("secret_set", { key, value });
  } catch {
    /* keychain unavailable */
  }
}

export async function secretHas(key: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>("secret_has", { key });
  } catch {
    return false;
  }
}

export async function secretDelete(key: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("secret_delete", { key });
  } catch {
    /* keychain unavailable */
  }
}
