# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

kleib3ry — a 3D personal library: React Three Fiber front end inside a Tauri 2
shell, with a Rust core doing indexing, a JSON index and format probing.

**There are exactly two shipped modes**, and a change that adds a way to run this
is a change to that list: the **desktop app** (Tauri, `tauriDriver`) and
**hosted** (the Docker container — the same core behind an HTTP server, serving a
library folder to a browser, `httpDriver`). `browserDriver` is a _test fixture_
with a generated catalogue, not a third mode, and the fallback for any non-Tauri
bundle built without `VITE_DRIVER=http`. Say "container", not "web version" —
[docs/modes.md](docs/modes.md) is the record, and `DRIVER_LABELS` in
[src/services/index.ts](src/services/index.ts) is where the UI gets its words.

**[docs/architecture.md](docs/architecture.md) is the architecture record.** This
file is its short form; where the two disagree, that one is right.
[docs/README.md](docs/README.md) indexes the rest —
[custom-maps.md](docs/custom-maps.md) before changing anything in `src/world/`,
because the world document is a published interface;
[modes.md](docs/modes.md) and [docker.md](docs/docker.md) for the hosted mode;
[development.md](docs/development.md) for how the tests are arranged and what the
frame budget is; [bugs-ideas.md](docs/bugs-ideas.md) for the open list.

The root [README.md](README.md) is the front page and is deliberately thin: what
it is, the two quick starts, the demo library, and links. Anything longer belongs
in `docs/`.

## Commands

```bash
npm install
npm run assets         # copy pdf.js standard_fonts + cmaps into public/ — gitignored, so needed after a fresh clone
npm run tauri:dev      # desktop app (native folder picker, real indexer)
npm run dev            # browser only, placeholder catalogue, no filesystem
npm run dev:http       # browser against a running kleib3ry-server

npm run verify         # the gate before calling work done: lint, typecheck, build,
                       # Playwright, clippy, cargo test
npm run lint           # oxlint (.oxlintrc.json); lint:fix applies what it can
npm run lint:rust      # cargo clippy -D warnings, all three crates
npm run typecheck
npm test               # Playwright, headless Chromium against the production bundle
npm run test:rust      # all three crates: core, src-tauri, server
```

Single test / subset:

```bash
npx playwright test tests/collision.spec.ts
npx playwright test -g "walking moves the player"
npm run test:rust -- settings_round_trip
cargo test --manifest-path core/Cargo.toml index::
```

Beyond `verify`:

```bash
npm run tauri:build    # Windows installer, plus the standalone exe beside it
npm run tauri:build:exe # only the standalone exe (no installer)
npm run test:desktop   # node scripts/probe-desktop.mjs [libraryFolder] [exe] — launches the built
                       # exe with WebView2 remote debugging, attaches over CDP, drives scan→shelve→read
npm run docker:build   # the container image
npm run serve -- --root <folder> --dist dist
```

`scripts/make-test-library.mjs` generates a folder of throwaway PDFs/EPUBs to point
the desktop probe at. `npm run icon` regenerates the app icon from `scripts/make-icon.mjs`.

## The One Architectural Rule

**Nothing above `src/services/` may import `@tauri-apps/*`.** All filesystem access
goes through the `LibraryService` interface in [src/services/types.ts](src/services/types.ts).
Three drivers implement it — `tauriDriver` (IPC to Rust), `httpDriver` (fetch against
`kleib3ry-server`) and `browserDriver` (localStorage + a generated 1,700-book
placeholder catalogue). A driver advertises what it can do (`kind`, `canPickFolder`,
`canIndex`) and the UI disables controls accordingly rather than failing at call
time; unsupported operations throw `UnsupportedOperation`.

`isTauri()` picks the desktop driver at runtime. The other two are indistinguishable
at runtime, so `httpDriver` is selected at _build_ time by `VITE_DRIVER=http`
(`npm run build:http`) — see [src/services/index.ts](src/services/index.ts) for why
a runtime probe would be worse. The HTTP driver and the whole container were added
without a single change above `src/services/`, which is what this rule is for.

## Three Rust Crates

`core/` is indexing, the JSON index, the format probes and the media folders, with
no GUI. `src-tauri/` is the desktop shell — IPC commands, settings, the asset
scope, the picker. `server/` is the same core over HTTP, with no HTTP framework (a
dozen routes and byte ranges is a few hundred lines of `TcpListener`).

