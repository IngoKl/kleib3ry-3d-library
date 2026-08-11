# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A 3D personal library: React Three Fiber front end inside a Tauri 2 shell, with a
Rust core doing indexing, SQLite persistence, and format probing. `docs/plan.md`
is the living architecture doc and phase plan; read it before any structural change.
`docs/custom-maps.md` is the guide to the world document — read that before changing
anything in `src/world/`, because the format is a published interface now.

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
but `{ schemaVersion, rows: { "unit:row": [bookId, ...] }, boxes: { boxId: [bookId, ...] } }`.
Physical placement is recomputed by packing each row left to right in
[src/scene/shelving.ts](src/scene/shelving.ts) and each box bottom-up in
[src/world/boxes.ts](src/world/boxes.ts), so a book whose dimensions change pushes
neighbours along instead of overlapping. Rust stores this document verbatim
(`get_layout`/`save_layout`) — the schema is owned entirely by the front end.

The one exception is `loose`: a book put down on a table or dropped on the floor
stores an actual position, because "there, where I put it" cannot be derived from
an ordering. It is also the only place the layout stores coordinates, and worth
keeping that way.

**The app never writes to `library.json`.** That file is hand-edited prose with
comments in it. Everything the app decides about the room — where you shoved the
boxes (`furniture`), what you wrote on a shelf (`labels`), which lamps are off
(`.library/lights.json`) — goes to files beside it. `deriveWorld(doc, overrides)`
takes the furniture overrides as an argument for exactly this reason.

**Nothing shelves itself.** A newly indexed book goes into a moving box, not onto
a shelf ([src/world/reconcile.ts](src/world/reconcile.ts)), so a fresh library is
four full boxes and empty shelves. Unpacking is an interaction: `G` on a box runs
`emptyBoxOntoShelves`, which fills empty rows in a seeded-random order; `E` takes
one book out or puts one back into the box you are looking at.

**Books live in `<library>/books/`.** `index::discover` confines the scan to that
folder when it exists — `music/` and `artwork/` are the other reserved names — and
falls back to reading the whole folder (minus those two) when it does not, so
libraries predating the convention still index. The other two folders are read by
[src-tauri/src/media.rs](src-tauri/src/media.rs), deliberately *not* through SQLite:
a music folder is hundreds of files rather than tens of thousands, so walking it on
demand beats a second cache to keep in sync. Tags are read without a crate — ID3v2
and FLAC Vorbis comments only, in [src-tauri/src/probe/audio.rs](src-tauri/src/probe/audio.rs)
— to keep the shipped licence surface where it is.

**Book appearance is a pure function of index data.** [src/data/dimensions.ts](src/data/dimensions.ts)
derives thickness from page count (estimated from file size for EPUBs, which have
none), and height/depth/colour from a hash of the book id — arbitrary but stable, so
a book always looks the same on the shelf. Everything is about a quarter over life
size, and the carcass in `world/shelf.ts` was grown to match: legibility of a printed
spine is capped by screen pixels, so physical size is the only thing that buys it.

**A room can be over another room.** `RoomSpec.elevation` puts a floor at a height and
`holes` cuts a stairwell out of it; `floorAt` in [src/world/derive.ts](src/world/derive.ts)
answers "what am I standing on" for the walk controller, treating a `stairs` piece as a
ramp. Colliders carry a vertical extent (`Solid`) and are flattened to 2D per level by
[src/scene/walk.ts](src/scene/walk.ts), so the loft's balustrade is not a wall in the
middle of the room below it. A move is refused unless the floor it lands on is within
`STEP_UP` of the floor it left — which is both how stairs work and why you cannot walk
off the loft.

**Book identity is content-based, not path-based.** `book_id` in
[src-tauri/src/index.rs](src-tauri/src/index.rs) hashes file length plus the first
64 KiB, so moving or renaming a file keeps its shelf position and progress.

**State is split by lifetime.** `state/store.ts` holds session/UI state (mode, crosshair
focus, held book, driver). `state/library.ts` holds the catalogue and shelving, reconciles
a saved layout against the latest scan on load, and debounces layout saves (600 ms).
`state/lights.ts` and `state/media.ts` own the two smaller save files and the record
player. `state/player.ts` and `state/metrics.ts` are plain mutable objects deliberately
outside zustand — they change every frame and must not trigger React renders.

Anything that re-derives the world (`setPlacements`) re-reconciles the whole library, so
it belongs on an *edit* and never in a frame loop: carrying a moving box renders a
preview and commits once, when you set it down.

**Interaction goes through instanced meshes.** Books, shelves, records and loose books
are all `InstancedMesh`; [src/scene/refs.ts](src/scene/refs.ts) is a module-level handle
so the single per-frame raycast in `Interaction.tsx` can reach them. Collision is
hand-rolled axis-separated AABB sliding in [src/scene/collision.ts](src/scene/collision.ts)
— no physics engine, deliberately, which also keeps `wasm-unsafe-eval` out of the
desktop CSP. A dropped book gets gravity and friction from
[src/scene/drop.ts](src/scene/drop.ts), which is forty lines and not a solver; it runs
per frame in `LooseBooks` and tells the store *once*, when the book stops.

**Covers are rendered in the WebView, cached by Rust.** Rather than shipping pdfium,
the front end rasterises page one with pdf.js and posts it to `save_rendered_cover`.
`warmCovers` walks the whole catalogue in a background lane behind anything urgent, so
a library finishes rather than resolving as you approach it. Book bytes come back
through the `read_book_file` command, *not* the asset protocol. The asset scope starts
empty and is granted at runtime for exactly three directories — `covers`, `music`,
`artwork` — each only when something asks; audio is the reason a folder rather than a
command, since a track is streamed while it plays.

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
