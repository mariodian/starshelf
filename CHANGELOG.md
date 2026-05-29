# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v0.0.3] - 2026-05-29

### Fixed

- **Chrome Webstore** key now set correctly in extension configuration

## [v0.0.2] - 2026-05-29

### Added

- **Emoji and formatting** options in popup settings: toggle emoji prefixes, category-prefix format (`Category: Name`), and auto-format mode that detects existing list naming conventions
- Auto-detection of emoji usage and colon-separated category prefixes in existing star lists to match formatting style
- Prompt-level formatting hints passed to all AI providers (**Anthropic**, **OpenAI**, **OpenCode**) based on user preferences
- Checkbox styling and disabled-state visuals in the popup

### Changed

- Flash messages now use background-filled styling for better visibility
- Storage schema extended with `enableEmojis`, `enableCategoryPrefix`, and `autoFormat` settings (defaults: `false`, `false`, `true`)

## [v0.0.1] - 2026-05-29

### Added

- AI-powered star categorization with **Anthropic** (Claude), **OpenAI** (GPT), and **OpenCode** providers
- Browser extension popup for quick access to categorized stars
- GitHub star repository management (star and unstar directly from the extension overlay)
- GitHub lists integration with token-based authentication
- Configurable settings for list privacy and AI provider model selection
- Persistent dev profile support via environment variables
- Logger utility for consistent debug and error logging
- Unit tests for categorization engine and GitHub API interactions
- Bug report and feature request issue templates
- Screenshots and brand assets for Chrome Web Store listing
- Changelog generator skill documentation

### Changed

- Project renamed to **Starshelf** with updated branding and assets
- Source file structure reorganized for clarity and maintainability
- Code formatting standardized across all TypeScript, CSS, and HTML files
- Settings page streamlined by removing save buttons and debounce logic
- Removed standalone options page and associated styles in favor of popup-based settings

### Fixed

- Anthropic provider now sends the required `anthropic-dangerous-direct-browser-access` header
- Clean category function properly integrated across all AI providers
