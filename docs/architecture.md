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
                         │    lights.json    lamps, sky  │
                         │    index.sqlite   the scan    │
                         │    covers/        artwork     │
                         └───────────────────────────────┘
                                        ▲
                     ┌──────────────────┴──────────────────┐
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

## The one rule

**Nothing above `src/services/` may import `@tauri-apps/*`.**

Every byte the front end reads from a disk goes through the `LibraryService`
interface in [../src/services/types.ts](../src/services/types.ts). There are
three implementations:

| driver | host | filesystem | picker | indexes |
| --- | --- | --- | --- | --- |
| `tauriDriver` | the desktop app | Rust core over IPC | native dialog | yes |
| `httpDriver` | a browser, container | Rust core over HTTP | no — the mount is the library | yes |
| `browserDriver` | a plain browser tab | none; localStorage | no | no |

A driver *advertises* what it can do — `kind`, `canPickFolder`, `canIndex` — and
the UI disables controls accordingly rather than failing at call time. Anything
genuinely unsupported throws `UnsupportedOperation`.

This is the rule that earned its keep. The HTTP driver and the container were
added without a single change above `src/services/`, which is exactly what it was
written down for.

`isTauri()` picks the desktop driver at runtime. The other two cannot be told
apart at runtime — a container's bundle is served by a plain HTTP server and
looks identical to a static one — so that choice is made at *build* time with
`VITE_DRIVER=http` (`npm run build:http`). See
[src/services/index.ts](../src/services/index.ts) for why a runtime probe would
be worse: `library` is read synchronously when the first store is created, so a
probe would mean a slow server coming up as an empty stand-in library.

---

## The three Rust crates

```text
core/        indexing, SQLite, format probes, the media folders.  No GUI.
src-tauri/   the desktop shell: IPC commands, settings, asset scope, picker.
server/      HTTP: the same core, one route per LibraryService method.
```

`core/` was carved out of `src-tauri/` when the container arrived, and nothing
moved *logically* — those four modules never mentioned Tauri once. What it buys
is a server image that is a binary and a folder of files instead of a Linux box
carrying a browser engine in order to read a directory.

Each crate owns its errors. `core::Error` has no `Tauri` variant because nothing
in it can fail that way; the shell wraps it transparently, and the server turns
it into a status code and a line of text destined for the HUD.

Two decisions in `core/` worth knowing:

- **Book identity is content-based.** `book_id` hashes file length plus the first
  64 KiB, so moving or renaming a file keeps its shelf position and its reading
  progress, and two byte-identical files collapse into one book.
- **The release profile is not `panic = "abort"`.** Third-party format parsers
  panic on malformed files; the indexer catches unwinds per file so one
  unreadable book cannot take a scan down.

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

## What is derived and what is stored

This is the spine of the front end.

**The layout document stores ids and orderings, not positions.**
`books.json` is `{ rows: { "shelfId:row": [bookId, ...] }, boxes: { boxId: [...] } }`
and nothing more. Physical placement is recomputed every time: rows are packed
left to right in [src/scene/shelving.ts](../src/scene/shelving.ts), boxes are
packed bottom-up in [src/world/boxes.ts](../src/world/boxes.ts). A book whose
dimensions change pushes its neighbours along instead of overlapping them. Rust
stores the document verbatim — the schema belongs entirely to the front end.

**The exceptions are the things whose whole point is "there".** A book put down
on a table or dropped on the floor stores an actual position, because "there,
where I put it" cannot be derived from an ordering. So does a page or a note
pinned to a wall. Both are worth keeping as the only exceptions.

**Book appearance is a pure function of index data.**
[src/data/dimensions.ts](../src/data/dimensions.ts) derives thickness from page
count (estimated from file size for EPUBs, which have none) and height, depth and
a stand-in colour from a hash of the book id — arbitrary but stable, so a book
always looks the same on the shelf. Once its cover has been read, the binding
colour is sampled from the artwork instead, so a shelf of your books looks like
*your* books from across the room.

**The world document is never written by the app.** `library.json` is hand-edited
prose with comments in it. Everything the app decides about the room goes to
files beside it: where you shoved the boxes and what you wrote on a shelf into
`books.json`, which lamps are off into `lights.json`. `deriveWorld(doc,
overrides)` takes the furniture overrides as an argument for exactly this reason.

