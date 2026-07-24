import React from "react";
import ReactDOM from "react-dom/client";
import { CadreApp } from "./cadre/CadreApp";
import { Splash } from "./cadre/Splash";
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
    }
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Splash />
      <CadreApp />
    </React.StrictMode>,
  );
}

bootstrap();
