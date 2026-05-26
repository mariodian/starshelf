# GitHub Star Categorizer

Chrome extension that auto-categorizes GitHub repos when you star them — using your choice of AI provider.

## Architecture

```
entrypoints/
  background.ts    → Service worker: secrets, API calls, settings, logic
  content.ts       → Content script: star-button detection, status overlay
  options/         → Settings page: providers, API keys, models
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
5. **Content script** shows a temporary overlay ("Categorizing...", category name, or error)
6. Unstarring removes the stored categorization

### Providers

| Provider  | API | Model selection | Model listing |
|-----------|-----|----------------|---------------|
| Anthropic | Messages API | Manual entry | — |
| OpenAI | Chat Completions | Manual + fetch from `/v1/models` | Yes |
| OpenCode | Chat Completions (Zen/Go) | Manual entry (`provider/model`) | — |

## Development

```bash
# Install
bun install

# Dev with hot reload
bun run dev

# Type-check
bun run compile

# Production build
bun run build

# Package
bun run zip
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions`.

## Permissions

| Permission | Why |
|-----------|-----|
| `storage` | Persist settings and categorizations |
| `activeTab` | Verify sender tab context |
| `https://github.com/*` | Content script injection |

## Future

- **Encryption** — `shared/storage.ts` has TODO markers where an encryption layer should plug in. All secrets flow through `get/set`, so adding encrypt/decrypt transforms requires no other code changes.
- **Auto-lock** — Secrets can be locked after inactivity with a background timer.
- **Additional providers** — Implement `AiProviderClient` interface and add a case in `buildClient()`.
