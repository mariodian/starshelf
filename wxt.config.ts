import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "wxt";

const CHROME_WEBSTORE_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5G+CB7YYHI93dA0e0lKyVt4THAm7YAXaritPRa8c6l6Q/gViVYjB+69nR99rVvGJEt14QF0X0gNR4QUV42pwDFuBl/90/0H2lKeryz3fUg4Ke09GcQBjIKET3k93yC69ke/vF89qgDNrHfOnHIIhNPyNnDN64Aui40WoJcNaTLwPHZbAKn0ayL4OvNA1yFWXfW1d898pDDs5SNuTrygtqLASrJoY2RCh7Wov75wI68GoUgYnFZ07J13k5qwtNE0QnG0PZxql+kvX8Kuiz8hVKR1i1vVHNDErVRSH0HwcLCS1aGs+PM0wZKRYML9SA0NPR8NPLJ5DQuuouJDqIGLYuwIDAQAB";

const isDev = process.env.NODE_ENV === "development";
const isFirefox =
  process.argv.includes("-b") && process.argv.includes("firefox");
const chromeProfileDir = resolve(".wxt/chrome-data");
const firefoxProfileDir = resolve(".wxt/firefox-data");

if (isDev) {
  if (isFirefox) {
    mkdirSync(firefoxProfileDir, { recursive: true });
  } else {
    mkdirSync(chromeProfileDir, { recursive: true });
  }
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
    key: isDev ? process.env.WXT_DEV_EXTENSION_KEY : CHROME_WEBSTORE_KEY,
    permissions: ["storage"],
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
    browser_specific_settings: {
      gecko: {
        id: "starshelf@mariodian",
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
  }),
  srcDir: "src",
  outDir: "dist",
  // Dev-only: browser startup config. Does not affect production builds.
  webExt: {
    disabled: !!process.env.VITE_BROWSER_DISABLED || false,
    // Persistent profile so settings, logins, devtools extensions, and
    // extension pin state survive across dev restarts.
    chromiumArgs: [`--user-data-dir=${chromeProfileDir}`],
    firefoxProfile: firefoxProfileDir,
    startUrls: [process.env.VITE_START_URL || "https://github.com/"],
    keepProfileChanges: true,
  },
});
