# Starshelf — Agent Guidelines

## Overview

Starshelf is a browser extension (WXT) that auto-categorizes GitHub starred repos using AI. It detects star actions on GitHub, fetches repo metadata, generates a category via a configurable AI provider, and assigns the repo to a GitHub user list. No JS framework — vanilla TypeScript DOM throughout.

## Tech Stack

- **TypeScript 5.9** (strict), **WXT 0.20**, **Vite**, **Bun** (runtime + package manager)
- **Vitest** for testing, **Prettier** for formatting
- AI providers: Anthropic, OpenAI, OpenCode (pluggable via `AiProviderClient` interface)
- APIs: GitHub REST + GraphQL, browser extension APIs (`browser.storage`, `browser.runtime`)

## Build & Test Commands

| Command                 | Purpose                                    |
| ----------------------- | ------------------------------------------ |
| `bun install`           | Install deps (runs `wxt prepare`)          |
| `bun run dev`           | Chrome dev with hot reload                 |
| `bun run dev:firefox`   | Firefox dev                                |
| `bun run build`         | Production build (Chrome)                  |
| `bun run build:firefox` | Production build (Firefox)                 |
| `bun run compile`       | TypeScript type-check (no emit)            |
| `bun run test`          | Run Vitest (once)                          |
| `bun run check`         | CI gate: format check + type-check + tests |
| `bun run format`        | Format with Prettier                       |

## Architecture

```
src/
├── entrypoints/
│   ├── background.ts       → Service worker (orchestration, message routing)
│   ├── content.ts          → Content script (MutationObserver for star detection)
│   └── popup/              → Settings UI + batch categorization (vanilla DOM)
├── shared/
│   ├── types/messages.ts   → Typed message protocol (discriminated unions)
│   ├── storage.ts          → Extension storage abstraction
│   ├── github.ts           → URL parsing, REST API
│   ├── github-lists.ts     → GraphQL list operations
│   ├── logger.ts           → DEV-only logging
│   └── providers/          → AI client implementations
```

**Message flow:** Content script → `RuntimeMessage` → Background → AI provider → GitHub GraphQL mutation → response back.

## Code Conventions

- **No frameworks** — use vanilla DOM manipulation with the `h()` helper in popup
- **Relative imports** with `@/` alias for `src/` (e.g., `import { storage } from "@/shared/storage"`)
- **Interfaces** in PascalCase, **functions** in camelCase, **constants** in UPPER_SNAKE_CASE
- **DEV-only logging** — wrap in `if (import.meta.env.DEV)` or use the `logger` module
- **Type-first** — use `import type` for type-only imports
- **Discriminated unions** for message types and state (e.g., `BatchStatus` on `state`)
- **Unicode-aware** string handling — use `\p{}` property escapes for emoji/text

## Key Patterns

- **In-flight deduplication:** `Set<string>` prevents duplicate categorization during rapid star clicks
- **Batch concurrency:** Custom `Semaphore` class + 50ms delays between GraphQL mutations
- **Dual storage:** `browser.storage.local` for settings (persistent), `browser.storage.session` for batch progress (ephemeral)
- **Provider agnosticism:** All AI providers implement `AiProviderClient` interface with shared `buildPrompt()`
- **MutationObserver re-observation:** GitHub Turbo navigation replaces the star button, so content script must re-observe after each navigation

## Release Process

- Follows [SemVer](https://semver.org) and [Keep a Changelog](https://keepachangelog.com)
- Release notes: individual files in `release-notes/v{version}.md`
- CHANGELOG.md updated per release
- Version synced from `package.json` to manifest via `wxt.config.ts`