The split exists so the container is a binary and a folder of files rather than a
Linux image carrying a browser engine in order to read a directory. Each crate
owns its errors: `core::Error` has no `Tauri` variant, and the shell wraps it
transparently.

The one piece of security in the server is `is_allowed` in `server/src/main.rs`:
four directories are readable over HTTP, every path is canonicalised and checked
against them, and books are served by index id rather than by name.

## How the Pieces Fit

**Layout is ids, positions are derived.** The persisted layout document is mostly
`{ rows: { "shelfId:row": [bookId, ...] }, boxes: { boxId: [bookId, ...] } }`.
Placement is recomputed by packing each row left to right in
[src/scene/shelving.ts](src/scene/shelving.ts) and each box bottom-up in
[src/world/boxes.ts](src/world/boxes.ts), so a book whose dimensions change pushes
neighbours along instead of overlapping. Rust stores the document verbatim
(`get_layout`/`save_layout`) — the schema is owned entirely by the front end.

Four things store real positions, because "there, where I put it" cannot be
derived from an ordering — keep the list short:

- `loose` — a book on a table or the floor
- `pins` — sheets on walls
- `records.loose` — a record set down
- `props` — the coffee cup (exactly one, id `cup`), the fridge's cans, the
  takeaway boxes, and the `headlamp` (written down only while it is off your head)

`F` drinks or eats; the coffee writes `player.boostUntil`; the kitchen `bin`
destroys empties. The `phone` orders a delivery, which the courier in
`state/courier.ts` walks to `deliverySpot` in `world/derive.ts` — a takeaway, or
an **arXiv paper**, downloaded and indexed by
[core/src/paper.rs](core/src/paper.rs) and carried in as an ordinary book.

**Records are dealt, not arranged.** Every `recordshelf` takes a slice of `music/`
in folder order, so nothing has to be written down for a few hundred sleeves to
have somewhere to be. Only what you have moved is stored — `records.filed` (one
crate id) and `records.loose` (one point) in `books.json` — and the deal honours
explicit filings first, or putting a record away would be undone by the next deal.
There is one of each record: it is on whichever deck you carried it to,
`state/media.ts` remembers _which_ deck, an empty deck does nothing, and `F` takes
one back off.

**A whiteboard is drawn on with the mouse held down.** [src/scene/board.ts](src/scene/board.ts)
stores strokes in board space (u across, v up, 0 to 1) so a resized board keeps its
drawing; the live stroke is a plain mutable object outside the store, because it
gains a point per frame, and lands in the layout once when you let go.
[src/scene/Drawing.tsx](src/scene/Drawing.tsx) is the only continuous input in the
app, which is why it is not another branch in `Player.tsx`.

**The app never writes to `library.json`.** That file is hand-edited prose with
comments in it. Everything the app decides about the room — where you shoved the
boxes (`furniture`), what you wrote on a shelf (`labels`), which lamps are off and
whether it is raining (`.library/ambience.json`) — goes to files beside it.
`deriveWorld(doc, overrides, boxEdits)` takes both as arguments for this reason.

**Nothing shelves itself.** A newly indexed book goes into a moving box, not onto a
shelf ([src/world/reconcile.ts](src/world/reconcile.ts)), so a fresh library is
full boxes and empty shelves — levelled book by book, or a folder of `books/` per
box with "One Box per Folder" on in settings. Unpacking is an interaction: `G` on a
box runs `emptyBoxOntoShelves`, which fills empty rows nearest case first; `E`
takes one book out or puts one back. The boxes are furniture you manage: `X`
carries one, `Backspace` breaks an empty one down, and `E` on the kitchen's
`boxstack` makes a new one up — spawned and removed boxes are layout state
(`books.json`), never `library.json`.

**Some furniture you carry off.** `PORTABLE` in `world/derive.ts` is the list — the
folding chair and the folding table, which live on the porch — and `X` picks one up
and sets it down exactly the way it does a box, writing a `FurnitureOverride` into
`books.json`. They are ordinary furniture in every other respect: you sit on the
one and put a book on the other, so the crosshair offers both verbs at once. The
document says where a piece _lives_; the override says where you left it.

