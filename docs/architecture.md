# Architecture

kleib3ry is a 3D personal library: your own PDFs and EPUBs on shelves you place,
in a building you describe in a text file, read as physical books. This document
is the map — what the pieces are, which way the dependencies point, and why the
awkward decisions were made the way they were.

If you only read one section, read [the one rule](#the-one-rule) and
[what is derived and what is stored](#what-is-derived-and-what-is-stored). Those
two shape everything else.

```text
                         ┌───────────────────────────────┐
   you edit  ──────────► │  <library>/.library/          │
                         │    library.json   the rooms   │
                         │    books.json     the layout  │ ◄──── the app writes
                         │    ambience.json  lamps, sky  │
                         │    index.sqlite   the scan    │
                         │    covers/        artwork     │
                         └───────────────────────────────┘
                                        ▲
                     ┌──────────────────┴──────────────────┐
                 DESKTOP APP                        HOSTED (container)
                     │                                     │
            ┌────────┴────────┐                   ┌────────┴────────┐
            │  core/          │                   │  core/          │
            │  index, db,     │                   │  (same crate)   │
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
            │  src/state/   zustand stores + three mutable objects  │
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
                    furniture, tapes, pinned pages, the forest outside, the
                    spine atlas that prints titles, and the little bit of
                    gravity that dropped books fall under
  reader/           read mode: page cache, page mesh, the turn
  state/            zustand stores: world, library, ambience, media, video, and
                    the session store; plus player, cat and metrics,
                    deliberately outside React
  data/             placeholder catalogue + book proportions
  ui/               DOM overlay: crosshair, focus cards, panels, typed fields
core/               Rust: indexing, SQLite, format + tag probes, media folders.
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

| driver          | mode                       | filesystem          | picker                        | indexes |
| --------------- | -------------------------- | ------------------- | ----------------------------- | ------- |
| `tauriDriver`   | **desktop app**            | Rust core over IPC  | native dialog                 | yes     |
| `httpDriver`    | **hosted** — the container | Rust core over HTTP | no — the mount is the library | yes     |
| `browserDriver` | none; a test fixture       | none; localStorage  | no                            | no      |

Two of those are shipped modes and the third is a fixture, which is a
distinction the code cannot make on its own — `DRIVER_LABELS` in
[src/services/index.ts](../src/services/index.ts) is where the three are given
the names the UI shows, so the menu and the settings card cannot drift apart.
[modes.md](modes.md) is the two modes written out for someone deciding how to
run it.

A driver _advertises_ what it can do — `kind`, `canPickFolder`, `canIndex` — and
the UI disables controls accordingly rather than failing at call time. Anything
genuinely unsupported throws `UnsupportedOperation`. Note that the capability
and the mode are not the same question: `canPickFolder` is false in both
non-desktop drivers for opposite reasons — the container has a real library and
will not go looking for another, the fixture has no library at all — so a
message about _why_ a control is off has to key off `kind`, not off the
capability.

This is the rule that earned its keep. The HTTP driver and the container were
added without a single change above `src/services/`, which is exactly what it was
written down for.

`isTauri()` picks the desktop driver at runtime. The other two cannot be told
apart at runtime — a container's bundle is served by a plain HTTP server and
looks identical to a static one — so that choice is made at _build_ time with
`VITE_DRIVER=http` (`npm run build:http`). See
[src/services/index.ts](../src/services/index.ts) for why a runtime probe would
be worse: `library` is read synchronously when the first store is created, so a
probe would mean a slow server coming up as an empty stand-in library.

---

## The Three Rust Crates

```text
core/        indexing, SQLite, format probes, the media folders.  No GUI.
src-tauri/   the desktop shell: IPC commands, settings, asset scope, picker.
server/      HTTP: the same core, one route per LibraryService method.
```

`core/` was carved out of `src-tauri/` when the container arrived, and nothing
moved _logically_ — those four modules never mentioned Tauri once. What it buys
is a server image that is a binary and a folder of files instead of a Linux box
carrying a browser engine in order to read a directory.

Each crate owns its errors. `core::Error` has no `Tauri` variant because nothing
in it can fail that way; the shell wraps it transparently, and the server turns
it into a status code and a line of text destined for the HUD.

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

`server/` has no HTTP framework. The whole surface is a dozen routes, a static
directory and byte ranges, which is a few hundred lines of `TcpListener` — the
same argument the front end makes for hand-rolling its collision and the probe
makes for reading ID3 without a crate. Byte ranges are not optional: they are
what makes a video seekable.

The one piece of security in the program is `is_allowed` in
[server/src/main.rs](../server/src/main.rs). A browser may read four directories
— `covers`, `music`, `artwork`, `video` — and every path is canonicalised and
checked against them before a byte is opened. Books are served by index id, never
by name, so the only files a browser can name are the ones the index already told
it about.

---

## What Is Derived and What Is Stored

This is the spine of the front end.

**The layout document stores ids and orderings, not positions.** At its centre
`books.json` is `{ rows: { "shelfId:row": [bookId, ...] }, boxes: { boxId: [...] } }`.
Physical placement is recomputed every time: rows are packed
left to right in [src/scene/shelving.ts](../src/scene/shelving.ts), boxes are
packed bottom-up in [src/world/boxes.ts](../src/world/boxes.ts). A book whose
dimensions change pushes its neighbours along instead of overlapping them. Rust
stores the document verbatim — the schema belongs entirely to the front end.

**The exceptions are the things whose whole point is "there".** A book put down
on a table or dropped on the floor stores an actual position, because "there,
where I put it" cannot be derived from an ordering. So does a page or a note
pinned to a wall, and so does a record set down on a table. Three exceptions,
and the list is worth keeping that short.

**Book appearance is a pure function of index data.**
[src/data/dimensions.ts](../src/data/dimensions.ts) derives thickness from page
count, and height, depth and a stand-in colour from a hash of the book id —
arbitrary but stable, so a book always looks the same on the shelf. An EPUB has
no page count, so the probe measures the uncompressed length of the documents in
the archive and that is divided by what the reader fits on a page: the only
signal that tracks the _text_ rather than the cover art. Once its cover has been
read, the binding colour is sampled from the artwork instead, so a shelf of your
books looks like _your_ books from across the room.

**The world document is never written by the app.** `library.json` is hand-edited
prose with comments in it. Everything the app decides about the room goes to
files beside it: where you shoved the boxes and what you wrote on a shelf into
`books.json`, which lamps are off and what the weather is doing into
`ambience.json`. `deriveWorld(doc, overrides, boxEdits)` takes both as arguments
for exactly this reason.

**Everything geometric is derived from the document, every time.** Wall panels
with their openings cut out, floor slabs with the stairwells subtracted, roofs,
shelf transforms, colliders, the forest — all of it recomputed in
[src/world/derive.ts](../src/world/derive.ts). There is no incremental path that
can drift from the file, which is what makes live reload safe: save an edit in
any editor and the room rebuilds while you are standing in it.

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
  floor it left. That single check is both how stairs work and why you cannot
  walk off the loft.
- **A window blocks you and a door does not.** Wall _colliders_ subtract only
  openings you could actually walk through, which is what makes a loft balustrade
  work: a very wide unglazed window with a waist-high sill is something you can
  see the room over and cannot walk off.
- **Only the topmost room over a patch of ground is roofed.** `roofsOf` works that
  out from the document rather than making you declare it, so the loft inside the
  great room's volume and the reading corner under the bedroom do not sprout
  roofs indoors. A roof's plane is pinned to the _top of the walls_ and rises from
  there, and it does not overhang into a building it leans on — otherwise a porch
  roof comes out through the wall it is tucked under.

Collision is hand-rolled axis-separated AABB sliding in
[src/scene/collision.ts](../src/scene/collision.ts) — no physics engine,
deliberately, which also keeps `wasm-unsafe-eval` out of the desktop CSP.

## Outside

The ground is walkable. [src/world/terrain.ts](../src/world/terrain.ts) owns the
site — the ground height, the lake, the beach, the path round the water, the
trail between the buildings, and the radius at which the world runs out — and
both the renderer and the walk controller read it. That shared ownership is the
point: a shoreline you can _see_ in one place and _stand in_ in another is the
bug the module exists to prevent. `terrainAt` returns `null` in the water and
past the edge of the world, which is the same answer a stairwell gives and
refuses a step for the same reason.

The lake is an ellipse with a wobble on it — `shoreShape` puts a few low
harmonics on the outline, so it reads as a pond rather than a compass drawing.
Everything defined in _shoreline units_ (the beach at `SHORE_EDGE`, the walk at
`PATH`, the tree line) deforms with it for free, because they are all rings of
the same function; the renderer builds the water and the sand from `lakePoint`,
which is that function again. The set dressing in
[src/scene/Outside.tsx](../src/scene/Outside.tsx) — rocks half in the shallows,
reed clumps, lily pads, and boulders and stumps through the forest — is seeded
scenery in a handful of instanced draw calls, standing either where the walk
already refuses to go or clear of the paths via the same `occupied` test the
trees are grown with. None of it needs a collider.

**A library folder can describe more than one building**, and the default one
does: the cabin, and the lake house on the rise above the south-west shore. That
needed nothing new in the format — a building is rooms somewhere else — but it
did need a route, and a route is a fact about the valley rather than about
either building. So `TRAIL` is a polyline here, drawn by `Outside` and kept
clear of trees by `forest.ts`, for the same reason the lake is a function here
rather than four radii in `library.json`.

[src/world/forest.ts](../src/world/forest.ts) is the same argument again. Trees
are grown once in `deriveWorld` and both drawn and collided with from that one
list; a collider generated from a different seed than the trunk you can see would
be worse than no collider at all. Only the trunk is solid — pushing through
branches is what walking in a forest is.

## Weather

Rain is a switch, saved beside the lamps, because "is it raining" is a fact
about the room in exactly the way "is it night" is. It has two halves and they
are separate on purpose: what falls is instanced and follows you, since rain a
hundred metres off is fog's problem; what runs down the glass is a texture on
the panes `windowPanes` already derives, so a window somebody adds to their own
map is wet without anybody having said so. One canvas serves every pane in the
building and is repainted fifteen times a second — water on glass moves slowly,
and the upload is the cost, not the drawing.

You can hear it too. [src/scene/rainSound.ts](../src/scene/rainSound.ts)
synthesises the rain rather than playing a file: looping filtered noise through a
low-pass whose cutoff tracks how much sky is over you. `Sound.tsx` works that out
from the document — outdoors is all of it, a porch nearly all of it, and indoors
is what leaks through the openings `openingSpots` derives, so standing at a
window sounds different from standing at the hearth. Its level is its own slider,
because weather that is right for one person is a downpour for the next.

The switches themselves fade rather than cut.
[src/scene/ambienceBlend.ts](../src/scene/ambienceBlend.ts) holds two values —
how much night, how much rain — easing towards whatever the store says, advanced
once per frame by `Outside` and read imperatively by everything that colours the
world: the sky's repainted gradient, the fog, the clear colour, the lake, the
sun and the window-reveal lights, the glow in a lit room's glass, the chimney
smoke. It lives outside zustand for the reason `state/player.ts` does — it moves
every frame of a transition and must not render React — and there is exactly one
advancer because two would double the speed. Flipping `N` is therefore a dusk,
not a light switch.

## Sound

The deck and the television are furniture with positions, and you have a
position, so volume and direction fall out of the two.
[src/scene/audioRig.ts](../src/scene/audioRig.ts) routes the element through a
`PannerNode` when a context can be had and attenuates `element.volume` by
distance when one cannot. The fallback is the load-bearing part: every failure
mode of Web Audio lands on "distance but no direction", which is most of the
effect and is never silence. The elements themselves are still plain `<audio>`
and `<video>` for all the reasons `state/media.ts` gives.

A building may have more than one record player, so `state/media.ts` records
_which_ deck a record went on. There is one audio element and one record playing,
so the deck is what tells the scene where in the house the music is coming from —
and what stops every other deck in the building drawing the same disc on its
platter.

---

## State, Split by Lifetime

| module              | holds                                                                                          | notes                                     |
| ------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `state/store.ts`    | session and UI: mode, crosshair focus, what is in your hands                                   | zustand                                   |
| `state/library.ts`  | the catalogue, the shelving, bookmarks, progress, pins, board drawings, records you have moved | zustand; debounces layout saves by 600 ms |
| `state/world.ts`    | the parsed document and the derived world                                                      | zustand                                   |
| `state/ambience.ts` | which lamps are on, whether it is night, whether it is raining                                 | zustand                                   |
| `state/settings.ts` | what is about _this machine_, not this library                                                 | zustand + `localStorage`                  |
| `state/media.ts`    | `music/` and `artwork/`, and which record is on which deck                                     | zustand                                   |
| `state/video.ts`    | `video/`, and the tape in the machine                                                          | zustand                                   |
| `state/covers.ts`   | cover images, two queues, one rate limit                                                       | plain module                              |
| `state/pages.ts`    | page images for books left open in the _room_, not in the reader                               | plain module                              |
| `state/player.ts`   | position, yaw, pitch, crouch, zoom                                                             | **plain mutable object**                  |
| `state/cat.ts`      | where the cat is and what it is doing                                                          | **plain mutable object**                  |
| `state/metrics.ts`  | draw calls, triangles, frames                                                                  | **plain mutable object**                  |

The last three are deliberately outside zustand: they change every frame and
must not trigger a React render.

**The split between `ambience.ts` and `settings.ts` is the one worth stating.**
Night, rain and the lamps are facts about the _room_ and live in the library
folder, so they travel with it and `rm ambience.json` undoes them. Low
Performance Mode, the body, the volume and the mouse sensitivity are facts about
the _machine_, so they live in browser storage keyed by the app — a folder you
sync to another computer must not carry an assertion about that computer's GPU.

`setPlacements` re-derives the world and therefore re-reconciles the whole
library, so it belongs on an _edit_ and never in a frame loop. Carrying a moving
box renders a preview and commits once, when you set it down.

---

## The Scene

**Interaction goes through instanced meshes.** Books, shelves, records, tapes and
loose books are all `InstancedMesh`. [src/scene/refs.ts](../src/scene/refs.ts) is
a module-level handle so the single per-frame raycast in `Interaction.tsx` can
reach them without threading refs through the tree for one consumer. Furniture is
published as _groups_ — seats, surfaces, fixtures, boxes, boards — because the
crosshair asks a different question of each, and asking all of them of every
table leg in the cabin is the one thing in the frame that would actually cost
something.

**Printed spines come out of one atlas.** A cell holds one book: a spine strip
down the left and its cover on the right, with the geometry's UVs picking out the
two regions and a per-instance rectangle choosing the cell. That is what lets a
shelved book be a real book while the whole library stays one draw call. Cells
are recycled nearest-first, and a book too far away to read keeps no cell at all.
The atlas's _total size_ is a per-pass upload cost, which fixes the budget at
about 15 MB and makes cell size a straight trade against cell count — see
[src/scene/spineAtlas.ts](../src/scene/spineAtlas.ts), where that trade is
written down with the numbers. The tapes share the machinery with a grid of their
own, because a crate of a dozen cassettes does not want eighty-eight cells.

**Covers are rendered in the WebView and cached by Rust.** Rather than shipping
pdfium, the front end rasterises page one with pdf.js — which it already loads
for reading — and posts it to be cached like any other cover. `warmCovers` walks
the whole catalogue in a background lane behind anything urgent, so a library
finishes rather than resolving as you approach it.

**Book bytes come through a command, not the asset protocol.** The desktop asset
scope starts empty and is granted at runtime for exactly four directories —
covers, music, artwork, video — each only when something asks. Audio and video
are the reason those are directories rather than commands: a track or a tape is
streamed while it plays.

**A dropped book gets gravity and friction** from
[src/scene/drop.ts](../src/scene/drop.ts), which is forty lines and not a solver.
It runs per frame in `LooseBooks` and tells the store _once_, when the book stops.

---

## Nothing Shelves Itself

A newly indexed book goes into a moving box, not onto a shelf
([src/world/reconcile.ts](../src/world/reconcile.ts)), so a fresh library is full
boxes and empty shelves. Arrivals are levelled across the boxes book by book —
or, with **One Box per Folder** switched on in settings, a folder of `books/` at
a time, so a first scan comes out of the van pre-sorted (`bookFolder` in
`reconcile.ts` names the group; a folder is never split across boxes).

Unpacking is an interaction: `G` on a box runs `emptyBoxOntoShelves`, which
fills empty rows **nearest case first** (`nearestRowsFirst` — carry the box to
the case you mean to fill, with the climb to another storey weighted double);
`E` takes one book out or puts one back.

The boxes themselves are yours to manage. `X` carries one; `Backspace` breaks an
_empty_ one down; `E` on the `boxstack` in the kitchen makes a new one up, which
becomes real furniture — with a fresh `box-n` id — when it is set down
(`spawnBox`/`deleteBox` in [src/state/library.ts](../src/state/library.ts)).
Both edits live in `books.json` (`spawnedBoxes`, `removedBoxes`, schema 7) and
never in `library.json`, exactly like the shoved-furniture overrides; a
broken-down id stays burned so its leftover layout entries cannot haunt a later
box. `deriveWorld` takes the edits as a third argument and grows or filters the
box furniture before anything downstream looks, so reconciliation, packing and
the raycast all see the true box population without knowing the feature exists.

Reconciliation is the part most likely to lose somebody's arrangement, and so the
part with the most tests. The rules:

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
thing with pages you can rasterise" rather than against pdf.js, which is what
lets the drag, the turn, the bookmarks, `J` and `P` all work identically for an
EPUB. Below it there are two implementations:

- a **PDF** is pdf.js, as before;
- an **EPUB** is opened as a zip by [zip.ts](../src/reader/zip.ts) — the
  platform's own `DecompressionStream('deflate-raw')`, no dependency — reduced
  to headings and paragraphs by [epub.ts](../src/reader/epub.ts), and set in
  type by [epubPages.ts](../src/reader/epubPages.ts).

The honest limits are written at the top of `epub.ts`. An EPUB is a website in a
zip file and rendering one _properly_ means a CSS engine; what is kept is the
sequence of headings and paragraphs, which is the book, and what is lost is the
author's stylesheet, the images and the navigation.

The one decision in the type setting worth knowing is that **pagination happens
once, in abstract units, at open time** rather than at whatever pixel size the
texture wants. Canvas metrics are linear in font size, so measuring at one size
and drawing at another is exact — and it buys the property that matters: page
200 is page 200 on any monitor, in any window, next session. Laying out per
texture size would make a bookmark a number that meant something different every
time, which is not a bookmark.

Pages are held as textures with a tiny cache: the spread in hand plus one either
side, which is what makes a turn in either direction instant. Nothing rasterises
at commit time; the destination spread is rendered while the leaf is still
swinging, so the swap is atomic or it does not happen yet.

`P` tears a copy of the page out — the book keeps its own page, and the sheet
records which book and which page number, so it is rasterised from the same file
next time it is drawn. "Tear out" is the gesture, not the effect.

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
raycasts the crosshair against `sceneRefs.boards`. It is the one continuous input
in the app, which is why it is its own file rather than another branch in
`Player.tsx` alongside the one-shot verbs.

---

## Records Are Things, Not a List

Records are _dealt_ — every `recordshelf` takes a slice of the music folder in
folder order — so a few hundred sleeves have somewhere to be with nothing
written down. What is written down is only what you have had an opinion about: a
record carried to another crate, or set down on a table. Both are one entry
rather than an ordering, because unlike a shelf a crate has no order worth
keeping, and the deal honours explicit filings first so putting one away is not
immediately undone.

The consequence worth stating: there is **one of each record**. It is on
whichever deck you carried it to, a deck with nothing on it does not help itself
to the first record in the folder, and `F` takes one back off — otherwise a
record carried to a deck could never be carried away from one, since it is hidden
while it plays.

---

## Where to Look for What

| you want to change          | start here                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| the shape of the building   | [src/world/schema.ts](../src/world/schema.ts), then `derive.ts`                                          |
| what a room looks like      | `src/scene/Rooms.tsx`, `Roofs.tsx`, `materials.ts`                                                       |
| a new piece of furniture    | `schema.ts` kinds → `derive.ts` sizes → `Furniture.tsx`                                                  |
| the outdoors                | `src/world/terrain.ts`, `forest.ts`, `src/scene/Outside.tsx`                                             |
| walking, stairs, collision  | `src/scene/walk.ts`, `collision.ts`, `Player.tsx`                                                        |
| what the crosshair offers   | `src/scene/Interaction.tsx`                                                                              |
| a new key                   | `Player.tsx` (E), `Handling.tsx` (the rest), `Reader.tsx` (reading), `Drawing.tsx` (a held mouse button) |
| how a book looks on a shelf | `src/scene/spineAtlas.ts`, `bookMaterial.ts`, `Books.tsx`                                                |
| reading                     | `src/reader/`                                                                                            |
| the filesystem              | `src/services/`, then `core/`, `src-tauri/`, `server/`                                                   |
| sound                       | `src/scene/Sound.tsx`, `audioRig.ts`, `rainSound.ts`                                                     |
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
