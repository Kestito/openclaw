# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenClaw is a personal AI assistant platform that runs on your own devices and connects to 40+ messaging channels (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, Matrix, etc.). It comprises a Gateway (control plane), extensible channel plugins, multi-model AI agent support, and native apps for macOS/iOS/Android.

## Build, Test, and Development Commands

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install dependencies |
| `pnpm build` | Full build (tsdown + plugin SDK + assets) |
| `pnpm check` | Format check + lint + type-check (run before commits) |
| `pnpm tsgo` | TypeScript type-checking only |
| `pnpm lint` | Oxlint (type-aware) |
| `pnpm lint:fix` | Lint fix + format |
| `pnpm format` | Oxfmt format (--write) |
| `pnpm format:check` | Oxfmt check only |
| `pnpm test` | Unit + integration tests (vitest, parallelized) |
| `pnpm test:coverage` | Tests with V8 coverage report |
| `pnpm test:e2e` | End-to-end tests |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:live` | Live API tests (needs `OPENCLAW_LIVE_TEST=1`) |
| `pnpm openclaw ...` | Run CLI in dev mode |
| `pnpm dev` | Run CLI in dev mode (alias) |
| `pnpm gateway:dev` | Gateway dev mode (skips channel init) |
| `pnpm ui:build` / `pnpm ui:dev` | Build/dev the control UI |

**Runtime**: Node 22+ required. Prefer Bun for TypeScript execution (`bun <file.ts>`).
**Package manager**: pnpm 10.23+ (primary), bun also supported. Keep `pnpm-lock.yaml` in sync.
**Committing**: Use `scripts/committer "<msg>" <file...>` instead of manual `git add`/`git commit`.

## Architecture

### Monorepo Layout (pnpm workspaces)

```
src/                    # Main source code (~50 subdirectories by domain)
  gateway/              # WebSocket server, control plane, multi-agent orchestration
  agents/               # AI agent execution, model scanning, sandboxing, tools
  channels/             # Core messaging abstractions and routing
  config/               # Config loading, Zod schema validation, migrations
  cli/                  # CLI builder, argument parsing, prompts
  commands/             # CLI command implementations
  providers/            # Model provider adapters (Anthropic, OpenAI, Bedrock, etc.)
  plugins/              # Plugin runtime, registry, loading
  plugin-sdk/           # Public plugin API exports (~100+ types)
  infra/                # System utilities (ports, dotenv, errors, paths)
  media/                # Image/audio processing
  routing/              # Message routing logic
  telegram/discord/     # Core channel implementations
  slack/signal/imessage/
  web/webchat/
extensions/             # 40+ channel plugin packages (workspace packages)
ui/                     # Control UI (Vite + Lit web components)
skills/                 # 50+ pre-built skills (Apple Notes, Spotify, GitHub, etc.)
apps/                   # Native apps
  macos/                # Swift macOS app
  ios/                  # Swift iOS app
  android/              # Kotlin Android app
