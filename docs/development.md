# Working on kleib3ry

## Getting Set Up

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

| command             | driver    | good for                                         |
| ------------------- | --------- | ------------------------------------------------ |
| `npm run tauri:dev` | `tauri`   | anything touching real files, indexing, the CSP  |
| `npm run dev`       | `browser` | the room, the scene, the reader, the HUD         |
| `npm run dev:http`  | `http`    | the container's driver, against a running server |

The browser build has a generated 1,700-book placeholder catalogue plus two real
books, one of each format, so read mode works and the shelves are full without
pointing at anything. It is a fixture, not a shippable mode — only the first and
third rows are modes anyone runs. See [modes.md](modes.md).

## The Gate

```bash
npm run verify         # lint + typecheck + build + Playwright + clippy + cargo test
```

That is what "done" means. Individually:

| command             | proves                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`      | oxlint over `src`, `tests` and `scripts` — config in `.oxlintrc.json`; `npm run lint:fix` applies what it can                                 |
| `npm run typecheck` | the front end type-checks                                                                                                                     |
| `npm run build`     | the production bundle builds from the CLI                                                                                                     |
| `npm test`          | headless Chromium boots the bundle, WebGL comes up, the room rasterises geometry, a real PDF opens and turns a page, and the console is clean |
| `npm run lint:rust` | `cargo clippy -D warnings` over all three crates                                                                                              |
| `npm run test:rust` | all three crates: core, the desktop shell, the server                                                                                         |

Not part of the gate but useful beside it: `npm run scan -- <folder>` indexes a
library folder's `books/` from the command line, with no app running — see
[library-folder.md](library-folder.md#scanning-from-the-command-line).

CI runs the same six things on every push and pull request, in
[.github/workflows/verify.yml](../.github/workflows/verify.yml), split so the
half-hour Playwright job runs _beside_ the two-minute one rather than behind it.
The desktop shell is clippy'd and tested on a Windows runner, since `src-tauri`
wants GTK and WebKit on Linux — which is the whole reason `core/` was carved out
of it — and the container image is built to prove the three stages still
assemble.

Beyond the gate (needs a build first; Windows-only):

```bash
npm run tauri:build
npm run test:desktop   # launches the built exe with WebView2 remote debugging,
                       # attaches over CDP, drives scan → shelve → read
