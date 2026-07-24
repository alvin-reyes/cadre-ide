/**
 * Self-hosted brand fonts (Fontsource) so the Cadre type renders identically
 * offline — critical for a Tauri desktop app that can't rely on the Google CDN.
 * Space Grotesk (display) · Inter (UI) · JetBrains Mono (code/labels).
 * Vite bundles the woff2 at build time. Imported once in main.tsx.
 */
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
