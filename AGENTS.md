# Starshelf — Agent Guidelines

## Overview

Starshelf is a browser extension (WXT) that auto-categorizes GitHub starred repos using AI. It detects star actions on GitHub, fetches repo metadata, generates a category via a configurable AI provider, and assigns the repo to a GitHub user list. No JS framework — vanilla TypeScript DOM throughout.

**Stack:** TypeScript 5.9 (strict), WXT 0.20, Vite, Bun, Vitest, Prettier. Providers: Anthropic, OpenAI, OpenCode via `AiProviderClient`. APIs: GitHub REST + GraphQL, `browser.storage`, `browser.runtime`.

## Commands

| Command                 | Purpose                                    |
| ----------------------- | ------------------------------------------ |
| `bun run dev`           | Chrome dev with hot reload                 |
| `bun run dev:firefox`   | Firefox dev                                |
| `bun run compile`       | TypeScript type-check (no emit)            |
| `bun run test`          | Run Vitest (once)                          |
| `bun run check`         | CI gate: format check + type-check + tests |

## Architecture

```
src/entrypoints/   background.ts, content.ts, popup/
src/shared/        github.ts, github-lists.ts, batch-categorize.ts, storage.ts, providers/
```

**Message flow:** Content script → `RuntimeMessage` → Background → AI provider → GitHub GraphQL mutation → response back.

Content sends `repoStarClicked` / `regenerateCategory`. Popup sends `startBatch` / `cancelBatch`. Background sends `updateStarStatus` / `batchProgress`. Popup replies use `sendMessage()` return values.

## Conventions

- `@/` alias for `src/`
- DEV-only logging via `logger` or `if (import.meta.env.DEV)`
- Unicode-aware strings — `\p{}` property escapes for emoji/text
- Popup DOM via the `h()` helper

## Traps

- **In-flight dedup:** a `Set<string>` blocks duplicate categorization on rapid star clicks
- **Batch:** `batchCategorize()` pages starred repos, skips already-listed ones, chunks by `AI_BATCH_SIZE` (10), and uses a `Semaphore` plus 50ms delays between GraphQL mutations
- **Dual storage:** `browser.storage.local` for settings, `browser.storage.session` for batch progress
- **Turbo:** GitHub navigation replaces the star button — the content script must re-observe after each navigation
- **Prompts:** `buildPrompt()` infers emoji and colon-format from existing list names; regenerate can pass rejection feedback
- **Theme:** CSS custom properties and `prefers-color-scheme` — no JS theme switching
- **Tests:** mock `fetch`; helpers live in `test-utils.ts`. Vitest uses `WxtVitest()` so `@/` resolves
- **Dev keys:** copy `.env.development.example` to `.env.development`

## Release

SemVer and Keep a Changelog. Notes in `release-notes/v{version}.md`. Version synced from `package.json` to the manifest via `wxt.config.ts`.
