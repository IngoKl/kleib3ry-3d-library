# Architecture

kleib3ry is a 3D personal library: your own PDFs and EPUBs on shelves you place,
in a building you describe in a text file, read as physical books. This document
covers what the pieces are, which way the dependencies point, and why the
non-obvious decisions were made.

[The one rule](#the-one-rule) and
[what is derived and what is stored](#what-is-derived-and-what-is-stored) shape
everything else — start there.

```text
                         ┌───────────────────────────────┐
   you edit  ──────────► │  <library>/.library/          │
                         │    library.json   the rooms   │
                         │    books.json     the layout  │ ◄──── the app writes
                         │    ambience.json  lamps, sky  │
                         │    index.json     the scan    │
                         │    covers/        artwork     │
                         └───────────────────────────────┘
                                        ▲
                     ┌──────────────────┴──────────────────┐
                 DESKTOP APP                        HOSTED (container)
                     │                                     │
            ┌────────┴────────┐                   ┌────────┴────────┐
            │  core/          │                   │  core/          │
            │  index, catalog,│                   │  (same crate)   │
            │  probe, media   │                   │                 │
            └────────┬────────┘                   └────────┬────────┘
                     │                                     │
            ┌────────┴────────┐                   ┌────────┴────────┐
            │  src-tauri/     │                   │  server/        │
            │  IPC commands   │                   │  HTTP routes    │
            └────────┬────────┘                   └────────┬────────┘
                     │  invoke()                            │  fetch()
            ┌────────┴─────────────────────────────────────┴────────┐
            │  src/services/  —  LibraryService, three drivers      │
            └────────┬──────────────────────────────────────────────┘
                     │
            ┌────────┴──────────────────────────────────────────────┐
            │  src/world/   the document → geometry, floors, trees  │
            │  src/state/   zustand stores + four mutable objects   │
            │  src/scene/   R3F scene graph, instancing, raycast    │
            │  src/reader/  read mode: page cache, mesh, the turn   │
            │  src/ui/      DOM overlay                             │
            └───────────────────────────────────────────────────────┘
```

---

## The Repository

```text
src/                front end
  services/         the ONLY place that touches the filesystem — three drivers
  world/            the library.json document: schema, defaults, geometry,
                    roofs, floor heights and stairs, the terrain and the
                    forest, and what happens to shelved books when the room
                    changes
  scene/            R3F scene graph — rooms, roofs, shelves, books, boxes,
                    furniture, tapes, pins, the forest, the spine atlas, the
                    atmosphere layer, synthesised sound, and the gravity a
                    dropped book falls under
  reader/           read mode: page cache, page mesh, the turn
  state/            zustand stores: world, library, annotations, ambience,
                    media, video, arcade, session; plus player, cat, courier
                    and metrics, deliberately outside React
  data/             placeholder catalogue + book proportions
  ui/               DOM overlay: crosshair, focus cards, panels, typed fields
core/               Rust: indexing, the JSON index, format + tag probes, media folders.
                    No GUI — which is what lets the container skip Tauri entirely
src-tauri/          Rust: the desktop shell. IPC commands, settings, asset scope
server/             Rust: the same core over HTTP, for the container
tests/              Playwright harness — smoke tests plus world/layout units
scripts/            asset generation, icon, test corpus, desktop probe
demo-data/          a small freely-licensed library folder, to try it with
Dockerfile          three build stages, one small runtime
docs/               this folder
```

---

## The One Rule

**Nothing above `src/services/` may import `@tauri-apps/*`.**

Every byte the front end reads from a disk goes through the `LibraryService`
interface in [../src/services/types.ts](../src/services/types.ts). There are
three implementations:

| driver          | mode                       | filesystem          | picker                        | indexes | fetches papers |
| --------------- | -------------------------- | ------------------- | ----------------------------- | ------- | -------------- |
| `tauriDriver`   | **desktop app**            | Rust core over IPC  | native dialog                 | yes     | yes            |
| `httpDriver`    | **hosted** — the container | Rust core over HTTP | no — the mount is the library | yes     | yes            |
| `browserDriver` | none; a test fixture       | none; localStorage  | no                            | no      | no             |

Two are shipped modes and the third is a fixture — a distinction the code cannot
make on its own, so `DRIVER_LABELS` in
[src/services/index.ts](../src/services/index.ts) names all three for the UI and
the menu and settings card cannot drift apart. [modes.md](modes.md) covers the
two modes for someone deciding how to run it.

A driver advertises what it can do — `kind`, `canPickFolder`, `canIndex`,
`canFetchPapers` — and the UI disables controls accordingly rather than failing
at call time; anything genuinely unsupported throws `UnsupportedOperation`.
Capability and mode are different questions: `canPickFolder` is false in both
non-desktop drivers for opposite reasons (the container has a real library and
will not look for another; the fixture has none at all), so a message explaining
_why_ a control is off must key off `kind`, not the capability.

The HTTP driver and the whole container were added without a single change
above `src/services/`, which is what the rule is for.

`isTauri()` picks the desktop driver at runtime. The other two are
indistinguishable at runtime — a container's bundle is served by a plain HTTP
server and looks identical to a static one — so that choice is made at _build_
time with `VITE_DRIVER=http` (`npm run build:http`). A runtime probe would be
worse: `library` is read synchronously when the first store is created, so
probing would make a slow server come up as an empty stand-in library.

---

## The Three Rust Crates

```text
core/        indexing, the JSON index, format probes, the media folders, arXiv. No GUI.
src-tauri/   the desktop shell: IPC commands, settings, asset scope, picker.
server/      HTTP: the same core, one route per LibraryService method.
```

Five modules: `index` walks the folder and reconciles what it finds, `catalog`
is the index file itself, `probe` reads PDFs, EPUBs and audio tags, `media`
walks the four folders that are not indexed, and `paper` fetches an arXiv PDF
into `books/` and indexes it. The index is JSON rather than a database because
**the library folder is the save file**: plain text diffs cleanly in version
control, reads without the app, and leaves no side files for a sync client to
copy half of. Paths in it are relative to the library root, so copying a folder
to another machine or OS strands nothing.

Keeping `core/` free of a GUI is what buys a server image that is a binary and a
folder of files, instead of a Linux box carrying a browser engine in order to
read a directory.

Each crate owns its errors. `core::Error` has no `Tauri` variant because nothing
in it can fail that way; the shell wraps it transparently, and the server turns
it into a status code and a line of text for the HUD.

Three decisions in `core/` worth knowing:

- **Book identity is content-based.** `book_id` hashes file length plus the first
  64 KiB, so moving or renaming a file keeps its shelf position and its reading
  progress, and two byte-identical files collapse into one book.
- **The release profile is not `panic = "abort"`.** Third-party format parsers
  panic on malformed files; the indexer catches unwinds per file so one
  unreadable book cannot take a scan down.
- **A scan skips unchanged files, so probes carry a version.** `is_current`
  compares size, mtime _and_ `probe::PROBE_VERSION`. Without the last one an
  improved probe would never reach a book already in the index, and no amount of
  rescanning would help. Bump it whenever a probe learns to extract something
  new; every older row is then re-probed once.

`server/` has no HTTP framework: a dozen routes, a static directory and byte
ranges is a few hundred lines of `TcpListener`. Byte ranges are not optional —
they are what makes a video seekable.

The one piece of security in the program is `is_allowed` in
[server/src/main.rs](../server/src/main.rs). A browser may read four directories
— `covers`, `music`, `artwork`, `video` — and every path is canonicalised and
checked against them before a byte is opened. Books are served by index id,
never by name, so the only files a browser can name are the ones the index
already told it about. ROMs follow the book's rule rather than the media rule: a
`.ch8` is a few kilobytes read once, so `/api/rom/<id>` resolves an id against
what `/api/roms` listed, and `roms/` never joins the readable directories.

---

## What Is Derived and What Is Stored

The spine of the front end.

**The layout document stores ids and orderings, not positions.** At its centre
`books.json` is `{ rows: { "shelfId:row": [bookId, ...] }, boxes: { boxId: [...] } }`.
Physical placement is recomputed every time: rows are packed left to right in
[src/scene/shelving.ts](../src/scene/shelving.ts), boxes bottom-up in
[src/world/boxes.ts](../src/world/boxes.ts). A book whose dimensions change
pushes its neighbours along instead of overlapping them. Rust stores the
document verbatim — the schema belongs entirely to the front end.

**The exceptions store real positions**, because "there, where I put it" cannot
be derived from an ordering: a book put down on a table or floor, a page or note
pinned to a wall, a record set down, and the small props (the cup, a can, a
takeaway box, the headlamp). Keep that list short.

**Book appearance is a pure function of index data.**
[src/data/dimensions.ts](../src/data/dimensions.ts) derives thickness from page
count, and height, depth and a stand-in colour from a hash of the book id —
arbitrary but stable, so a book always looks the same on the shelf. An EPUB has
no page count, so the probe measures the uncompressed length of the documents in
the archive, divided by what the reader fits on a page — the only signal that
tracks the text rather than the cover art. Once a cover has been read, the
binding colour is sampled from the artwork instead.

**The world document is never written by the app.** `library.json` is hand-edited
prose with comments in it. Everything the app decides about the room goes to
files beside it: where you shoved the boxes and what you wrote on a shelf into
`books.json`, which lamps are off and what the weather is doing into
`ambience.json`, your bookmarks and page notes into `annotations.json` — that
one page-numbered and title-carrying, so it reads without the app.
`deriveWorld(doc, overrides, boxEdits)` takes both as arguments for exactly
this reason.

**Everything geometric is derived from the document, every time.** Wall panels
with their openings cut out, floor slabs with the stairwells subtracted, roofs,
shelf transforms, colliders, the forest — all recomputed in
[src/world/derive.ts](../src/world/derive.ts). No incremental path can drift
from the file, which is what makes live reload safe.

---

## The Building

A room is an axis-aligned box with a list of which walls it builds, openings cut
into them, and an elevation.

- **A room can be over another room.** `elevation` puts a floor at a height and
  `holes` cuts a stairwell out of it. Rooms may overlap in plan as long as they
  are on different levels.
- **Colliders carry a vertical extent** (`Solid`), and
  [src/scene/walk.ts](../src/scene/walk.ts) flattens the ones at your own height
  to 2D before colliding — so the loft's balustrade is not a wall in the middle
  of the room below it.
- **`floorAt` answers "what am I standing on"**, treating a `stairs` piece as a
  ramp. A move is refused unless the floor it lands on is within `STEP_UP` of the
  one it left — which is both how stairs work and why you cannot walk off the
  loft.
- **A window blocks you and a door does not.** Wall colliders subtract only
  openings you could walk through. This is what makes a loft balustrade work: a
  wide unglazed window with a waist-high sill can be seen over but not walked
  off.
- **Only the topmost room over a patch of ground is roofed.** `roofsOf` derives
  that from the document rather than making you declare it, so a loft inside the
  great room's volume does not sprout a roof indoors. A roof's plane is pinned to
  the top of the walls and rises from there, and does not overhang into a
  building it abuts — otherwise a porch roof comes through the wall it is tucked
  under.

Collision is hand-rolled axis-separated AABB sliding in
[src/scene/collision.ts](../src/scene/collision.ts) — no physics engine,
deliberately, which also keeps `wasm-unsafe-eval` out of the desktop CSP.

## Outside

The ground is walkable. [src/world/terrain.ts](../src/world/terrain.ts) owns the
site — ground height, the lake, the beach, the path round the water, the trail
between the buildings, the brook, and the radius at which the world runs out —
and both the renderer and the walk controller read it, so a shoreline cannot be
seen in one place and stood in in another. `terrainAt` returns `null` in the
water and past the edge of the world, and a step is refused there exactly as it
is at a stairwell.

The brook runs out of the south-east forest, past the office's east window and
down into the lake. It is drawn from a polyline, the forest is kept off its
banks, and the walk controller refuses to step into it — except across the
beach, where it fans out shallow and fords. That exception is load bearing: a
brook that blocked to the waterline would cut the lakeside walk in two. The one
plank bridge is `BRIDGES`, and its deck is a height `terrainAt` returns like any
other floor.

The lake is an ellipse with a wobble: `shoreShape` puts a few low harmonics on
the outline so it reads as a pond rather than a compass drawing. Everything
defined in _shoreline units_ (the beach at `SHORE_EDGE`, the walk at `PATH`, the
tree line) deforms with it for free, since they are rings of the same function,
and the renderer builds the water and sand from `lakePoint`.

Set dressing in [src/scene/Outside.tsx](../src/scene/Outside.tsx) — rocks,
reeds, lily pads, boulders and stumps — and the forest floor in
[Undergrowth.tsx](../src/scene/Undergrowth.tsx) are seeded scenery in a handful
of instanced draw calls, placed either where the walk already refuses to go or
clear of the paths by the same `occupied` test the trees use. None of it needs a
collider. See [Atmosphere](#atmosphere) for the rules they share.

**A library folder can describe more than one building**, and the default one
does: the cabin, and the lake house above the south-west shore. That needed
nothing new in the format — a building is rooms somewhere else — but it did need
a route, and a route is a fact about the valley rather than about either
building, so `TRAIL` is a polyline here rather than in `library.json`.

[src/world/forest.ts](../src/world/forest.ts) follows the same rule: trees are
grown once in `deriveWorld` and both drawn and collided with from that one list,
since a collider seeded differently from the trunk you see is worse than none.
Only the trunk is solid.

## Weather

Rain is a switch saved beside the lamps, because "is it raining" is a room fact
in the way "is it night" is. Its two halves are separate on purpose: what falls
is instanced and follows you, since rain a hundred metres off is fog's problem;
what runs down the glass is a texture on the panes `windowPanes` already
derives, so a window added to any map is wet without being declared. One canvas
serves every pane and is repainted fifteen times a second — the upload is the
cost, not the drawing.

[src/scene/rainSound.ts](../src/scene/rainSound.ts) synthesises the sound rather
than playing a file: looping filtered noise through a low-pass whose cutoff
tracks how much sky is over you. `Sound.tsx` derives that from the room and the
openings `openingSpots` returns, so a window sounds different from the hearth.
Its level has its own slider.

The switches fade rather than cut.
[src/scene/ambienceBlend.ts](../src/scene/ambienceBlend.ts) holds two values —
how much night, how much rain — easing towards whatever the store says, advanced
once per frame by `Outside` and read imperatively by everything that colours the
world: the sky gradient, the fog, the clear colour, the lake, the sun and
window-reveal lights, the glow in lit glass, the chimney smoke. It sits outside
zustand for the reason `state/player.ts` does, and there is exactly one advancer
because two would double the speed.

## Atmosphere

A family of small modules makes the room read as a place: contact shadows and
lamp bloom indoors, dust in the lamplight, fireflies and falling leaves outside,
undergrowth on the forest floor, and the sky's dressing. All are built to the
same four rules:

- **One instanced mesh each** — a draw call or three, never a mesh per thing.
- **Seeded, not random.** `lib/rng.ts` is a `mulberry32` per module, so the same
  lamp gathers the same dust on every visit. Nothing here allocates or rolls a
  die in the frame loop.
- **Faded, not mounted.** A mote under a switched-off lamp is scaled to nothing
  rather than unmounted, and the night pieces gate themselves off by day through
  [ambienceBlend.ts](../src/scene/ambienceBlend.ts). Flipping a switch or `N`
  must not rebuild anything.
- **Low Performance Mode drops some but not all.** The dust, fireflies and
  leaves go entirely; undergrowth thins and the cloud bank drops from six banks
  to three. [ContactShadows.tsx](../src/scene/ContactShadows.tsx) and
  [LampGlow.tsx](../src/scene/LampGlow.tsx) are deliberately kept: with the
  shadow map off they are the only things grounding furniture and making a lit
  lamp read as lit, and they cost one draw call each.

## Lamps Are Not Lights

A lamp in `library.json` is a piece of furniture with a position. It is
deliberately _not_ a `<pointLight>`, and the reason is the single most expensive
fact about this renderer: three.js forward rendering has no per-object light
culling, so every point light in the scene is a term in every lit fragment's
shader — the pendant in the lake house is shading the pixels of the cabin, at
full price, all the time. The default map declares nearly forty lamps and window
reveals.

[src/scene/lightPool.ts](../src/scene/lightPool.ts) holds a fixed pool instead —
eight slots by default — and re-points them at the nearest lit candidates as you
walk. Three properties make it work:

- **The count never moves.** It is what every lit material is compiled against,
  so a pool that grew and shrank would recompile every shader in the room
  mid-stride. `lightBudget` changes it; walking never does.
- **A slot hands over dark.** It fades out, swaps candidate, fades back in, so a
  re-binding reads as a lamp passing out of range rather than as a flash.
- **Off means absent.** An unlit lamp is not a candidate at all, so switching the
  lights off now makes the room genuinely cheaper rather than merely darker. That
  was not true when every lamp stayed mounted at zero intensity.

Window reveals, and the fallback fixture a lamp-less room gets, are candidates on
the same terms — a reveal carries a small handicap so a wall of windows cannot
crowd a room's own lamps out of the pool. The two things that still mount their
own light are the television's glow and the campfire, both rare and both worth
their one recompile.

The sun is the exception that proves the rule: one directional light for the
whole world, with an 18 m shadow box that follows the camera and snaps to whole
texels. Covering the whole document instead meant 94 m across — 4.6 cm of world
per shadow texel, which is a full extra scene pass spent on mush.

Two shared modules hold the seams together.
[src/scene/sky.ts](../src/scene/sky.ts) owns where the sun and moon hang and the
radial glow everything is painted with — moon halo, sun disc, lamp bloom,
firefly, lake glint — so `SkyDressing`, `LampGlow` and `Outside` agree without
importing each other in a circle. [src/scene/geometry.ts](../src/scene/geometry.ts)
is the shared vocabulary for anything assembled out of boxes and merged per
material: the cat, the body, a shelf carcass, a room shell, a staircase.

## Sound

The deck and the television are furniture with positions, and so are you, so
volume and direction fall out of the two.
[src/scene/audioRig.ts](../src/scene/audioRig.ts) routes the element through a
`PannerNode` when a context can be had, and attenuates `element.volume` by
distance when one cannot. That fallback is load bearing: every Web Audio failure
lands on "distance but no direction", never on silence. The elements themselves
stay plain `<audio>` and `<video>` — see `state/media.ts`.

A building may have more than one record player, so `state/media.ts` records
_which_ deck a record went on. There is one audio element and one record
playing, so the deck is what tells the scene where the music comes from, and
what stops every other deck drawing the same disc on its platter.

**The room's own noises are synthesised, like the rain.**
[src/scene/ambientSound.ts](../src/scene/ambientSound.ts) is shaped noise: no
samples, no files, no dependency. Three kinds of sound — _loops_ that sit
somewhere at a level (a fire, the cat's purr, record dust, the lake, wind),
_one-shots_ fired by whatever caused them (a footfall keyed to the floor, a
landed book, a turned page, a door, thunder), and _choruses_, birds by day and
crickets after dark, which re-read their level at every firing so dusk arrives
phrase by phrase. `Sound.tsx` sets the levels from where you are standing;
everything else calls `playOneShot` at the moment of the event.

Two decisions carry the file. **One `AudioContext`**, opened on the first sound
and closed when the last is done, because browsers cap live contexts and the
rain holds one of its own. And **every failure falls back to silence** rather
than throwing, as the rain does. Its level has its own slider (**Small Sounds**).

---

## State, Split by Lifetime

| module                 | holds                                                                               | notes                                     |
| ---------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------- |
| `state/store.ts`       | session and UI: mode, crosshair focus, what is in your hands                        | zustand                                   |
| `state/library.ts`     | the catalogue, the shelving, progress, pins, board drawings, records you have moved | zustand; debounces layout saves by 600 ms |
| `state/annotations.ts` | bookmarks and page notes, in their own readable file                                | zustand; saves to `annotations.json`      |
| `state/world.ts`       | the parsed document and the derived world                                           | zustand                                   |
| `state/ambience.ts`    | which lamps are on, whether it is night, whether it is raining                      | zustand                                   |
| `state/settings.ts`    | what is about _this machine_, not this library                                      | zustand + `localStorage`                  |
| `state/media.ts`       | `music/` and `artwork/`, and which record is on which deck                          | zustand                                   |
| `state/video.ts`       | `video/`, and the tape in the machine                                               | zustand                                   |
| `state/arcade.ts`      | `roms/`, and the cartridge in the arcade machine                                    | zustand                                   |
| `state/covers.ts`      | cover images, two queues, one rate limit                                            | plain module                              |
| `state/pages.ts`       | page images for books left open in the _room_, not in the reader                    | plain module                              |
| `state/player.ts`      | position, yaw, pitch, crouch, zoom, the coffee's boost                              | **plain mutable object**                  |
| `state/cat.ts`         | where the cat is and what it is doing                                               | **plain mutable object**                  |
| `state/courier.ts`     | where the courier has got to, while a delivery is out                               | **plain mutable object**                  |
| `state/metrics.ts`     | draw calls, triangles, frames                                                       | **plain mutable object**                  |

The last four are outside zustand because they change every frame and must not
trigger a React render. The same rule puts more mutables outside `state/`
altogether, next to the code that advances them: `scene/ambienceBlend.ts` (how
much night, how much rain), `scene/shaderWarm.ts` (the headlamp's warm-up beam),
the running CHIP-8 beside `state/arcade.ts`, and a whiteboard's live stroke,
which gains a point per frame.

**The split between `ambience.ts` and `settings.ts` is worth stating.** Night,
rain and the lamps are facts about the _room_ and live in the library folder, so
they travel with it and `rm ambience.json` undoes them. Resolution scale, shadow
quality, the lamp budget, the body, the volume and the mouse sensitivity are
facts about the _machine_ and live in browser storage — a folder synced to
another computer must not carry an assertion about that computer's GPU.

Low Performance Mode is still one switch, and is now a _floor_ over those dials
rather than a branch at each use site: `effectiveQuality` in
[settings.ts](../src/state/settings.ts) is the one place the two are reconciled,
so the switch and the dials can never disagree.

`setPlacements` re-derives the world and therefore re-reconciles the whole
library, so it belongs on an _edit_ and never in a frame loop. Carrying a moving
box renders a preview and commits once, when you set it down.

---

## The Scene

**Interaction goes through instanced meshes.** Books, shelves, records, tapes
and loose books are all `InstancedMesh`. [src/scene/refs.ts](../src/scene/refs.ts)
is a module-level handle so the single per-frame raycast in `Interaction.tsx`
can reach them without threading refs through the tree for one consumer.
Furniture is published as _groups_ — seats, surfaces, fixtures, boxes, boards —
because the crosshair asks a different question of each, and asking all of them
of every table leg would be the one real per-frame cost.

**Printed spines come out of one atlas.** A cell holds one book: a spine strip
down the left and its cover on the right, with the geometry's UVs picking out
the two regions and a per-instance rectangle choosing the cell. That is what
lets a shelved book be a real book while the library stays one draw call. Cells
are recycled nearest-first, and a book too far away to read keeps none. The
atlas's total size is a per-pass upload cost, which fixes the budget at about
15 MB and makes cell size a straight trade against cell count — see
[src/scene/spineAtlas.ts](../src/scene/spineAtlas.ts). Tapes share the machinery
with a smaller grid of their own.

**Covers are rendered in the WebView and cached by Rust.** Rather than shipping
pdfium, the front end rasterises page one with pdf.js — already loaded for
reading — and posts it to be cached. `warmCovers` walks the catalogue in a
background lane behind anything urgent, so a library finishes rather than
resolving as you approach it.

**Book bytes come through a command, not the asset protocol.** The desktop asset
scope starts empty and is granted at runtime for exactly four directories —
covers, music, artwork, video — each only when something asks. Audio and video
are why those are directories rather than commands: a track or tape is streamed
while it plays. A ROM is read once at power-on, so `read_rom_file` is a command
like `read_book_file` and `roms/` never widens the scope.

**The arcade machine is a CHIP-8 interpreter in the front end.**
[src/arcade/chip8.ts](../src/arcade/chip8.ts) is the whole machine in one
dependency-free file, stepped per frame by `scene/Arcade.tsx` and painted onto a
64×32 `CanvasTexture` — an eight-kilobyte upload, the one dynamic texture cheap
enough to repaint every frame. Games come from `roms/`, listed like media
(walked on demand) and read like a book (by listing id). The bundled Pong is
assembled by [scripts/lib/make-chip8.mjs](../scripts/lib/make-chip8.mjs), and
the tests run that exact ROM on the interpreter, so the assembler, the ROM and
the CPU are held to agree.

**A dropped book gets gravity and friction** from
[src/scene/drop.ts](../src/scene/drop.ts) — forty lines, not a solver. It runs
per frame in `LooseBooks` and tells the store once, when the book stops.

**The small props are a fourth home for things that are not books.** The coffee
cup, the cans and the takeaway boxes are `props` in `books.json`: kind, one
`full` bit, and a real position, for the same reason `loose` stores one. There
is exactly one cup, id `cup`, waiting by the coffee maker when it is not out in
the room; cans and takeaway boxes are minted on arrival and destroyed by the
kitchen bin, which refuses the crockery. `E` takes and places, `F` drinks or
eats — the coffee writes `player.boostUntil`, read per frame by the walk
controller for a quarter more speed.

A **paper** is a delivery too: `E` at the telephone offers a takeaway or an
arXiv id, and [core/src/paper.rs](../core/src/paper.rs) downloads the PDF into
`books/arxiv/`, asks the arXiv API for its title, and indexes it — so what
arrives is an ordinary book, with no arXiv-shaped row anywhere. The fetch is in
the core rather than the page for two reasons: arxiv.org refuses cross-origin
requests, and the result is a file in the library folder, which nothing above
`src/services/` may write. It is the project's one networked dependency (`ureq`,
blocking and rustls-backed, so the container gains no async runtime and no
system OpenSSL).

The delivery is walked in by a courier
([src/state/courier.ts](../src/state/courier.ts), a per-frame mutable like the
cat): he comes out of the trees along the clearest straight lane, and the box
becomes a placed prop only when he reaches `deliverySpot` in
[src/world/derive.ts](../src/world/derive.ts) — the foot of the nearest `step`,
or the spawn in a map with none. His meshes mount only while a delivery is out.

The headlamp starts on the porch table and is _worn_, not held — session state,
both hands free — and comes off onto any bare tabletop as a placed prop. Its
beam ([src/scene/Headlamp.tsx](../src/scene/Headlamp.tsx)) is a camera-riding
spot light mounted only while worn, for the same shader-count reason as the
television's glow.

**A door is a lamp with a hinge.** The `door` kind stores one bit — standing
open — in `ambience.json` under the same keyed toggles the lamps use. The leaf's
swing is eased per frame in its own component. Whether it _blocks_ is the
interesting part: the static derivation does not know about ambience, so
`Player.tsx` adds a collider per closed door itself, rebuilt on the toggle — an
edit, not a frame cost. A `campfire` is a lamp too, but the indoor light switch
filters it out of "every light", so a switch plate cannot ignite a fire across
the lake. **A room with no walls, no roof and a stone floor is a campsite** —
the format needed nothing new, and being a room is what clears the forest around
it and makes its pad real floor.

---

## Nothing Shelves Itself

A newly indexed book goes into a moving box, not onto a shelf
([src/world/reconcile.ts](../src/world/reconcile.ts)), so a fresh library is
full boxes and empty shelves. Arrivals are levelled across the boxes book by
book, or a folder at a time with **One Box per Folder** on in settings
(`bookFolder` in `reconcile.ts` names the group; a folder is never split).

Unpacking is an interaction: `G` on a box runs `emptyBoxOntoShelves`, which
fills empty rows **nearest case first** (`nearestRowsFirst`, with the climb to
another storey weighted double); `E` takes one book out or puts one back.

The boxes are furniture you manage. `X` carries one; `Backspace` breaks an
_empty_ one down; `E` on the kitchen `boxstack` makes a new one up, which
becomes real furniture with a fresh `box-n` id when set down
(`spawnBox`/`deleteBox` in [src/state/library.ts](../src/state/library.ts)).
Both edits live in `books.json` (`spawnedBoxes`, `removedBoxes`), never in
`library.json`; a broken-down id stays burned so leftover layout entries cannot
attach to a later box. `deriveWorld` takes the edits as a third argument and
grows or filters the box furniture before anything downstream looks, so
reconciliation, packing and the raycast all see the true box population.

Reconciliation is the part most likely to lose somebody's arrangement, and has
the most tests. The rules:

- Move a bookcase and its books move with it. Reorder the file and nothing moves.
- Delete or rename one and its books go into boxes — but the _saved_ rows are
  kept, so putting the bookcase back puts its books back in it.
- Books new since the last layout go into boxes. A scan never rearranges a
  library you have already put in order.
- A book whose file is gone is simply gone, not reported as displaced.

---

## Read Mode

Opening a book docks the camera onto a page mesh; there is no mode to choose and
no way to be in read mode without a book. Docking rather than floating a panel
is what keeps a page at a readable size without a DPI the GPU cannot carry.

**Both formats open, and read mode does not know which it has.** Everything
above [src/reader/source.ts](../src/reader/source.ts) is written against "a
thing with pages you can rasterise" rather than against pdf.js, so the drag, the
turn, bookmarks, `J`, `N` and `P` work identically for both. Below it:

- a **PDF** is pdf.js;
- an **EPUB** is opened as a zip by [zip.ts](../src/reader/zip.ts) — the
  platform's own `DecompressionStream('deflate-raw')`, no dependency — reduced
  to headings and paragraphs by [epub.ts](../src/reader/epub.ts), and set in
  type by [epubPages.ts](../src/reader/epubPages.ts).

The limits are written at the top of `epub.ts`: an EPUB is a website in a zip
file and rendering one properly means a CSS engine. What is kept is the sequence
of headings and paragraphs; what is lost is the author's stylesheet, the images
and the navigation.

**Pagination happens once, in abstract units, at open time** rather than at the
texture's pixel size. Canvas metrics are linear in font size, so measuring at
one size and drawing at another is exact — and it buys the property that
matters: page 200 is page 200 on any monitor, in any window, next session.
Laying out per texture size would make a bookmark mean something different every
time.

Pages are held as textures with a small cache — the spread in hand plus one
either side — which is what makes a turn in either direction instant. Nothing
rasterises at commit time: the destination spread is rendered while the leaf is
still swinging, so the swap is atomic or it does not happen yet.

`P` tears a copy of the page out. The book keeps its own page, and the sheet
records which book and page number, so it is rasterised from the same file next
time it is drawn.

---

## Drawing on a Whiteboard

[src/scene/board.ts](../src/scene/board.ts) owns the strokes and the canvas each
board's face carries. Two decisions:

- a stroke is stored in **board space** — `u` across, `v` up, both 0 to 1 —
  rather than in metres or pixels, so a board resized in `library.json` keeps its
  drawing and the texture resolution stays a rendering decision;
- the **live stroke is a plain mutable object**, not store state. It gains a
  point per frame, so a render per point would be a render per frame; it is
  written to the layout once, when you let go.

[src/scene/Drawing.tsx](../src/scene/Drawing.tsx) reads the held mouse button and
raycasts the crosshair against `sceneRefs.boards`. It is the app's only
continuous input, which is why it is its own file rather than another branch in
`Player.tsx` beside the one-shot verbs.

---

## Records Are Things, Not a List

Records are _dealt_ — every `recordshelf` takes a slice of `music/` in folder
order — so a few hundred sleeves have somewhere to be with nothing written down.
Only records you have moved are stored: carried to another crate, or set down on
a table. Both are one entry rather than an ordering, since a crate has no order
worth keeping, and the deal honours explicit filings first so putting one away
is not immediately undone.

The consequence: there is **one of each record**. It is on whichever deck you
carried it to, an empty deck does nothing, and `F` takes one back off —
otherwise a record carried to a deck could never leave it, being hidden while it
plays.

---

## Where to Look for What

| you want to change          | start here                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| the shape of the building   | [src/world/schema.ts](../src/world/schema.ts), then `derive.ts`                                          |
| what a room looks like      | `src/scene/Rooms.tsx`, `Roofs.tsx`, `materials.ts`                                                       |
| a new piece of furniture    | `schema.ts` kinds → `derive.ts` sizes → `Furniture.tsx`                                                  |
| the outdoors                | `src/world/terrain.ts`, `forest.ts`, `src/scene/Outside.tsx`                                             |
| the dressing and the light  | `src/scene/Undergrowth.tsx`, `SkyDressing.tsx`, `LampGlow.tsx`, `ContactShadows.tsx`, `sky.ts`           |
| walking, stairs, collision  | `src/scene/walk.ts`, `collision.ts`, `Player.tsx`                                                        |
| what the crosshair offers   | `src/scene/Interaction.tsx`                                                                              |
| a new key                   | `Player.tsx` (E), `Handling.tsx` (the rest), `Reader.tsx` (reading), `Drawing.tsx` (a held mouse button) |
| how a book looks on a shelf | `src/scene/spineAtlas.ts`, `bookMaterial.ts`, `Books.tsx`                                                |
| reading                     | `src/reader/`                                                                                            |
| the filesystem              | `src/services/`, then `core/`, `src-tauri/`, `server/`                                                   |
| sound                       | `src/scene/Sound.tsx`, `audioRig.ts`, `rainSound.ts`, `ambientSound.ts`                                  |
| what a whiteboard holds     | `src/scene/board.ts`, `Drawing.tsx`                                                                      |

## Conventions

- Comments explain _why_ a decision was made, briefly. A line or two, no
  narrative and no history of what the code used to be.
- UI labels, headings and buttons are Headline Case; the phrase after a `<kbd>`
  is sentence case.
- `npm run lint` (oxlint) and `npm run lint:rust` (clippy) both gate `verify`.
- TypeScript is strict with `noUncheckedIndexedAccess` and `noUnusedLocals`;
  `tsconfig.json` covers `src`, `tests`, `scripts` and the config files.
- Assertions are on measurable facts — draw calls, triangles, frames, zero
  console errors. Screenshots are for a human to glance at, not for comparison.
- Fixed ports: Vite dev 5180, Playwright preview 5190, desktop CDP probe 9223,
  the server 8080.

See [development.md](development.md) for the commands and the testing strategy.
