# AGENTS.md

## What this is

`opencode-eye` (repo dir is `opencode-vision`): an [opencode](https://opencode.ai)
plugin that routes image inspection to an eye-capable model when the active model
cannot see images. It is distributed as **raw TypeScript with no build step** —
`package.json` `main`/`exports` point directly at `plugin.ts`, and `files` ships
`plugin.ts` + `src/`. Edit source, not a `dist/`.

## Commands

- `npm test` — run all vitest suites (`tests/*.test.ts`, auto-discovered, no config file)
- `npm run test:watch` — vitest watch mode
- `npm run typecheck` — `tsc --noEmit`
- No lint, no build, no CI, no formatter config. There is no `npm run lint`.

## Architecture

Entrypoint `plugin.ts` wires the three moving parts:

- `chat.params` hook — warms the `Detector` cache (`src/detect.ts`) with the active
  model's `capabilities.input.image`.
- `chat.message` hook — strips image parts for non-eye models, writes them to the
  cache dir (`src/cache.ts`), and replaces them with a marker (`src/marker.ts`).
- `ask_image` tool (`src/tool.ts`) — reads an image file and calls `src/eye.ts`
  `describeImage`, which creates an internal session, prompts the eye model, polls
  for the assistant reply, then schedules the session's deletion.

Supporting: `src/sdk.ts` `unwrap()` — SDK results may carry a `.data` field; every
client call goes through it. `src/cache.ts` `resolveCacheDir()` defaults to
`~/.cache/opencode-eye`, overridable via the `cacheDir` option.

## Gotchas

- **Only PNG/JPEG/GIF/WEBP are cacheable.** `src/cache.ts` validates mime via magic
  bytes, not the declared `mime`. Unsupported formats (SVG, HEIC, BMP…) get an
  error marker, never a cached file.
- **The marker format is load-bearing.** Tests assert it with regex
  (`[Attached image <path> — use the ask_image tool to inspect its contents]`).
  Change it only together with `tests/plugin.test.ts` and `src/marker.ts`.
- **Internal eye sessions must not be stripped.** `plugin.ts` tracks their IDs in
  the `internalSessions` Set (registered via `onSessionCreated`/`onSessionDeleted`
  from `src/eye.ts`) so the `chat.message` hook bails on them — otherwise the eye
  session's own images would re-trigger stripping in an infinite loop. The eye
  session is created with `tools: { "*": false }` and the title
  `opencode-eye · temporary (auto-deletes)`. Eye sessions are **not** deleted
  immediately: `describeImage` schedules deletion after `sessionLifetimeMs`
  (default 30 min, `0` = immediate), and the plugin sweeps stale sessions on
  startup via `sweepStaleEyeSessions`, matching the exact titles
  `opencode-eye · temporary (auto-deletes)` and the legacy
  `opencode-eye image inspection`. `onSessionDeleted` fires once the delete settles (success or failure), so
  `internalSessions` stays accurate for the session's whole life.
- **Tests mock the opencode SDK client by hand** with a specific shape:
  `client.config.providers()` returning `{ data: { providers: [...] } }` and
  `client.session.{create,prompt,messages,delete}`. See `tests/plugin.test.ts`.
  When you touch code that calls the client, extend the mocks to match.
- `eye.model` is `provider/model`; `parseModelSpec` in `src/eye.ts` splits on the
  first `/`. `""` (unset) means the plugin can only block images, not route them.
- `ask_image` answers are cached in-memory per plugin instance, keyed by
  `path + size/mtime + question` (`src/tool.ts`), so changed files re-inspect.
- `@opencode-ai/plugin` is a **peer dependency**; `types` come from it.
- `README.md` is the detailed behavior/spec source — keep it in sync with behavior
  changes.

## Verification

Run `npm run typecheck && npm test` before claiming work complete.