```

`tauri:build` emits the NSIS installer and, beside it,
`src-tauri/target/release/kleib3ry.exe` — a standalone executable with the whole
front end linked in, pdf.js cmaps and standard fonts included. `npm run
tauri:build:exe` builds only that. It is single-file, not zero-footprint:
settings still land in the app config dir, and it renders through the system
WebView2 runtime rather than shipping an engine, which is what keeps it around
10 MB instead of 150. Use the installer where that runtime may be missing.

And the container:

```bash
npm run docker:build
docker run --rm -p 8080:8080 -v /path/to/library:/library kleib3ry
```

See [docker.md](docker.md).

## Running One Test

```bash
npx playwright test tests/collision.spec.ts
npx playwright test -g "walking moves the player"
npm run test:rust -- settings_round_trip
cargo test --manifest-path core/Cargo.toml index::
```

`scripts/make-test-library.mjs` generates a folder of throwaway PDFs and EPUBs
to point the desktop probe at. For working by hand against something that looks
like a real collection, `demo-data/demo-library/` is a small freely-licensed one
in the repository — ten EPUBs, two records, two pictures, a tape and a Pong ROM
— and it is what to mount into the container when changing the hosted mode.

`npm run icon` regenerates the app icon rather than committing an opaque binary:
`scripts/make-icon.mjs` writes `assets/icon-source.png` and `tauri icon` renders
it into `src-tauri/icons/`.

## How the Tests Are Arranged

Two jobs, five files:

- **`tests/collision.spec.ts`**, **`tests/world.spec.ts`**,
  **`tests/chip8.spec.ts`** and **`tests/annotations.spec.ts`** unit-test pure
  modules _through the Playwright runner_ — no browser, no page — because
  Playwright already transpiles the TypeScript, so this costs no second
  toolchain. They cover collision, shelving, the world document, reconciliation,
  the roof, the terrain, the spread-to-page arithmetic `annotations.json` uses,
  and the CHIP-8 interpreter, which runs the bundled Pong ROM for real so the
  assembler in `scripts/lib/make-chip8.mjs` and the CPU in
  `src/arcade/chip8.ts` are held to agree.
- **`tests/smoke.spec.ts`** drives the real production bundle in headless
  Chromium.
- `npm run test:desktop` is not part of `verify` because it needs a built
  installer. It covers the three things the browser tests structurally cannot:
  the Tauri bridge, the CSP, and WebView2 itself.

The browser tests reach the app through `window.__app` in
[../src/App.tsx](../src/App.tsx) — teleport, look, stats, `readForTest`, the
lamps, the weather, the pins, the records, the tapes, the arcade, the props, the
courier, the whiteboards, the page ink, and the cat. It exists because pointer
lock is unavailable headlessly. **Extend it when a new behaviour needs
covering**; do not reach into the stores from a test.

The `…ForTest` methods are for things that cannot sanely be aimed at headlessly
— a 6 cm can on a counter, a moving cat — and call exactly the line the key
press calls, so the test asserts on what happens next. Anything the crosshair
has to find (a book, a box, a wall) is still aimed at for real.

Three things to know before debugging a smoke test:

- **Every test goes in through the main menu.** The room loads behind it and
  `ready()` is true while it is up, but nothing reaches the room until the
  button is pressed — `boot()` presses it, and skipping that leaves every key
  dead. `reboot()` does the same after a `page.reload()`.
- **They run on SwiftShader**, a software rasteriser, at a few frames a second.
  The crosshair is written by a raycast running every other frame, so "has it
  noticed yet" is answered in frames, not milliseconds. That is what `settled()`
  is for; a fixed sleep reads stale nulls under load and looks exactly like the
  room being wrong.
- **They derive coordinates from the world**, not from written-down numbers.
  `faceTheShelves` asks the document where the bookcases are and sweeps the
  height of one until the crosshair finds a book. A test that hard-codes where a
  bookcase was fails the day somebody rearranges the room.

Assertions are on measurable facts — draw calls, triangles, frames, zero console
errors, where a book ended up. `tests/screenshots/` is written for a human to
glance at, never compared.

## The Frame Budget Is Real

The atlas is the thing to watch. Its whole texture re-uploads whenever any cell
changes, so its _size_ is a per-pass cost: on the software rasteriser the tests
run on, taking it from 15 MB to 23 MB was enough for Playwright's own clicks to
time out. If you change cell size or count in
[../src/scene/spineAtlas.ts](../src/scene/spineAtlas.ts), keep the product about
where it is and run the whole smoke suite, not one test.

The same applies to a shadow caster covering a lot of screen, a second atlas, or
anything drawn _near the camera_ — a surface 10 cm from the near plane fills
half the screen with fragments nobody sees, which is why the player's body sits
a hand's width behind the eyes. Assemblies of more than a handful of boxes are
merged into one geometry per material (the plants, staircases, the cat, the
body) using the helpers in
[../src/scene/geometry.ts](../src/scene/geometry.ts), and anything scattered
about the room in numbers is one `InstancedMesh` rather than a mesh apiece. The
[atmosphere layer](architecture.md#atmosphere) follows that rule throughout and
says which pieces Low Performance Mode drops.

**The other number to watch is how many point lights are in the scene**, and it
is the one that is easiest to add to by accident. Three.js forward rendering has
no per-object light culling: every point light in the scene is a term in _every_
lit fragment's shader, whether it hangs over your head or in another building
across the lake. Mounting a light per lamp put nearly forty of them in the
default map, and every pixel of the cabin was shaded against the lake house's
pendants.

So lamps are not lights. [../src/scene/lightPool.ts](../src/scene/lightPool.ts)
holds a _fixed_ pool — eight by default, `lightBudget` in settings — and
re-points it at whatever is nearest as you walk. Fixed, because the count is what
every lit material is compiled against, and a count that moves recompiles every
shader in the room mid-stride. Anything that wants to light the room is a
`PoolLight` candidate rather than a `<pointLight>`; the two deliberate exceptions
are the television's glow and the campfire, which mount only while they are
running and are rare enough to pay for their one recompile.

The shadow map follows the same rule of thumb — cover what you can see, not what
exists. It is an 18 m box around the camera, snapped to whole texels so the edges
do not crawl, rather than the bounding box of every room in the document (94 m
across on the default map, which was 4.6 cm of world per texel at 2048).

To measure any of it: `window.__app.stats()` reports draw calls, triangles and
frames, `window.__app.pointLights()` reports how many lights are mounted and
which candidates the pool is showing, and `window.__app.spines()` reports how
many atlas cells are printed and how many have changed hands.

Settings has the numbers live while you play: **Frame Time** in ms with the
worst frame beside it, the split between our own JavaScript and the draw, and a
plain-words verdict on which of the three is the limit. FPS on its own cannot
answer that — it is capped at the refresh rate, so 60 reads the same whether the
frame had 2 ms of work in it or 16.

## Conventions

- **Ease with `approach`, not with `min(1, delta * k)`.**
  [../src/lib/ease.ts](../src/lib/ease.ts) is the exponential form; the naive one
  is a fraction _per frame_, so it settles at a different speed on every machine
  and snaps hard on the software rasteriser. Anything that asymptotes should
  also _arrive_ — snap to the target within a millimetre or two, or a thing that
  has stopped keeps creeping.
- **Auto-repeat moves you; it does not act for you.** Any key handler that does
  something once takes `if (e.repeat) return`, or holding the key repeats the
  action thirty times a second.
- TypeScript is strict, with `noUncheckedIndexedAccess`, `noUnusedLocals` and
  `noUnusedParameters`. `tsconfig.json` covers `src`, `tests`, `scripts` and the
  config files, so a test or a script that does not type-check fails the build.
- The Rust release profiles are **not** `panic = "abort"`: the indexer catches
  per-file unwinds so one malformed book cannot kill a scan.
- Fixed ports: Vite dev **5180**, Playwright preview **5190**, desktop CDP probe
  **9223**, the server **8080**.

## Adding Things

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
`Handling.tsx`. Reading keys live in `Reader.tsx`; a held mouse button lives in
`Drawing.tsx`. Anything that opens a typed field has to be added to
**`roomHasKeyboard()`** in [../src/state/store.ts](../src/state/store.ts) — one
predicate, asked by every key handler, because `W` has to be a letter while
somebody is typing a word. Add it to `ControlsCard.tsx` and to
[controls.md](controls.md).

**A setting.** If it is about the _machine_ — the renderer, the mouse, the
volume — it goes in [../src/state/settings.ts](../src/state/settings.ts) and is
read where it applies. If it is about the _room_ — the lamps, night, weather —
it goes in `ambience.ts` and is saved into the library folder. Getting that
backwards means a library folder asserting something about somebody else's GPU,
or a graphics setting that vanishes with `ambience.json`. **Match the Clock**
shows where the line falls: it _causes_ night, a room fact, but what it asks is
the local time, a machine fact — so the switch lives in `settings.ts` and only
the night it turns on is written to the library.

**A field in the world document.** Parse it in `schema.ts` with a default, so no
existing document has to mention it, and make the failure message name the path
that is wrong. Derive whatever the scene needs from it in `derive.ts` rather than
letting a component read the raw document.

**Something the app writes down.** It goes in the layout document
(`LayoutDocument` in [../src/services/types.ts](../src/services/types.ts)) as an
optional field, is filtered on load against what the index still knows about, and
is saved through the existing debounce. Never into `library.json`: that file is
the user's.
