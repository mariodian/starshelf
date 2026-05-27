import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "wxt";

const isDev = process.env.NODE_ENV === "development";
const profileDir = resolve(".wxt/chrome-data");

if (isDev) {
  mkdirSync(profileDir, { recursive: true });
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: "GitHub Star Categorizer",
    description: "Auto-categorize GitHub starred repos with AI",
    version: "0.0.1",
    // Fixed key in dev ensures the extension ID stays stable across reloads,
    // so Chrome keeps the extension pinned between dev sessions.
    // Set WXT_DEV_EXTENSION_KEY env var to override the built-in default.
    key: isDev ? process.env.WXT_DEV_EXTENSION_KEY : undefined,
    permissions: ["storage", "activeTab"],
    host_permissions: ["https://github.com/*"],
    action: {},
    background: {
      service_worker: "background.ts",
    },
  },
  // Dev-only: browser startup config. Does not affect production builds.
  webExt: isDev
    ? {
        // Persistent profile so settings, logins, devtools extensions, and
        // extension pin state survive across dev restarts.
        chromiumArgs: [`--user-data-dir=${profileDir}`],
        startUrls: process.env.VITE_START_URL
          ? [process.env.VITE_START_URL]
          : undefined,
      }
    : undefined,
});
