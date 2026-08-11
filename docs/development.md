# Working on kleib3ry

## Getting set up

```bash
npm install
npm run assets         # pdf.js standard_fonts + cmaps, and the sample book, into
                       # public/ — gitignored, so needed after a fresh clone
npm run tauri:dev      # the desktop app: native folder picker, real indexer
npm run dev            # browser only: placeholder catalogue, no filesystem
```

`npm run assets` writes generated files that are deliberately not committed.
Reading will fail without it.

Both dev commands can run at once — `tauri:dev` reuses a Vite server that is
already up.

There are three front-end hosts, and which one you want depends on what you are
working on:

| command | driver | good for |
| --- | --- | --- |
| `npm run tauri:dev` | `tauri` | anything touching real files, indexing, the CSP |
| `npm run dev` | `browser` | the room, the scene, the reader, the HUD |
| `npm run dev:http` | `http` | the container's driver, against a running server |

The browser build has a generated 1,700-book placeholder catalogue plus one real
PDF, so read mode works and the shelves are full without pointing at anything.

## The gate

```bash
npm run verify         # typecheck + build + Playwright + cargo test
```

That is what "done" means. Individually:

| command | proves |
| --- | --- |
| `npm run typecheck` | the front end type-checks |
| `npm run build` | the production bundle builds from the CLI |
| `npm test` | headless Chromium boots the bundle, WebGL comes up, the room rasterises geometry, a real PDF opens and turns a page, and the console is clean |
| `npm run test:rust` | all three crates: core, the desktop shell, the server |
| `npm run scan -- <folder>` | indexes a library folder's `books/` from the command line, no app needed |

Beyond the gate (needs a build first; Windows-only):

```bash
npm run tauri:build
npm run test:desktop   # launches the built exe with WebView2 remote debugging,
                       # attaches over CDP, drives scan → shelve → read
```

`tauri:build` emits both the NSIS installer and, beside it,
`src-tauri/target/release/kleib3ry.exe` — a standalone executable with the whole
front end linked in, pdf.js cmaps and standard fonts included. `npm run
tauri:build:exe` builds only that, skipping the installer. It is single-file to
hand someone, not zero-footprint: settings still land in the app config dir, and
it renders through the system WebView2 runtime rather than shipping an engine,
which is the trade that keeps it around 10 MB instead of 150. Use the installer
for anyone whose machine might not have that runtime.

And the container:

```bash
npm run docker:build
docker run --rm -p 8080:8080 -v /path/to/library:/library kleib3ry
```

See [docker.md](docker.md).

## Running one test

```bash
npx playwright test tests/collision.spec.ts
npx playwright test -g "walking moves the player"
npm run test:rust -- settings_round_trip
cargo test --manifest-path core/Cargo.toml index::
```

`scripts/make-test-library.mjs` generates a folder of throwaway PDFs and EPUBs to
point the desktop probe at. `npm run icon` regenerates the app icon from
`scripts/make-icon.mjs`.

## How the tests are arranged

Three files, three jobs:

- **`tests/collision.spec.ts`** and **`tests/world.spec.ts`** unit-test pure
  modules *through the Playwright runner* — no browser, no page. They are there
  because Playwright already transpiles the TypeScript, so this costs no second
  toolchain. They cover collision, shelving, the world document, reconciliation,
  the roof and the terrain.
- **`tests/smoke.spec.ts`** drives the real production bundle in headless
  Chromium.
- `npm run test:desktop` is not part of `verify` because it needs a built
  installer. It covers the three things the browser tests structurally cannot:
  the Tauri bridge, the CSP, and WebView2 itself.

The browser tests reach the app through `window.__app` in
[../src/App.tsx](../src/App.tsx) — teleport, look, stats, `readForTest`, the
pins, the tapes. It is a deliberate verification surface and it exists because
pointer lock is unavailable headlessly. **Extend it when a new behaviour needs
covering**; do not reach into the stores from a test.

Two things about the smoke tests worth knowing before you debug one:

- **They run on SwiftShader**, a software rasteriser, at a few frames a second.
  Anything the crosshair reports is written by a raycast that runs every other
  frame, so "has it noticed yet" is answered in frames rather than milliseconds.
  That is what the `settled()` helper is for; a fixed sleep reads stale nulls
  under load and looks exactly like the room being wrong.
- **They derive their coordinates from the world**, not from written-down
  numbers. `faceTheShelves` asks the document where the bookcases are and sweeps
  the height of one until the crosshair finds a book. A test that knows where a
  bookcase *was* is a test that fails the day somebody rearranges the room.

Assertions are on measurable facts — draw calls, triangles, frames, zero console
errors, where a book ended up. `tests/screenshots/` is written for a human to
glance at, never compared.

## The frame budget is real

The atlas is the thing to watch. Its whole texture is re-uploaded whenever any
cell changes, so its *size* is a per-pass cost — and on the software rasteriser
the tests run on, taking it from 15 MB to 23 MB was enough that Playwright's own
clicks began timing out. If you change cell size or cell count in
[../src/scene/spineAtlas.ts](../src/scene/spineAtlas.ts), keep the product about
where it is, and run the whole smoke suite rather than one test.

The same applies to anything that adds a shadow caster covering a lot of screen,
or a second atlas. `window.__app.stats()` reports draw calls, triangles and
frames; `window.__app.spines()` reports how many cells are printed and how many
have changed hands.

## Conventions

- **Comments explain why, not what.** The interesting content of this codebase is
  the reasoning; match the density of what is around you.
- TypeScript is strict, with `noUncheckedIndexedAccess`, `noUnusedLocals` and
  `noUnusedParameters`. `tsconfig.json` covers `src`, `tests`, `scripts` and the
  config files, so a test or a script that does not type-check fails the build.
- The Rust release profiles are **not** `panic = "abort"`: the indexer catches
  per-file unwinds so one malformed book cannot kill a scan.
- Fixed ports: Vite dev **5180**, Playwright preview **5190**, desktop CDP probe
  **9223**, the server **8080**.

## Adding things

**A furniture kind.** Three places, in order: `FurnitureKind` and
`FURNITURE_KINDS` in [../src/world/schema.ts](../src/world/schema.ts), a footprint
in `FURNITURE_SIZE` in [../src/world/derive.ts](../src/world/derive.ts), and a
component plus a `case` in [../src/scene/Furniture.tsx](../src/scene/Furniture.tsx).
If it hangs on a wall, add it to `WALL_MOUNTED`; if `E` should do something to it,
add it to `APPLIANCES` and handle it in `operate` in `Player.tsx`; if it emits
light, `LAMPS`. Then document it in the table in
[custom-maps.md](custom-maps.md).

**A key.** `E` lives in `Player.tsx` because it is the same reach that takes a
book off a shelf. Everything else you do with your hands lives in
`Handling.tsx`. Reading keys live in `Reader.tsx`. Anything that opens a typed
field has to make the walk controller and the reader bail out — see how
`labelling` and `noting` are checked — because `W` has to be a letter while
somebody is typing a word. Add it to `ControlsCard.tsx` and to the table in the
README.

**A field in the world document.** Parse it in `schema.ts` with a default, so no
existing document has to mention it, and make the failure message name the path
that is wrong. Derive whatever the scene needs from it in `derive.ts` rather than
letting a component read the raw document.

**Something the app writes down.** It goes in the layout document
(`LayoutDocument` in [../src/services/types.ts](../src/services/types.ts)) as an
optional field, is filtered on load against what the index still knows about, and
is saved through the existing debounce. Never into `library.json`: that file is
the user's.