**Everything geometric is derived from the document, every time.** Wall panels
with their openings cut out, floor slabs with the stairwells subtracted, roofs,
shelf transforms, colliders, the forest — all of it recomputed in
[src/world/derive.ts](../src/world/derive.ts). There is no incremental path that
can drift from the file, which is what makes live reload safe: save an edit in
any editor and the room rebuilds while you are standing in it.

---

## The building

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
- **A window blocks you and a door does not.** Wall *colliders* subtract only
  openings you could actually walk through, which is what makes a loft balustrade
  work: a very wide unglazed window with a waist-high sill is something you can
  see the room over and cannot walk off.
- **Only the topmost room over a patch of ground is roofed.** `roofsOf` works that
  out from the document rather than making you declare it, so the loft inside the
  great room's volume and the reading corner under the bedroom do not sprout
  roofs indoors. A roof's plane is pinned to the *top of the walls* and rises from
  there, and it does not overhang into a building it leans on — otherwise a porch
  roof comes out through the wall it is tucked under.

Collision is hand-rolled axis-separated AABB sliding in
[src/scene/collision.ts](../src/scene/collision.ts) — no physics engine,
deliberately, which also keeps `wasm-unsafe-eval` out of the desktop CSP.

## Outside

The ground is walkable. [src/world/terrain.ts](../src/world/terrain.ts) owns the
site — the ground height, the lake as an ellipse, the beach, the path round the
water, the trail between the buildings, and the radius at which the world runs
out — and both the renderer and the walk controller read it. That shared
ownership is the point: a shoreline you can *see* in one place and *stand in* in
another is the bug the module exists to prevent. `terrainAt` returns `null` in
the water and past the edge of the world, which is the same answer a stairwell
gives and refuses a step for the same reason.

**A library folder can describe more than one building**, and the default one
does: the cabin, and the lake house on the rise above the south-west shore. That
needed nothing new in the format — a building is rooms somewhere else — but it
did need a route, and a route is a fact about the valley rather than about
either building. So `TRAIL` is a polyline here, drawn by `Outside` and kept
clear of trees by `forest.ts`, for the same reason the lake is an ellipse here
rather than four radii in `library.json`.

## Weather

Rain is a switch, saved beside the lamps, because "is it raining" is a fact
about the room in exactly the way "is it night" is. It has two halves and they
are separate on purpose: what falls is instanced and follows you, since rain a
hundred metres off is fog's problem; what runs down the glass is a texture on
the panes `windowPanes` already derives, so a window somebody adds to their own
map is wet without anybody having said so. One canvas serves every pane in the
building and is repainted fifteen times a second — water on glass moves slowly,
and the upload is the cost, not the drawing.

## Sound

The deck and the television are furniture with positions, and you have a
position, so volume and direction fall out of the two.
[src/scene/audioRig.ts](../src/scene/audioRig.ts) routes the element through a
`PannerNode` when a context can be had and attenuates `element.volume` by
distance when one cannot. The fallback is the load-bearing part: every failure
mode of Web Audio lands on "distance but no direction", which is most of the
effect and is never silence. The elements themselves are still plain `<audio>`
and `<video>` for all the reasons `state/media.ts` gives.

The forest moved to [src/world/forest.ts](../src/world/forest.ts) for the same
reason. Trees are grown once in `deriveWorld` and both drawn and collided with
from that one list; a collider generated from a different seed than the trunk you
can see would be worse than no collider at all. Only the trunk is solid — pushing
through branches is what walking in a forest is.

---

## State, split by lifetime

| module | holds | notes |
| --- | --- | --- |
| `state/store.ts` | session and UI: mode, crosshair focus, what is in your hands | zustand |
| `state/library.ts` | the catalogue, the shelving, bookmarks, progress, pins | zustand; debounces layout saves by 600 ms |
| `state/world.ts` | the parsed document and the derived world | zustand |
| `state/lights.ts` | which lamps are on, whether it is night, whether it is raining | zustand |
| `state/settings.ts` | what is about *this machine*, not this library | zustand + `localStorage` |
| `state/media.ts` | `music/` and `artwork/`, and the record on the deck | zustand |
| `state/video.ts` | `video/`, and the tape in the machine | zustand |
| `state/covers.ts` | cover images, two queues, one rate limit | plain module |
| `state/player.ts` | position, yaw, pitch, crouch, zoom | **plain mutable object** |
| `state/cat.ts` | where the cat is and what it is doing | **plain mutable object** |
| `state/metrics.ts` | draw calls, triangles, frames | **plain mutable object** |

