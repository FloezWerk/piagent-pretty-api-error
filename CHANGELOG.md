# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-09-19

### Changed

- The npm package page now shows the changes of the published version: the
  CHANGELOG section is inlined into the README, instead of only linking to
  `CHANGELOG.md`. Gitea and the GitHub mirror show the same README, so the notes
  of the current release are visible there too. The README also carries
  npm/license/CI/changelog badges.
- GitHub release notes for a version come from its CHANGELOG section (same text
  as the npm package page) instead of a generated commit list.
- Release helpers live in `scripts/` (not published): README block sync, which
  `npm run check` and CI verify, plus the release-notes body for `release.yml`.

## [0.1.1] - 2026-09-19

### Changed

- Error headline is now a styled panel: column-aligned bold labels
  (`Provider`/`Model`/`Reason`/`Upstream`/`Code`/`Hint`), hanging indent for
  wrapped values, inner padding, bold bright title
- Darker, less glaring red for the main panel (`rgb(96,22,22)`); raw data shown
  in its own directly attached, darker panel (`rgb(54,14,14)`)
- Raw data with JSON payloads are now pretty-printed (2-space indent, label
  `Raw data (JSON):`, leading status kept as headline); long values/URLs wrap
  with a hanging indent; payloads above 8000 chars are truncated
- Two spaces after the error icon (U+2716 is drawn as a 2-cell emoji in many
  terminals and would otherwise swallow the following space)
- Colors prefer 24-bit via `getCapabilities().trueColor`; 256-color fallback

### Added

- `AGENTS.md` (English-only rule, project layout, checks, remote conventions)
- CI workflow (bundle smoke test, package content check, no-German guard) and
  tag-triggered release workflow (version guards, npm publish with provenance,
  GitHub release with the tarball)
- npm package metadata: `@floez-werk` scope, `files`, scripts, repository,
  homepage, bugs; MIT `LICENSE`

## [0.1.0] - 2026-09-18

### Added

- Initial release: renders provider/API errors (e.g. OpenRouter 429 JSON
  payloads) as a readable red panel instead of raw JSON, with `ctrl+o`
  (`app.tools.expand`) toggling the raw data
- The detail panel is a session entry (not part of the LLM context), attached
  only at `agent_settled` for final errors
- Retry semantics are preserved: the short error line is only applied when
  `isRetryableAssistantError` classifies it identically
- `/apierrors preview|on|off` command

<!-- Versions link to their GitHub release page (created by release.yml), while
     [Unreleased] links to the comparison against the last tag. -->
[Unreleased]: https://github.com/FloezWerk/piagent-pretty-api-error/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/FloezWerk/piagent-pretty-api-error/releases/tag/v0.1.2
[0.1.0]: https://github.com/FloezWerk/piagent-pretty-api-error/releases/tag/v0.1.0

<!-- 0.1.1 was released to npm without a git tag, so it links to npm (0.1.2 and
     later are tagged, hence they link to their GitHub release page). -->
[0.1.1]: https://www.npmjs.com/package/@floez-werk/piagent-pretty-api-error/v/0.1.1
