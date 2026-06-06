# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
bun run dev           # Dev with hot reload (Chrome)
bun run dev:nobrowser # Dev without opening a browser
bun run dev:firefox   # Dev mode for Firefox
bun run build         # Production build (Chrome)
bun run build:firefox # Production build (Firefox)
bun run zip           # Package extension
bun run compile       # TypeScript type-check (tsc --noEmit)
bun run test          # Run all tests (vitest run)
bunx vitest           # Test watch mode
bun run format        # Prettier format
bun run format:check  # Prettier check only
bun run check         # CI: format:check + compile + test
```

## Architecture

Starshelf is a **browser extension** built with [WXT](https://wxt.dev) (which wraps `web-ext` and Vite), using **vanilla TypeScript** (no React/Preact).

### Entry Points (WXT convention under `src/entrypoints/`)

| Entry Point | File | Role |
|---|---|---|
| Background service worker | `background.ts` | Hears `repoStarClicked`, `regenerateCategory`, `startBatch`/`cancelBatch` messages. Orchestrates all API calls: GitHub GraphQL for star lists, AI provider for categorization, and sends status back to the content script via `browser.tabs.sendMessage`. |
| Content script | `content.ts` | Runs on `https://github.com/*`. Detects star button clicks via a `MutationObserver` on the `.starring-container`, shows an overlay ("Shelving...", category name, error). Handles overlay hover/fade and the refresh (regenerate) button. |
| Popup | `popup/main.ts`, `popup/batch.ts` | Settings page for GitHub token, AI provider & API key, model selection, list privacy, formatting toggles, and batch categorization controls. |

### Shared Modules (`src/shared/`)

| Module | Purpose |
|---|---|
| `github.ts` | `parseRepoFromUrl()`, `isRepoPage()`, `fetchRepoMetadata()` (REST API for description/language + separate topics endpoint with `mercy-preview` header), `checkStarStatus()` |
| `github-lists.ts` | All GitHub GraphQL operations: `validateToken`, `getViewerLists`, `createUserList`, `getRepoNodeId`, `updateUserListsForItem`, `starRepository`, `deleteUserList`, `getAllListedRepoIds`, `batchCategorize`. Also `fuzzyMatchListName()` for normalized name matching and `streamUncategorizedRepos()` async generator for batch operations. |
| `storage.ts` | `ExtensionSettings` interface + `ExtensionStorage` class wrapping `browser.storage.local`. Includes `bootstrap()` for env-based seeded settings and dev-only env overrides via `VITE_*` vars. |
| `types/messages.ts` | Typed message protocol — union types `ContentMessage`, `PopupMessage`, `BackgroundMessage`, `RuntimeMessage`. All message-passing uses these types. |
| `logger.ts` | Dev-only console logging (no-ops in production). |
| `dev-bootstrap.ts` | Seeds settings from `.env.development` on first dev run. |
| `test-utils.ts` | Vitest helpers: `setupFetchMock()`, `mockJsonResponse()`, `mockGraphqlResponse()`, `graphqlDispatcher()`. |

### Provider System (`src/shared/providers/`)

- `base.ts` defines `AiProviderClient` interface (`categorize()`, `categorizeBatch()`, `listModels()`) + `buildPrompt()` / `buildBatchPrompt()` / `cleanCategory()` / `parseBatchResponse()`
- `factory.ts` creates the right client via `createProviderClient(provider, config)`
- Concrete providers: `anthropic.ts` (Messages API), `openai.ts` (Chat Completions), `opencode.ts` (OpenAI-compatible at `opencode.ai/{zen,go}/v1`)

### Key Design Patterns

1. **Message protocol**: All communication content↔background is typed in `messages.ts`. Content sends `repoStarClicked`/`regenerateCategory`; popup sends `startBatch`/`cancelBatch`; background sends `updateStarStatus`/`batchProgress`. Responses from background to popup use `sendMessage()` return values (sync replies).

2. **In-flight dedup**: `inFlight` Set in background prevents concurrent processing of the same repo.

3. **State tracking**: `states` Map keeps `StarcorderState` (metadata, repoNodeId, listId, listName, isNewList) per repo for regenerate operations.

4. **Batch processing**: `batchCategorize()` streams all starred repos via GraphQL pagination, filters out already-listed repos, then processes in chunks of `AI_BATCH_SIZE` (10) using a `Semaphore` concurrency limiter (10 concurrent list mutations).

5. **Error handling**: `withErrorHandling()` wraps every step — sends status updates to content script on failure, returns `null` on error for early exit chains.

6. **Prompt system**: `buildPrompt()` detects existing list patterns (emoji usage, colon-format categories) from existing list names and adjusts instructions accordingly. Supports auto-format, explicit overrides, and rejection feedback for regeneration.

7. **CSS variables**: Both the popup and overlay use CSS custom properties with `prefers-color-scheme: dark` support — no JS-based theme switching.

## Testing

- Uses **Vitest** with the `WxtVitest()` plugin for `@/` path alias resolution
- All HTTP calls are mocked at the `fetch` level using `vi.mocked(fetch).mockResolvedValue(...)`
- Helper: `setupFetchMock()` stubs `global.fetch` before each test
- Helper: `mockJsonResponse(data, status?)`, `mockHttpError(status, body?)`, `mockGraphqlResponse(data)`, `graphqlDispatcher(overrides)`
- Use `vi.spyOn` / `mockRestore` for per-test fetch mocks
- To add a new test, follow existing patterns in `*.test.ts` files

## Notable Config

- **tsconfig.json** just extends `.wxt/tsconfig.json` (generated by WXT on `postinstall`)
- **vitest.config.ts** uses `WxtVitest()` plugin from `wxt/testing/vitest-plugin`
- **wxt.config.ts** defines manifest (permissions, host_permissions) and dev browser profile settings (persistent Chromium profile, stable extension key, auto-open GitHub)
- **Dev bootstrap**: Copy `.env.development.example` to `.env.development` to seed API keys from env vars