The last three are deliberately outside zustand: they change every frame and
must not trigger a React render.

**The split between `lights.ts` and `settings.ts` is the one worth stating.**
Night and rain are facts about the *room* and live in the library folder, so
they travel with it and `rm lights.json` undoes them. Low performance mode, the
body, the volume and the mouse sensitivity are facts about the *machine*, so
they live in browser storage keyed by the app — a folder you sync to another
computer must not carry an assertion about that computer's GPU.

`setPlacements` re-derives the world and therefore re-reconciles the whole
library, so it belongs on an *edit* and never in a frame loop. Carrying a moving
box renders a preview and commits once, when you set it down.

---

## The scene

**Interaction goes through instanced meshes.** Books, shelves, records, tapes and
loose books are all `InstancedMesh`. [src/scene/refs.ts](../src/scene/refs.ts) is
a module-level handle so the single per-frame raycast in `Interaction.tsx` can
reach them without threading refs through the tree for one consumer. Furniture is
published as *groups* — seats, surfaces, fixtures, boxes, boards — because the
crosshair asks a different question of each, and asking all of them of every
table leg in the cabin is the one thing in the frame that would actually cost
something.

**Printed spines come out of one atlas.** A cell holds one book: a spine strip
down the left and its cover on the right, with the geometry's UVs picking out the
two regions and a per-instance rectangle choosing the cell. That is what lets a
shelved book be a real book while the whole library stays one draw call. Cells
are recycled nearest-first, and a book too far away to read keeps no cell at all.
The atlas's *total size* is a per-pass upload cost, which fixes the budget at
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
It runs per frame in `LooseBooks` and tells the store *once*, when the book stops.

---

## Nothing shelves itself

A newly indexed book goes into a moving box, not onto a shelf
([src/world/reconcile.ts](../src/world/reconcile.ts)), so a fresh library is four
full boxes and empty shelves. Unpacking is an interaction: `G` on a box runs
`emptyBoxOntoShelves`, which fills empty rows in a seeded-random order; `E` takes
one book out or puts one back.

Reconciliation is the part most likely to lose somebody's arrangement, and so the
part with the most tests. The rules:

- Move a bookcase and its books move with it. Reorder the file and nothing moves.
- Delete or rename one and its books go into boxes — but the *saved* rows are
  kept, so putting the bookcase back puts its books back in it.
- Books new since the last layout go into boxes. A scan never rearranges a
  library you have already put in order.
- A book whose file is gone is simply gone, not reported as displaced.

---

## Read mode

Opening a book docks the camera onto a page mesh; there is no mode to choose and
no way to be in read mode without a book. The findings that shaped it —
why the reader is a camera dock, and its DPI budget — are in
[reading-spike.md](reading-spike.md).

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
zip file and rendering one *properly* means a CSS engine; what is kept is the
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

## Where to look for what

| you want to change | start here |
| --- | --- |
| the shape of the building | [src/world/schema.ts](../src/world/schema.ts), then `derive.ts` |
| what a room looks like | `src/scene/Rooms.tsx`, `Roofs.tsx`, `materials.ts` |
| a new piece of furniture | `schema.ts` kinds → `derive.ts` sizes → `Furniture.tsx` |
| the outdoors | `src/world/terrain.ts`, `forest.ts`, `src/scene/Outside.tsx` |
| walking, stairs, collision | `src/scene/walk.ts`, `collision.ts`, `Player.tsx` |
| what the crosshair offers | `src/scene/Interaction.tsx` |
| a new key | `Player.tsx` (E), `Handling.tsx` (the rest), `Reader.tsx` (reading) |
| how a book looks on a shelf | `src/scene/spineAtlas.ts`, `bookMaterial.ts`, `Books.tsx` |
| reading | `src/reader/` |
| the filesystem | `src/services/`, then `core/`, `src-tauri/`, `server/` |

## Conventions

- Comments explain *why* a decision was made, not what the code does.
- TypeScript is strict with `noUncheckedIndexedAccess` and `noUnusedLocals`;
  `tsconfig.json` covers `src`, `tests`, `scripts` and the config files.
- Assertions are on measurable facts — draw calls, triangles, frames, zero
  console errors. Screenshots are for a human to glance at, not for comparison.
- Fixed ports: Vite dev 5180, Playwright preview 5190, desktop CDP probe 9223,
  the server 8080.

See [development.md](development.md) for the commands and the testing strategy.
