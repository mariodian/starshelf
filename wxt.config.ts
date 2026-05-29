import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "wxt";

const isDev = process.env.NODE_ENV === "development";
const profileDir = resolve(".wxt/chrome-data");

if (isDev) {
  mkdirSync(profileDir, { recursive: true });
}

// Read version from package.json so releases always match the tag
const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: () => ({
    name: "Starshelf",
    description: "Auto-categorize GitHub starred repos with AI",
    version: pkg.version,
    // Fixed key in dev ensures the extension ID stays stable across reloads,
    // so Chrome keeps the extension pinned between dev sessions.
    // Set WXT_DEV_EXTENSION_KEY env var to override the built-in default.
    key: isDev ? process.env.WXT_DEV_EXTENSION_KEY : undefined,
    permissions: ["storage", "activeTab"],
    host_permissions: [
      "https://github.com/*",
      "https://api.github.com/*",
      "https://api.anthropic.com/*",
      "https://api.openai.com/*",
      "https://opencode.ai/*",
    ],
    action: {},
    background: {
      service_worker: "background.ts",
    },
  }),
  srcDir: "src",
  outDir: "dist",
  // Dev-only: browser startup config. Does not affect production builds.
  webExt: {
    disabled: !!process.env.VITE_BROWSER_DISABLED || false,
    // Persistent profile so settings, logins, devtools extensions, and
    // extension pin state survive across dev restarts.
    chromiumArgs: [`--user-data-dir=${profileDir}`],
    startUrls: [process.env.VITE_START_URL || "https://github.com/"],
    keepProfileChanges: true,
  },
});