docs/                   # Mintlify documentation (docs.openclaw.ai)
```

### Key Patterns

- **Plugin system**: Extensions in `extensions/*/` with `openclaw.plugin.json` manifests. Plugin-only deps go in the extension `package.json`, not root. Runtime resolves `openclaw/plugin-sdk` via jiti alias.
- **Config system**: Main config at `~/.openclaw/openclaw.json`. Zod-validated schemas in `src/config/`. State directory at `~/.openclaw/`.
- **CLI progress**: Use `src/cli/progress.ts` (osc-progress + @clack/prompts spinner). Don't hand-roll spinners.
- **Terminal output**: Use `src/terminal/table.ts` for tables, `src/terminal/palette.ts` for colors (no hardcoded colors).
- **Tool schemas**: Avoid `Type.Union` in tool input schemas (no `anyOf`/`oneOf`/`allOf`). Use `stringEnum`/`optionalStringEnum` for string lists. Avoid raw `format` property names.
- **Dependency injection**: Use existing `createDefaultDeps` patterns.

### Testing

- **Framework**: Vitest 4 with V8 coverage (70% lines/branches/functions/statements thresholds)
- **Naming**: `*.test.ts` colocated with source; `*.e2e.test.ts` for E2E; `*.live.test.ts` for real API
- **Test workers**: Max 16 (do not increase)
- **Test data**: Never use real PHI; use synthetic data generators
- **Setup**: `test/setup.ts` provides isolated test home, channel mocking, stubbed outbound adapters

## Coding Conventions

- TypeScript ESM, strict mode. Avoid `any` without justification.
- Formatting/linting: Oxlint + Oxfmt. Run `pnpm check` before commits.
- Files under ~500 LOC (guideline). Split/refactor for clarity.
- Naming: **OpenClaw** in product/docs headings; `openclaw` for CLI/package/paths/config keys.
- Brief comments for tricky logic only.
- Patched dependencies (`pnpm.patchedDependencies`) must use exact versions (no `^`/`~`). Patching requires explicit approval.
- Never update the Carbon dependency.

## Commit & PR Guidelines

- Use `scripts/committer "<msg>" <file...>` for scoped commits
- Concise, action-oriented messages: `CLI: add verbose flag to send`
- Group related changes; don't bundle unrelated refactors
- Full maintainer PR workflow: `.agents/skills/PR_WORKFLOW.md`
- PR guide: `docs/help/submitting-a-pr.md`

## Multi-Agent Safety

- Do not create/apply/drop `git stash` entries unless explicitly requested
- Do not create/remove/modify `git worktree` checkouts unless explicitly requested
- Do not switch branches unless explicitly requested
- When you see unrecognized files, keep going; commit only your changes
- Lint/format-only diffs: auto-resolve without asking

## Channel Development

When refactoring shared logic (routing, allowlists, pairing, commands, onboarding, docs), always consider **all** built-in + extension channels:
- Core: `src/telegram`, `src/discord`, `src/slack`, `src/signal`, `src/imessage`, `src/web`, `src/channels`, `src/routing`
- Extensions: `extensions/*` (msteams, matrix, zalo, voice-call, etc.)

When adding channels/extensions, update `.github/labeler.yml` and create matching GitHub labels.

## Documentation (Mintlify)

- Internal links: root-relative, no `.md`/`.mdx` extension (e.g., `[Config](/configuration)`)
- Anchors: `[Hooks](/configuration#hooks)` (avoid em dashes/apostrophes in headings)
- README links: absolute `https://docs.openclaw.ai/...` URLs
- Content must be generic: no personal device names/hostnames; use placeholders
- zh-CN docs are generated; don't edit unless explicitly asked. Pipeline: update English -> adjust glossary -> run `scripts/docs-i18n`

## Version Locations

When bumping versions, update all of: `package.json`, `apps/android/app/build.gradle.kts`, `apps/ios/Sources/Info.plist` + `apps/ios/Tests/Info.plist`, `apps/macos/Sources/OpenClaw/Resources/Info.plist`, `docs/install/updating.md`, `docs/platforms/mac/release.md`. Do **not** touch `appcast.xml` unless cutting a Sparkle release.

## Platform-Specific Notes

- **macOS**: Gateway runs as menubar app. Start/stop via OpenClaw Mac app or `scripts/restart-mac.sh`. Logs: `./scripts/clawlog.sh`. SwiftUI: prefer `@Observable`/`@Bindable` over `ObservableObject`.
- **iOS/Android**: "Restart apps" means rebuild + relaunch, not just kill/launch. Prefer real devices over simulators.
- **Docker**: `Dockerfile` uses multi-stage build. Entrypoint: `scripts/docker-entrypoint.sh`.

## Release

- Release channels: stable (`vYYYY.M.D`), beta (`vYYYY.M.D-beta.N`), dev (main HEAD)
- Always read `docs/reference/RELEASING.md` and `docs/platforms/mac/release.md` before release work
- Do not change version numbers without explicit consent
