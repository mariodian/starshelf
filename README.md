<div align="center">
<img width="128" height="128" alt="Starshelf Icon" src="public/icon-256.png" />
<h1>Starshelf</h1>

Auto-categorize GitHub starred repos with AI.<br />Pick a provider, set your key, and every star gets shelved with a category — no manual sorting required.

[Changelog](./CHANGELOG.md) · [Report Bug](https://github.com/mariodian/starshelf/issues/new?template=bug-report.md) · [Request Feature](https://github.com/mariodian/starshelf/issues/new?template=feature-request.md)

![Status](https://img.shields.io/badge/status-alpha-red)
![Version](https://img.shields.io/github/v/release/mariodian/starshelf)
![Platform](https://img.shields.io/badge/platform-Chrome-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

## ⚡ Quick Start

```bash
git clone https://github.com/mariodian/starshelf.git
cd starshelf
bun install && bun run dev
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions`.

## 📋 Table of Contents

- ⚡ [Quick Start](#-quick-start)
- 🤔 [Why Starshelf?](#-why-starshelf)
- ✨ [Features](#-features)
- 🏗️ [Architecture](#️-architecture)
- 📥 [Installation](#-installation)
- 🚀 [Usage](#-usage)
- 🔑 [Permissions](#-permissions)
- ⚠️ [Known Limitations](#️-known-limitations)
- 🔧 [Troubleshooting](#-troubleshooting)
- 💬 [Contributing](#-contributing)
- 📜 [License](#-license)
- 📌 [Credits](#-credits)

## 🤔 Why Starshelf?

GitHub stars pile up fast. Before you know it you have hundreds of repos and no way to find that one library you starred six months ago. Starshelf watches your stars and uses AI to label every repo the moment you star it — so you can browse by category instead of digging through a flat list.

<table border="0" align="center" cellspacing="0" cellpadding="10">
  <tr>
    <td colspan="4" align="center" valign="middle">
      <a href="media/screenshots/screen-1.webp"><img src="./media/screenshots/screen-1.webp" alt="Automatically categorize starred repos with AI" width="100%"></a>
    </td>
  </tr>
  <tr>
    <td width="25%" align="center" valign="middle">
      <a href="media/screenshots/screen-2.webp"><img src="./media/screenshots/screen-2.webp" alt="Bring your own API key" width="100%"></a>
    </td>
    <td width="25%" align="center" valign="middle">
      <a href="media/screenshots/screen-3.webp"><img src="./media/screenshots/screen-3.webp" alt="Shelving into the right category" width="100%"></a>
    </td>
    <td width="25%" align="center" valign="middle">
      <a href="media/screenshots/screen-4.webp"><img src="./media/screenshots/screen-4.webp" alt="Your stars, finally organized" width="100%"></a>
    </td>
  </tr>
</table>

## ✨ Features

- **Star-and-forget**: detects star clicks on GitHub and categorizes repos automatically
- **Multi-provider AI**: Anthropic, OpenAI, or OpenCode — bring your own API key
- **Instant overlay**: category label appears on the page right after starring
- **Unstar cleanup**: removing a star also removes the stored categorization
- **Lightweight**: no bundler bloat, no framework — vanilla TypeScript + WXT

## 🏗️ Architecture

```
entrypoints/
  background.ts    → Service worker: secrets, API calls, settings, logic
  content.ts       → Content script: star-button detection, status overlay
  popup/           → Settings popup: providers, API keys, models
shared/
  types/messages.ts   → Typed content↔background message protocol
  storage.ts          → Extension storage abstraction (encryption-ready)
  github.ts           → URL parser, repo metadata, star verification
  categorizer.ts      → Orchestrates AI categorization
  providers/
    base.ts           → AiProviderClient interface
    anthropic.ts      → Anthropic Messages API
    openai.ts         → OpenAI Chat Completions + model listing
    opencode.ts       → OpenCode Zen / Go (OpenAI-compatible)
```

### Flow

1. User clicks **Star** on a GitHub repo page
2. **Content script** detects the click and sends `repoStarClicked` to the background worker
3. **Background** verifies the sender tab, fetches repo metadata (optionally via GitHub API), calls the selected AI provider for categorization, and stores the result
4. **Background** sends `updateStarStatus` back to the content script
5. **Content script** shows a temporary overlay ("Shelving…", category name, or error)
6. Unstarring removes the stored categorization

### Providers

| Provider  | API                       | Model selection                  | Model listing |
| --------- | ------------------------- | -------------------------------- | ------------- |
| Anthropic | Messages API              | Manual entry                     | —             |
| OpenAI    | Chat Completions          | Manual + fetch from `/v1/models` | Yes           |
| OpenCode  | Chat Completions (Zen/Go) | Manual entry (`provider/model`)  | —             |

## 📥 Installation

### From source

```bash
git clone https://github.com/mariodian/starshelf.git
cd starshelf
bun install
```

### ✅ Requirements

- [Bun](https://bun.sh) v1.0+
- Chromium-based browser (Chrome, Edge, Brave, Arc, etc.)

## 🚀 Usage

```bash
# Dev with hot reload (persistent Chrome profile)
bun run dev

# Type-check
bun run compile

# Production build
bun run build

# Package for distribution
bun run zip
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions`.

### Persistent Dev Profile

`bun run dev` uses a persistent Chromium profile stored in `.wxt/chrome-data/`. Combined with the fixed extension `key` in the manifest (dev only), this means:

- **Stable extension ID** — A hardcoded RSA key is embedded in `wxt.config.ts` so Chrome computes the same extension ID every time. Set `WXT_DEV_EXTENSION_KEY` to override the built-in default.
- **Pinned extension** — Once you pin the extension or install devtools extensions, they stay pinned/installed across dev sessions.
- **Settings & logins persist** — `keepProfileChanges: true` tells WXT not to discard the profile after each run, so browser settings and logins survive restarts.
- **Auto-open GitHub** — GitHub opens automatically in a new tab when the dev browser starts (`startUrls`).

This is dev-only (`webExt` config is ignored by `wxt build`) and does not affect production builds.

The `.wxt/` directory is gitignored, so the profile is local to your machine.

> **Note:** If you previously ran `bun run dev` without a stable extension key, Chrome will see the extension as new on the next start. Pin it once to the toolbar — it will survive all subsequent restarts.

## 🔑 Permissions

| Permission             | Why                                  |
| ---------------------- | ------------------------------------ |
| `storage`              | Persist settings and categorizations |
| `activeTab`            | Verify sender tab context            |
| `https://github.com/*` | Content script injection             |

## ⚠️ Known Limitations

- **Chrome-only**: the extension targets Chromium-based browsers; Firefox support is planned but not yet tested
- **API key required**: Starshelf does not bundle AI access — you must bring your own API key from a supported provider
- **GitHub-only**: only `github.com` repos are supported; GitHub Enterprise and self-hosted instances are not detected
- **Popup configuration**: initial setup requires opening the extension popup to enter credentials before categorization works

## 🔧 Troubleshooting

### Extension doesn't appear after `bun run dev`

Make sure developer mode is enabled in `chrome://extensions` and the `dist/` folder is loaded as unpacked. If Chrome reports an error, check the terminal output for build failures.

### Stars aren't being categorized

Open the extension popup and verify your API key is set and the provider is selected. Check the background service worker console in `chrome://extensions` → "Inspect views: service worker" for error logs.

### Overlay doesn't show on GitHub

Confirm the extension has permission to run on `https://github.com/*`. If you installed the extension after opening GitHub, refresh the page.

### Dev profile reset

If the persistent Chrome profile gets corrupted, delete `.wxt/chrome-data/` and restart `bun run dev`. Your extension settings will be lost, but the source code is unaffected.

## ❤️ Like This Project?

If Starshelf is useful to you, consider leaving a star on GitHub and sharing it with others.

<a href="https://twitter.com/intent/tweet?url=https%3A%2F%2Fgithub.com%2Fmariodian%2Fstarshelf&text=Auto-categorize%20GitHub%20stars%20with%20AI.%20Star%20a%20repo%2C%20Starshelf%20labels%20it.%0A%0AGitHub%3A&via=mariodian" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 20px; color: #fff; background-color: #000000; text-decoration: none; border-radius: 5px; font-family: sans-serif; font-weight: bold; font-size: 1rem;">
<svg width="24" height="24" fill="#fff" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
<span>Share on X (Twitter)</span>
</a>

## 💬 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

## 📜 License

MIT. See [LICENSE](LICENSE).

## 📌 Credits

Feel free to remove this section. Otherwise, credit is appreciated.

[Starshelf on GitHub](https://github.com/mariodian/starshelf) · [Mario Dian on X](https://x.com/mariodian)
