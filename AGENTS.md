# AGENTS.md

Instructions for AI coding agents (e.g. pi coding agent) working in this repo.

## Keep this file short

This file is the **first rule**: keep `AGENTS.md` very short and concise -
prefer bullet points over prose. When adding or editing a rule, condense,
never expand.

## Language: English only

Everything in this repo is written in **English** and must stay English:

- README/docs, code comments/docstrings, user-facing strings
  (`ctx.ui.notify(...)`, command descriptions, help/error texts)
- Never introduce German (or any other language) text; when touching an
  existing string, keep it English.

## Project layout

- `extensions/api-error-format.ts` - the Pi extension (single entry point)
- `scripts/` - release helpers (README changelog block, release notes); not published
- `CHANGELOG.md` - user-facing changes per version (Keep a Changelog format)
- `.spec-flow/` - tooling state, not part of the extension

## Changelog is mandatory

- Every **user-facing** change/feature gets a bullet under `## [Unreleased]` in
  `CHANGELOG.md`, in the same commit that introduces it
  (categories: `Added`, `Changed`, `Fixed`, ...).
- Internal refactors, CI/tooling tweaks and docs-only fixes: no changelog entry.
- `release.yml` rejects a tag without a matching `## [X.Y.Z]` entry - a
  forgotten entry surfaces at release time at the latest.
- `README.md` shows the release notes of the current version in the marked
  block: generated from `CHANGELOG.md` via `npm run readme` (Gitea, the GitHub
  mirror and npm render the README). Never edit that block by hand.

## Checks

- Local: `npm run check` (README release-notes block is up to date, bundle smoke
  test, `npm pack --dry-run`; the same scripts run in CI, see
  `.github/workflows/ci.yml`). Peers are bundled by pi, so there is nothing to
  install.
- `npm run readme` - regenerate the README release-notes block from `CHANGELOG.md`.
- Visual: `pi -e ./extensions/api-error-format.ts` -> `/apierrors preview`
  (`ctrl+o` toggles raw data, `/apierrors on|off` the red background).
- Before committing: quick "no German" review of all touched strings/docs.

## Releasing

1. `CHANGELOG.md`: move `[Unreleased]` bullets into `## [X.Y.Z] - YYYY-MM-DD`
2. Bump `"version"` in `package.json` to `X.Y.Z`, run `npm run readme`, commit
   both (the README block then already shows the notes on Gitea)
3. `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`
   -> Gitea mirrors the tag -> `release.yml`: npm publish (provenance) +
   GitHub release (both with the CHANGELOG section as notes) -> package appears
   automatically on pi.dev/packages

## Repository: local Gitea + public GitHub mirror

- Everything committed here becomes publicly readable on GitHub.
- **Never commit sensitive data** (keys, tokens, passwords, personal data) -
  source, docs, examples and history included. Use env vars or untracked files.
- `origin` = Gitea (`ssh://git@gitea/FloezWerk/piagent-pretty-api-error.git`),
  push target. Public GitHub URL:
  `git@github.com:FloezWerk/piagent-pretty-api-error.git`.
- Install instructions always use the GitHub URL or the npm package, never the
  Gitea path (internal):
  `pi install git:git@github.com:FloezWerk/piagent-pretty-api-error.git` or
  `pi install npm:@floez-werk/piagent-pretty-api-error`
- Exception: refreshing the locally installed copy uses the Gitea source it
  came from: `pi update ssh://git@gitea/FloezWerk/piagent-pretty-api-error.git`