**Books live in `<library>/books/`.** `index::discover` confines the scan to that
folder when it exists — `music/`, `artwork/`, `video/` and `roms/` are the reserved
names — and falls back to the whole folder minus those four when it does not. The
other four are read by [core/src/media.rs](core/src/media.rs), _not_ through the
index: a music folder is hundreds of files, so walking it on demand beats a second
cache to keep in sync. Tags are read without a crate — ID3v2 and FLAC Vorbis
comments only, in [core/src/probe/audio.rs](core/src/probe/audio.rs). A tape is not
probed at all: its filename is its title and its folder is its series. Neither is a
ROM: a `.ch8` is a bare byte array with no header.

**Both formats open.** Everything above [src/reader/source.ts](src/reader/source.ts)
is written against "a thing with pages you can rasterise" rather than against
pdf.js, so the drag, the turn, bookmarks, `J`, `N` (a note on the page) and `P` are
identical for a PDF and an EPUB. An EPUB is unzipped by
[src/reader/zip.ts](src/reader/zip.ts) with the platform's own
`DecompressionStream` (no dependency), reduced to headings and paragraphs by
[epub.ts](src/reader/epub.ts), and set in type by
[epubPages.ts](src/reader/epubPages.ts). Pagination happens _once, in abstract
units, at open time_ — not at the texture's pixel size — so page 200 is page 200 on
any monitor and a bookmark keeps meaning something.

**Book appearance is a pure function of index data.** [src/data/dimensions.ts](src/data/dimensions.ts)
derives thickness from page count — an EPUB has none, so the probe measures the
uncompressed length of the documents inside the archive — and height, depth and
colour from a hash of the book id: arbitrary but stable. Everything is about a
quarter over life size, and `world/shelf.ts` matches, because the legibility of a
printed spine is capped by screen pixels.

**A room can be over another room.** `RoomSpec.elevation` puts a floor at a height
and `holes` cuts a stairwell out of it; `floorAt` in
[src/world/derive.ts](src/world/derive.ts) answers "what am I standing on" for the
walk controller, treating a `stairs` piece as a ramp. Colliders carry a vertical
extent (`Solid`) and are flattened to 2D per level by
[src/scene/walk.ts](src/scene/walk.ts), so the loft's balustrade is not a wall in
the room below. A move is refused unless the floor it lands on is within `STEP_UP`
of the floor it left — which is both how stairs work and why you cannot walk off
the loft.

**Only the topmost room over a patch of ground is roofed.** `roofsOf` derives that
from the document rather than making you declare it. A roof's plane is pinned to
the _top of the walls_ and rises from there, so it can never intrude on headroom or
cut through the ceiling below; and it does not overhang into a building it abuts,
or the porch's shed roof comes out through the cabin's south wall. Roofs are
deliberately out of the shadow pass: they are the largest surfaces in the scene and
cast almost nowhere useful.

**The ground is walkable, and the outdoors is world data.**
[src/world/terrain.ts](src/world/terrain.ts) owns the site — ground height, the lake
as an ellipse, the beach, the path round it, the trail between the buildings, the
brook that comes down the east side of the houses into the water, the radius the
world ends at — and both `Outside.tsx` and `floorAt` read it, because a shoreline
you can see in one place and stand in in another is the bug that arrangement
prevents. The brook is that rule twice over: it is water you cannot walk in, it
fords where it fans out over the beach so the walk round the lake stays a ring, and
the plank across it is a floor `terrainAt` hands back.
[src/world/forest.ts](src/world/forest.ts) does the same for the trees: grown once
in `deriveWorld`, then both drawn and collided with from that one list. Only trunks
are solid. A library folder may describe **more than one building** — the default
map has the cabin and the lake house — which needs nothing in the format, because a
building is rooms somewhere else.

**Book identity is content-based, not path-based.** `book_id` in
[core/src/index.rs](core/src/index.rs) hashes file length plus the first 64 KiB, so
moving or renaming a file keeps its shelf position and progress. A scan skips any
file whose size and mtime are unchanged, so an improved probe would never reach a
book already indexed — `probe::PROBE_VERSION` is stored per row and a bump
re-probes every older row once. Bump it whenever a probe learns to extract
something new.

