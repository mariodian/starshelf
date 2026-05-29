---
name: changelog-generator
description: >
  For each release, generate a technical CHANGELOG.md entry,
  a public release note file, and an updated release index —
  all three committed together before the release tag is pushed.
---

## Prerequisites

Before writing anything, collect every commit since the last tag:

```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline
```

Synthesize those commits into human-readable entries. Never paste raw
commit hashes, subjects, or git log output into any output file.

Get the new version from package.json and use it verbatim, including any prerelease suffix (`-dev`, `-alpha.1`, `-beta`, `-rc.2`).

---

## Outputs (all three are required per release)

| File                        | Audience                    | Purpose                                 |
| --------------------------- | --------------------------- | --------------------------------------- |
| `CHANGELOG.md`              | Contributors / maintainers  | Technical history, SemVer-indexed       |
| `release-notes/vVERSION.md` | End users / GitHub Releases | Benefit-driven release body             |
| `RELEASE_NOTES.md`          | End users                   | Root index linking to per-version files |

All three files must be committed together **before** the release tag is pushed.
If `release-notes/vVERSION.md` is missing for a tagged release, treat that
as an incomplete release-preparation state.

---

## CHANGELOG.md

### Header (include once, at the top of the file)

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
```

### Version entry format

```markdown
## [Unreleased] ← keep only when unreleased changes exist

## [vVERSION] - YYYY-MM-DD ← newest first; ISO 8601 date

### Added

- Past-tense bullet. Bold **key terms** only when it aids readability.

### Changed

### Deprecated

### Removed

### Fixed

### Security
```

### Rules

- Use the **exact version string from the repo tag**, including any
  prerelease suffix (`-dev`, `-alpha.1`, `-beta`, `-rc.2`). Do not normalize.
- Omit any category section that has no entries.
- List versions in **reverse chronological order** (newest first).
- Keep an `## [Unreleased]` section at the top **only** when there are
  unreleased changes to document.
- Technical detail is encouraged for contributor clarity, but keep each
  bullet concise — one verb-led sentence per change.
- Mark yanked releases: `## [vVERSION] - DATE [YANKED]`

---

## release-notes/vVERSION.md

### Structure

```markdown
# vVERSION

One or two sentences: what is new and why it matters to the user.

## Highlights

- Benefit-driven bullet (e.g., "Starshelf now categorizes repos in under a second")

## Fixes

- Plain-English description of resolved problems

## Notes ← optional

Use for install changes, platform caveats, migration steps,
or prerelease/dev-build warnings.
```

### Rules

- **Users first.** No class names, function names, file paths, package
  identifiers, or implementation jargon — unless they are part of the
  public product surface.
- Omit empty sections entirely.
- For prerelease builds (`-dev`, `-alpha`, `-beta`, `-rc`), add a clear
  "This is a preview/dev build" callout in `## Notes`.
- If the release is mostly internal changes, say so plainly and keep the
  file brief rather than inventing user value.
- This file is used directly as the GitHub Release body — write accordingly.

---

## RELEASE_NOTES.md

### Header (include once)

```markdown
# Release Notes

Public release history for Starshelf.
For full technical details, see [CHANGELOG.md](./CHANGELOG.md).
```

### Table format (newest row first)

```markdown
| Version                                 | Date       | Summary                      |
| --------------------------------------- | ---------- | ---------------------------- |
| [vVERSION](./release-notes/vVERSION.md) | YYYY-MM-DD | One-line user-impact summary |
```

### Rules

- This file is an **index only** — do not duplicate release note content here.
- **Prepend** a new row to the top of the table for each stable release.
- **Do not add prerelease versions** (`-dev`, `-alpha`, `-beta`, `-rc`) to
  the table. Their files exist in `release-notes/` but are not part of the
  stable release history.
- Keep the summary under 60 characters and describe user impact, not
  implementation.
- If a release is yanked, append ` [YANKED]` to the version link text in
  the table.

---

## Quick decision checklist

Before committing, verify:

- [ ] `git log` was run; no raw hashes appear in any output file
- [ ] Version string matches the repo tag exactly (including prerelease suffix)
- [ ] `CHANGELOG.md` entry uses only non-empty Keep-a-Changelog categories
- [ ] `release-notes/vVERSION.md` contains no code identifiers or jargon
- [ ] Prerelease builds are labeled as preview/dev in `## Notes`
- [ ] `RELEASE_NOTES.md` table row added only for stable releases
- [ ] All three files are staged in the same commit, before the tag is pushed
