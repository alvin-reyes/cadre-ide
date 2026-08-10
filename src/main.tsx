import React from "react";
import ReactDOM from "react-dom/client";
import { CadreApp } from "./cadre/CadreApp";
import { Splash } from "./cadre/Splash";
import { useSettingsStore, applyThemeToDOM } from "./stores/settingsStore";
import "./fonts";
import "./lib/monacoSetup";
import "./index.css";
import "./styles/tokens.css";

async function bootstrap() {
  // Demo mode: if ?demo=1 is in the URL AND we are NOT in real Tauri (no
  // __TAURI_INTERNALS__ yet), enter demo mode before rendering so the mock
  // backend is installed and the project is seeded before the first render.
  const isRealTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const hasDemo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("demo");

  if (hasDemo && !isRealTauri) {
    try {
      const { enterDemoMode } = await import("./lib/demo/demoMode");
      await enterDemoMode();
    } catch (e) {
      console.error("[demo] enterDemoMode failed:", e);
      // Surface as toast + AI Log entry (project error convention) so demo failures
      // are visible in the UI, not just the console. App renders regardless.
      const { reportError } = await import("./lib/reportError");
      reportError("demo bootstrap", e);
    }
  }

  // Apply the active theme preset to <html data-theme> BEFORE first paint, so the
  // default (GitHub Light) and any saved preset render correctly. CadreApp — the
  // component we actually render — never did this, so the theme defaulted to the
  // CSS :root (dark) regardless of the setting.
  applyThemeToDOM(useSettingsStore.getState().getActiveTheme());

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Splash />
      <CadreApp />
    </React.StrictMode>,
  );
}

bootstrap();
