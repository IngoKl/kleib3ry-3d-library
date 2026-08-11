# Plan

The living version of the architecture proposal. Amendments made after the
reading spike are marked **[amended]** — the original spec is still right about
the shape, and wrong about two numbers.

## Stack

| Layer | Choice |
| --- | --- |
| Renderer | React Three Fiber (Three.js) + TypeScript |
| Bundler | Vite |
| Desktop shell | Tauri 2 (WebView2 on Windows) |
| Native work | Rust: indexing, PDF/EPUB rasterisation, metadata |
| State | Zustand for app state, SQLite for the index, JSON for room layout |
| Verification | `tsc`, Playwright headless smoke tests, `cargo test` |

Chosen because every artefact is plain text, every build runs from the CLI,
there is no binary editor state, and the same front end later serves from a
Linux box with only the file layer swapped.

## The one architectural rule

**Nothing above `src/services/` may import `@tauri-apps/*`.**

All filesystem access goes through the `LibraryService` interface in
[`src/services/types.ts`](../src/services/types.ts). Two drivers exist today —
`tauriDriver` (native) and `browserDriver` (no filesystem, used for headless
tests). The Linux-hosted web build becomes a third driver against an HTTP API
rather than a rewrite. This is the single decision that keeps that option open,
and it is cheap to hold and expensive to retrofit.

## Amendments from the reading spike

The spike lives in [`spikes/reading/`](../spikes/reading/) and its findings are
written up in [its README](../spikes/reading/README.md). Three things change the
plan:

1. **[amended] Read mode must be a camera dock.** Legibility is capped by screen
   pixels, not texture DPI. A book at true physical scale and normal reading
   distance is ~500 device px tall, which is unreadable no matter how sharp the
   texture. The spike only works because the camera docks so the spread fills
   the viewport. "Hold a book up while walking around and read it" is not a
   feature that can be delivered; do not promise it.
2. **[amended] 150 DPI is a preview tier, not a reading tier.** Filling a
   1000px-tall viewport needs ~233 DPI at US Letter size. Keep the Rust page
   cache, but budget 250–300 DPI for the page being read and treat 150 DPI as
   covers, thumbnails, and shelf peeks.
3. **Confirmed: the Rust rasteriser earns its place.** Every measured frame drop
   in the spike traced to pdf.js rasterising inline on the main thread — never
   to the mesh, the skinning, or the shadows. Rendering has headroom; decoding
   does not.

## Phases

| Phase | Deliverable | Status |
| --- | --- | --- |
| Spike | Prove legible page-by-page reading on a curved 3D mesh | **done** — 60 fps, legible, see [spike README](../spikes/reading/README.md) |
| 0 | Tauri 2 + Vite + React + TS; R3F renders a lit room; CLI build; headless test harness | **done** |
| 3 | Walk mode: first-person controls, collisions, pick up a book | **done** — plus kneeling, sitting, and stairs to a second storey; pulled forward ahead of 1 and 2 |
| 1 | Rust indexer walks the library folder, extracts PDF/EPUB covers + metadata into SQLite and a cover cache; front end lists books | **done** — wired to `scan_library` / `list_books` |
| 2 | Edit mode: place shelves and furniture with grid snap; JSON layout persistence | **part done** — the world is a hand-edited document with live reload ([the library folder](library-folder.md)); the in-app grid-snap editor is still to come |
| 4 | Read mode: take a book off the shelf, open it, turn pages — port the spike | **done** — page cache, atomic turn commit, drag-to-turn, bookmarks |
| 5 | EPUB reading: pagination to page images, CFI progress | |
| 6 | Music: placeable record player, audio folder scan, playlists, positional audio | **part done** — `music/` is scanned, records fill the crates, the deck plays them. Playlists and positional falloff are still to come |
| 7 | Persistence polish: migrations, rescan reconciliation | |
| 8 | Packaging: signed installer, auto-update, performance pass | |
| 9 | Optional: Linux-hosted web build via an HTTP driver | |

## Deviations from the original phase order

Phase 3 (walking) was built before phases 1 and 2, because being able to walk
the room and pull a book off a shelf is what makes the rest worth building. The
shelves are currently filled from a **placeholder catalogue** in
[`src/data/catalogue.ts`](../src/data/catalogue.ts) — generated titles, not your
files. Everything downstream consumes the same shape, so wiring the real index
is a data swap rather than a scene change.

**No physics engine.** The spec proposed rapier + ecctrl. The room is static
boxes and the player is a vertical cylinder, so
[`src/scene/collision.ts`](../src/scene/collision.ts) does axis-separated AABB
sliding in a few dozen lines: deterministic, unit-testable without a browser,
and no wasm — which also means the desktop CSP does not need `wasm-unsafe-eval`.

