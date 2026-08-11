# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A 3D personal library: React Three Fiber front end inside a Tauri 2 shell, with a
Rust core doing indexing, SQLite persistence, and format probing. `docs/plan.md`
is the living architecture doc and phase plan; read it before any structural change.

## Commands

```bash
npm install
npm run assets         # copy pdf.js standard_fonts + cmaps into public/ — gitignored, so needed after a fresh clone
npm run tauri:dev      # desktop app (native folder picker, real indexer)
npm run dev            # browser only, placeholder catalogue, no filesystem

npm run verify         # typecheck + build + Playwright + cargo test — the gate before calling work done
npm run typecheck
npm test               # Playwright, headless Chromium against the production bundle
npm run test:rust      # cargo test --manifest-path src-tauri/Cargo.toml
```

Single test / subset:

```bash
npx playwright test tests/collision.spec.ts
npx playwright test -g "walking moves the player"
npm run test:rust -- settings_round_trip
```

Beyond `verify` (needs a build first, Windows-only):

```bash
npm run tauri:build
npm run test:desktop   # node scripts/probe-desktop.mjs [libraryFolder] [exe] — launches the built
                       # exe with WebView2 remote debugging, attaches over CDP, drives scan→shelve→read
```

`scripts/make-test-library.mjs` generates a folder of throwaway PDFs/EPUBs to point
the desktop probe at. `npm run icon` regenerates the app icon from `scripts/make-icon.mjs`.

## The one architectural rule

**Nothing above `src/services/` may import `@tauri-apps/*`.** All filesystem access
goes through the `LibraryService` interface in [src/services/types.ts](src/services/types.ts).
Two drivers implement it — `tauriDriver` (IPC to Rust) and `browserDriver` (localStorage
+ a generated 1,700-book placeholder catalogue) — and [src/services/index.ts](src/services/index.ts)
picks one at startup via `isTauri()`. A driver advertises what it can do (`kind`,
`canPickFolder`, `canIndex`) and the UI disables controls accordingly rather than
failing at call time; unsupported operations throw `UnsupportedOperation`. This is
what keeps a future web build a third driver instead of a rewrite.

## How the pieces fit

**Layout is ids, positions are derived.** The persisted layout document is nothing
but `{ schemaVersion, rows: { "unit:row": [bookId, ...] } }`. Physical placement is
recomputed by packing each row left to right in [src/scene/shelving.ts](src/scene/shelving.ts),
so a book whose dimensions change pushes neighbours along instead of overlapping.
Rust stores this document verbatim (`get_layout`/`save_layout`) — the schema is owned
entirely by the front end.

**Book appearance is a pure function of index data.** [src/data/dimensions.ts](src/data/dimensions.ts)
derives thickness from page count or file size, and height/depth/colour from a hash
of the book id — arbitrary but stable, so a book always looks the same on the shelf.

**Book identity is content-based, not path-based.** `book_id` in
[src-tauri/src/index.rs](src-tauri/src/index.rs) hashes file length plus the first
64 KiB, so moving or renaming a file keeps its shelf position and progress.

**State is split by lifetime.** `state/store.ts` holds session/UI state (mode, crosshair
focus, held book, driver). `state/library.ts` holds the catalogue and shelving, reconciles
a saved layout against the latest scan on load, and debounces layout saves (600 ms).
`state/player.ts` and `state/metrics.ts` are plain mutable objects deliberately outside
zustand — they change every frame and must not trigger React renders.

**Interaction goes through instanced meshes.** Books and shelves are `InstancedMesh`;
[src/scene/refs.ts](src/scene/refs.ts) is a module-level handle so the raycaster in
`Interaction.tsx` can reach them. Collision is hand-rolled axis-separated AABB sliding
in [src/scene/collision.ts](src/scene/collision.ts) — no physics engine, deliberately,
which also keeps `wasm-unsafe-eval` out of the desktop CSP.

**Covers are rendered in the WebView, cached by Rust.** Rather than shipping pdfium,
the front end rasterises page one with pdf.js and posts it to `save_rendered_cover`.
Book bytes come back through the `read_book_file` command, *not* the asset protocol —
the asset scope stays empty so the WebView never gets broad disk access.

## Conventions

- Comments explain *why* a decision was made, not what the code does. Match that.
- TS is strict with `noUncheckedIndexedAccess` and `noUnusedLocals`; `tsconfig.json`
  covers `src`, `tests`, `scripts`, and the config files.
- `tests/collision.spec.ts` unit-tests pure modules through the Playwright runner (no
  browser); `tests/smoke.spec.ts` drives the real bundle. The browser tests reach the
  app through `window.__app` in [src/App.tsx](src/App.tsx) — a deliberate verification
  surface (teleport, look, stats, readForTest) that exists because pointer lock is
  unavailable headlessly. Extend it when a new behaviour needs covering.
- Assertions are on measurable facts (draw calls, triangles, frames, zero console errors);
  screenshots are for a human to glance at, not for comparison.
- Rust release profile is *not* `panic = "abort"` — the indexer catches per-file unwinds
  so one malformed book can't kill a scan.
- Fixed ports: Vite dev 5180, Playwright preview 5190, desktop CDP probe 9223.