**State is split by lifetime.** `state/store.ts` holds session/UI state (mode,
crosshair focus, held book, held tape, held sheet, driver, whether you have gone in
yet). `state/library.ts` holds the catalogue, shelving and pins, reconciles a saved
layout against the latest scan on load, and debounces layout saves (600 ms).
`state/annotations.ts` holds bookmarks (spreads in memory, pages in the file), page
notes and page ink (`D` picks the pen up in the reader; strokes are
whiteboard-shaped, in page space, painted onto the rasterised page canvas), saved to
`.library/annotations.json` — its own file, page-numbered and title-carrying, so the
marginalia read without the app. `state/ambience.ts`, `state/media.ts`,
`state/video.ts` and `state/arcade.ts` own the smaller save files, the record
player, the television and the arcade machine — the _running_ CHIP-8 is a plain
mutable object beside its store, stepped per frame by `scene/Arcade.tsx`.
`state/player.ts`, `state/cat.ts`, `state/courier.ts` and `state/metrics.ts` are
plain mutable objects deliberately outside zustand — they change every frame and
must not trigger React renders, and `scene/ambienceBlend.ts` and
`scene/shaderWarm.ts` are the same thing kept next to the code that advances them.

**A room fact goes in the library folder; a machine fact does not.** Which lamps are
on, whether it is night and whether it is raining live in `ambience.json` and travel
with the library. Low Performance Mode, the body, the volumes, the mouse
sensitivity and whether night follows this machine's clock live in
`state/settings.ts`, backed by `localStorage` — a folder you sync to another
computer must not carry an assertion about that computer's GPU, or about what time
it is where that computer is.

**The rain is synthesised, not sampled.** [src/scene/rainSound.ts](src/scene/rainSound.ts)
is looping filtered noise through a low-pass whose cutoff tracks how much sky is
over you; `Sound.tsx` derives that from the room you are in and the openings in it.
Every failure — no `AudioContext`, a context that will not start — falls back to
silence rather than throwing. [src/scene/ambientSound.ts](src/scene/ambientSound.ts)
is the same trick for the room's own noises: loops that sit somewhere (a fire, a
purr, the lake), one-shots fired where they happen (a footfall keyed to the floor
you are on, a landed book, a door), and choruses that are birds by day and crickets
after dark. One shared `AudioContext`, opened on the first sound and closed when the
last one is done, and the same fall-back-to-silence rule.

**The room's dressing is one instanced mesh per idea.** Contact shadows, lamp bloom,
dust motes, fireflies, falling leaves, undergrowth and the sky's clouds and glints
are each a draw call or three, seeded so a room comes back the same, faded by
`ambienceBlend` rather than mounted and unmounted, and thinned or dropped in Low
Performance Mode — except `ContactShadows.tsx` and `LampGlow.tsx`, which are
deliberately kept, because with the shadow map off they are the only things
grounding furniture and making a lit lamp read as lit.

**A lamp is not a light.** Three.js forward rendering has no per-object light
culling, so every point light in the scene is a term in every lit fragment's shader
— the default map's forty lamps and window reveals were all being paid for by every
pixel, everywhere. [src/scene/lightPool.ts](src/scene/lightPool.ts) holds a fixed
pool (eight, `lightBudget`) and re-points it at the nearest lit candidates as you
walk. The count must never change with position: it is what every lit material is
compiled against. An unlit lamp is not a candidate, so off is cheaper and not merely
darker. The sun's shadow box follows the camera at 18 m rather than spanning the
document. Anything that wants to light the room is a `PoolLight`; the television's
glow and the campfire are the two deliberate exceptions, mounted only while running.

**The HUD is what is under the crosshair and what is going wrong; everything else is
behind a key.** The main menu (`src/ui/MainMenu.tsx`) chooses a library while the
room loads _behind_ it, and settings (`F2`) hold the switches. Nothing reaches the
room until you have gone in — `roomHasKeyboard()` in `state/store.ts` is the one
place that decides, and every key handler asks it.

Anything that re-derives the world (`setPlacements`) re-reconciles the whole
library, so it belongs on an _edit_ and never in a frame loop: carrying a moving box
renders a preview and commits once, when you set it down.

**Interaction goes through instanced meshes.** Books, shelves, records, tapes and
loose books are all `InstancedMesh`; [src/scene/refs.ts](src/scene/refs.ts) is a
module-level handle so the single per-frame raycast in `Interaction.tsx` can reach
them. Furniture is published as _groups_ — seats, surfaces, fixtures, boxes, boards
— because the crosshair asks a different question of each. Collision is hand-rolled
axis-separated AABB sliding in [src/scene/collision.ts](src/scene/collision.ts) — no
physics engine, deliberately, which also keeps `wasm-unsafe-eval` out of the desktop
CSP. A dropped book gets gravity and friction from
[src/scene/drop.ts](src/scene/drop.ts), which is forty lines and not a solver; it
runs per frame in `LooseBooks` and tells the store _once_, when the book stops.