Books can now fall off shelves, and it still holds. What a dropped book needs is
gravity, a support height and a shove when you walk into it, which is forty
lines in [`src/scene/drop.ts`](../src/scene/drop.ts) — not a solver. Everything
still at rest on a shelf or in a box has its position *derived* from an ordering
as before; only a book you deliberately put down stores coordinates.

**Two storeys, without a navmesh.** A loft is a room with an `elevation` standing
inside another room's volume, and `floorAt` in
[`src/world/derive.ts`](../src/world/derive.ts) answers "what am I standing on" —
a floor slab with the stairwell subtracted from it, or a `stairs` piece treated as
a ramp. Colliders grew a vertical extent so that a balustrade upstairs is not a
wall downstairs, and a move is refused unless the floor it lands on is within a
step of the floor it left. That single rule is both how a staircase works and why
you cannot walk off the loft, which is a good sign it is the right rule.

**Spines are printed from one atlas.** Each shelved book's title and author are
drawn into a cell of a single canvas texture, and each instance carries a UV
rectangle naming its cell — so hundreds of legible spines cost one draw call.
Cells are recycled onto whatever is nearest as you walk, capped per pass so a
turn on the spot cannot stall a frame. This replaced a `troika-three-text` label
per book, which was one draw call each and so capped at 48.

## The library folder

A library is a folder, and the save lives in it: `<root>/.library/library.json`
is the room, hand-edited with live reload; `<root>/.library/books.json` is which
book sits on which shelf. `<root>/.library/covers/` caches the artwork,
because re-rasterising a large collection is expensive enough to be worth
carrying with it. Only the SQLite index stays in the app's data directory: it is
keyed to absolute paths and is worthless on another machine.

The asset protocol scope starts empty and is granted at runtime for exactly
three directories inside the chosen folder — `covers`, `music`, `artwork` — each
only when something asks for it. None of their paths can be known at build time.
Audio is why `music/` is a *directory* grant rather than a command to match
`read_book_file`: a track is streamed while it plays, and pulling a whole FLAC
through IPC to start it would be slower and a great deal more memory.

The format, and the rules for what happens to a shelved book when the room
changes under it, are in [the library folder](library-folder.md);
[building a map](custom-maps.md) is the guide to writing one.

**Nothing the app decides is written into `library.json`.** That is a file a
person wrote, with their comments in it. Where the boxes have been shoved, what
is written on a shelf label and which lamps are off all live beside it — in
`books.json` and `lights.json` — so that switching a light off cannot cost
somebody their formatting.

The one rule worth repeating here: **the layout is keyed by shelf id, never by
position**, and the app never puts a book on a shelf — you do. A newly indexed
library is stacked in the moving boxes with the shelves left empty, because
arranging a thousand books is a decision it has no business making for you; a
box empties onto the shelves in one interaction when you want it to. Anything
that loses its shelf to an edit goes into the boxes too, visibly, and
`books.json` keeps remembering where it came from so the edit can be undone.

Books live in `<root>/books/`, alongside `music/` and `artwork/`, and a scan
reads only that folder. A library folder from before the convention — books at
the top level — is still read whole, so the rule cannot lose anybody's
collection.

## The turn

A leaf is one mechanism driven two ways. Dragging sets its progress from the
pointer; the arrow keys set a target and let it fall under the clock. Releasing
a drag past a third of the way — or flicking it — settles it to 1, and anything
less settles it back to 0, which is what makes a half-drag a *peek* rather than
a commitment. Either way the commit is gated on the destination spread already
being rasterised, so the swap is atomic; see the page cache in
[`src/reader/pageTextures.ts`](../src/reader/pageTextures.ts).

Bookmarks stand proud of the top edge of the page, which the camera dock would
otherwise crop — the dock frames the spread exactly, because legibility is
capped by screen pixels. The frame is opened up to admit them only for a book
that actually has one, so an unbookmarked book pays nothing for the feature.

## Modes

There are none, deliberately. There used to be a row of three: `walk`, an
`edit` camera that orbited but edited nothing, and a `read` you could select
with no book open — which froze the camera and left the mode buttons as the
only way back. `Mode` is now `walk | read`, `read` is refused unless a book is
open, and nothing in the UI asks you to choose.

## Standing constraints

- **Instance the spines from phase 2.** `InstancedMesh`/`BatchedMesh` for
  everything shelved; promote to a real mesh only the book being handled.
- **Book identity is a hash of the first 64 KB of the file's contents**, not of
  its path, so a rescan reconciles moved and renamed files instead of
  duplicating them — and a book keeps its place on the shelf when you move it.
  `size` and `mtime` are stored too, but only to skip re-probing a file that has
  not changed. Editing a file does change its identity, and it will be treated
  as a new book.
- **Licence-clean PDF engine.** pdfium or `pdf_oxide`, not PyMuPDF, if binaries
  are ever distributed — PyMuPDF is AGPL.
- **Scope EPUB to non-DRM.** LCP/ACSM-protected files cannot be opened and
  should fail visibly rather than silently.
