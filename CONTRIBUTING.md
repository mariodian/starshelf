# Contributing to Starshelf

Thanks for your interest in contributing to Starshelf.

## Table of Contents

- [Fork the Repository](#fork-the-repository)
- [Clone Your Fork](#clone-your-fork)
- [Create a New Branch](#create-a-new-branch)
- [Development](#development)
- [Code Style](#code-style)
- [Testing](#testing)
- [Committing Your Work](#committing-your-work)
- [Release Tagging](#release-tagging)
- [Open a Pull Request](#open-a-pull-request)
- [Review Process](#review-process)

## Fork the Repository

Fork this repository to your GitHub account by clicking the "Fork" button at the top right.

## Clone Your Fork

Clone your forked repository to your local machine:

```bash
git clone https://github.com/YourUsername/starshelf.git
cd starshelf
```

## Create a New Branch

Create a new branch for your contribution:

```bash
git checkout -b your-branch-name
```

Choose a branch name related to your work.

## Development

### Setup

```bash
bun install
bun run dev
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions`.

### Commands

| Command                 | Description                              |
| ----------------------- | ---------------------------------------- |
| `bun run dev`           | Start dev mode with hot reload (Chrome)  |
| `bun run dev:nobrowser` | Start dev mode without opening a browser |
| `bun run dev:firefox`   | Start dev mode for Firefox               |
| `bun run build`         | Production build (Chrome)                |
| `bun run build:firefox` | Production build (Firefox)               |
| `bun run zip`           | Package extension for Chrome             |
| `bun run zip:firefox`   | Package extension for Firefox            |
| `bun run compile`       | TypeScript type-check (no emit)          |
| `bun run format`        | Format code with Prettier                |
| `bun run format:check`  | Check formatting without modifying files |
| `bun run test`          | Run tests with Vitest                    |
| `bun run check`         | Format check + type-check + tests (CI)   |

### Architecture

Starshelf is a browser extension built with [WXT](https://wxt.dev). It has three main entry points:

- **Background** (`src/entrypoints/background.ts`) — Service worker handling secrets, API calls, settings, and categorization logic.
- **Content** (`src/entrypoints/content.ts`) — Content script that detects star-button clicks on GitHub and displays status overlays.
- **Popup** (`src/entrypoints/popup/`) — Settings UI for configuring AI providers, API keys, and models.

Shared modules live in `src/shared/`:

| Module                   | Purpose                                      |
| ------------------------ | -------------------------------------------- |
| `types/messages.ts`      | Typed content ↔ background message protocol  |
| `storage.ts`             | Extension storage abstraction                |
| `github.ts`              | URL parser, repo metadata, star verification |
| `categorizer.ts`         | Orchestrates AI categorization               |
| `providers/base.ts`      | `AiProviderClient` interface                 |
| `providers/anthropic.ts` | Anthropic Messages API                       |
| `providers/openai.ts`    | OpenAI Chat Completions + model listing      |
| `providers/opencode.ts`  | OpenCode Zen / Go (OpenAI-compatible)        |

### Development Notes

- Run `bun run dev` for the standard Chrome development flow with hot reload.
- Use `bun run dev:nobrowser` to start the dev server without automatically opening a browser.
- Use `bun run dev:firefox` to test against Firefox.
- `bun install` automatically runs `wxt prepare` (via `postinstall`) to set up WXT type stubs.
- The extension communicates between content scripts and the background service worker via typed messages defined in `src/shared/types/messages.ts`.
- API keys are stored in extension storage (accessed via the background service worker only).

## Code Style

Starshelf uses TypeScript across the board. Before submitting, run:

```bash
# Run all checks (format, type-check, tests)
bun run check
```

Or individually:

```bash
# Type-check
bun run compile

# Format
bun run format
```

Guidelines:

- All messages between content scripts and the background worker must use the typed interfaces in `shared/types/messages.ts`.
- Provider clients must implement the `AiProviderClient` interface from `shared/providers/base.ts`.
- Prefer explicit return types on exported functions.
- Keep content script logic minimal — delegate API calls and storage to the background worker.

## Testing

Starshelf uses [Vitest](https://vitest.dev) with the WXT Vitest plugin. Run tests with:

```bash
bun run test
```

Or for watch mode:

```bash
bunx vitest
```

Key guidelines:

- Import test helpers from `vitest` (`describe`, `it`, `expect`, `vi`).
- Use `vi.fn()` to create mock functions and `vi.mock()` to mock modules.
- Mock external API calls (GitHub API, AI providers) at the fetch level.
- Save and restore `global.fetch` when mocking HTTP calls (`vi.spyOn` / `mockRestore`).
- The Vitest config (`vitest.config.ts`) uses `WxtVitest()` to resolve `@/` path aliases.
- Mock paths in `vi.mock()` use the same `@/` aliases as the source code (e.g., `@/shared/github`).

## Committing Your Work

Commit your changes:

```bash
git add .
git commit -m "Your commit message"
```

Keep commits focused and clear.

## Release Tagging

Release automation runs when a git tag matching `v*` is pushed.

### Tag from `main`

- Merge your feature branch into `main` first.
- Create and push release tags from `main` commits.

### Tag naming and build channel

- `vX.Y.Z` uses stable builds.
- `vX.Y.Z-suffix` (for example `v0.1.0-alpha.1`) is marked as a prerelease.

### Pre-push validations for version tags

When pushing a `v*` tag, `.githooks/pre-push` validates:

- `package.json` version matches the tag version without the `v` prefix.
- `CHANGELOG.md` contains a matching release heading.

Example: pushing `v0.1.0-alpha.1` requires:

- `package.json` version `0.1.0-alpha.1`
- a changelog heading `## [0.1.0-alpha.1]` or `## [v0.1.0-alpha.1]`

## Open a Pull Request

Open a Pull Request against the `main` branch. For major changes, open an issue first to discuss the approach.

## Review Process

- All PRs require at least one approving review before merging.
- CI must pass (`bun run check` — format check, type-check, and tests).
- Keep PRs scoped to a single change — small and focused is better than large and broad.