**The spine atlas has a fixed byte budget.** Its whole texture re-uploads whenever
any cell changes, so its size is a per-pass cost — about 15 MB is what the frame
times carry, and cell size therefore trades directly against cell count. Going over
it is measurable in dropped frames on the software rasteriser the tests run on. See
[src/scene/spineAtlas.ts](src/scene/spineAtlas.ts), where the trade is written down
with the numbers. The tapes share the machinery with a much smaller grid of their own.

**Covers are rendered in the WebView, cached by Rust.** Rather than shipping pdfium,
the front end rasterises page one with pdf.js and posts it to `save_rendered_cover`.
`warmCovers` walks the whole catalogue in a background lane behind anything urgent,
so a library finishes rather than resolving as you approach it. Book bytes come back
through the `read_book_file` command, _not_ the asset protocol. The asset scope
starts empty and is granted at runtime for exactly four directories — `covers`,
`music`, `artwork`, `video` — each only when something asks; audio and video are the
reason a folder rather than a command, since a track or a tape is streamed while it
plays. A ROM is read once and never streamed, so `read_rom_file` is a command like a
book's and `roms/` never widens the scope (nor the server's `is_allowed` list).

**The arcade machine is a CHIP-8 interpreter in the front end.**
[src/arcade/chip8.ts](src/arcade/chip8.ts) is the whole machine, dependency-free;
`scene/Arcade.tsx` steps it and maps the keyboard while `mode === 'play'`; the
cabinet in `Furniture.tsx` paints its 64×32 screen onto a `CanvasTexture` cheap
enough to repaint every frame. Games come from `roms/` — listed like media, fetched
by id like a book — and the demo Pong is assembled from scratch by
[scripts/lib/make-chip8.mjs](scripts/lib/make-chip8.mjs), which
`tests/chip8.spec.ts` runs on the interpreter for real.

**A torn-out page is a copy.** `P` in the reader records which book and which page
number; the book keeps its own page and the sheet is rasterised from the same file
next time it is drawn. "Tear out" is the gesture, not the effect.

## Conventions

- Comments explain _why_ a decision was made, and do it **briefly**: a line or
  two, no narrative, no history of what it used to be, no arguing with the
  reader. If a comment needs a paragraph, the reasoning belongs in `docs/`.
- **UI text is Headline Case** for anything that is a label, a title, a heading
  or a button — "Low Performance Mode", "Clear the Shelves", "Holding a Record".
  Sentence case for the phrases after a `<kbd>` and for anything that is a real
  sentence.
- TS is strict with `noUncheckedIndexedAccess` and `noUnusedLocals`; `tsconfig.json`
  covers `src`, `tests`, `scripts`, and the config files.
- `tests/collision.spec.ts`, `tests/world.spec.ts`, `tests/chip8.spec.ts` and
  `tests/annotations.spec.ts` unit-test pure modules through the Playwright runner (no
  browser); `tests/smoke.spec.ts` drives the real bundle. The browser tests reach the app
  through `window.__app` in [src/App.tsx](src/App.tsx) — a deliberate verification surface
  (teleport, look, stats, readForTest, the lamps, the pins, records, tapes, the arcade,
  props, the courier, page ink, the cat) that exists because pointer lock is unavailable
  headlessly. Extend it when a new behaviour needs covering; its `…ForTest` calls exist
  for things you cannot sanely aim at headlessly (a can on a counter, a moving cat), not
  as a way round the crosshair.
- Assertions are on measurable facts (draw calls, triangles, frames, zero console errors);
  screenshots are for a human to glance at, not for comparison. Anything whose value
  depends on how many frames have been rendered is _waited for_, not sampled after a
  fixed sleep — the smoke tests run on SwiftShader at a few frames a second, and a fixed
  sleep measures the host's spare capacity instead of the app.
- Rust release profiles are _not_ `panic = "abort"` — the indexer catches per-file unwinds
  so one malformed book can't kill a scan.
- Fixed ports: Vite dev 5180, Playwright preview 5190, desktop CDP probe 9223, server 8080.
