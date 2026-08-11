# kleib3ry

A 3D personal library. Your own PDFs and EPUBs, on shelves you place, in a
building you design, read as physical books — with a record player wired to your
music folder and a television wired to your videos.

Desktop app: React Three Fiber inside a Tauri 2 shell, with a Rust core doing the
indexing and page rasterisation. It also runs in a container, serving your library
folder to a browser. The architecture is written up in
**[docs/architecture.md](docs/architecture.md)**; the rest of the documentation is
indexed in [docs/](docs/README.md).

**Status: you can walk it, live in it, and read in it.** The default library is a
cabin in the woods: a great room with a hearth, a loft up a flight of stairs, a
reading corner with a bedroom above it looking over the lake, a kitchen, an office
with a whiteboard, and a porch looking into the forest. Twenty bookcases and
~1,700 books, first-person movement with collisions and stairs, a crosshair that
finds a book and takes it off the shelf, and page-by-page reading on a curved
mesh — **PDF or EPUB**. There is a lake through the north window; out past the
porch steps there is grass, a forest you can walk into, a path round the water,
and a trail to a second building, the lake house on the far shore.

**The room is furnished as well as shelved.** A record player wired to your
`music/` folder, a television and a crate of tapes wired to your `video/` folder,
framed pictures from your `artwork/` folder, lamps you can switch on and off,
tables you can leave a book on — face down and open at the page you were reading —
and a floor you can simply drop one onto.

**And it is somewhere you can leave things.** Tear a copy of a page out of a book
— the book keeps its own — and pin it to the office whiteboard, or to any wall in
the house. Type a note and stick that up too, or take one off the pad on the desk.
Sheets have a body: an edge, a shadow, and a corner lifting off the plaster.

**There is an index, and there is weather, and there is a cat.** The terminal on
the office desk searches every book, record, tape and picture the library knows
about and tells you which case, which shelf and which room — and then you walk
there, because a library that teleports you is a library with no rooms in it.
Rain falls outside and beads on the windows. The cat roams, sleeps, comes when
you call it more often than not, purrs when you make a fuss of it, and will go and
fetch you a book off a shelf if you ask.

**A library arrives in boxes.** A freshly indexed collection is stacked in the
four moving boxes on the floor, and the shelves start empty: unpacking is yours
to do. Look at a box and press `G` to tip the whole thing onto empty shelves, or
take books out one at a time with `E` and put them where you want them — and
back in a box if you change your mind.

The building itself is a file: `<your library folder>/.library/library.json`.
Edit it and the room reloads while you are standing in it. The format is
described in [docs/library-folder.md](docs/library-folder.md), and there is a
full guide to building your own — rooms, lofts, stairs, railings, roofs, lighting
— in [docs/custom-maps.md](docs/custom-maps.md).

A library folder holds four folders of yours: `books/` for the shelves, `music/`
for the record player, `artwork/` for the walls, `video/` for the television. The
Rust indexer is wired: `choose folder…` then `scan` in the desktop app indexes the
PDFs and EPUBs in `books/` and leaves the other three alone. In the browser build
there is no filesystem, so the boxes are filled from a **placeholder catalogue**
plus two real generated books — `sample-book.pdf` and `sample-book.epub` — so both
halves of read mode can be tested headlessly.

## About the Name

kleib3ry

## Quick start

```bash
npm install
npm run assets         # pdf.js cmaps + fonts, and the sample book, into public/
npm run tauri:dev      # desktop app, with the native folder picker
npm run dev            # browser only, no filesystem access
```

`npm run assets` writes generated files that are deliberately not committed;
reading will fail without it.

Both can run at once — `tauri:dev` reuses a Vite server that is already up.
[docs/getting-started.md](docs/getting-started.md) walks through pointing it at
your books and finding your way round the room.

## In a container

```bash
docker build -t kleib3ry .
docker run --rm -p 8080:8080 -v /path/to/your/library:/library kleib3ry
```

Then open <http://localhost:8080> and press **scan** once. The same library folder,
the same shelves, read in a browser — see [docs/docker.md](docs/docker.md).

## Controls

| | |
| --- | --- |
| click | capture the mouse to look around (`Esc` releases) |
| `W` `A` `S` `D` | walk |
| `shift` | run |
| `ctrl` | kneel, to read the bottom shelf — held, not toggled |
| `Z` | zoom in — held, like kneeling. The right mouse button does the same |
| `E` | take the book, record or tape under the crosshair; put it on the shelf, in the box, on the table, on the deck or in the television you are looking at; pin the sheet in your hand to a wall, or take one down; sit down — with a book in hand, if reading is the plan; switch a lamp; put the coffee on; search the catalogue; take a note off the pad; make a fuss of the cat |
| `Q` | drop the book you are holding — it falls, tumbles and stays where it lands; a record or a tape files itself back where it came from; a sheet of paper is thrown away |
| `O` | put it down open, at the page you were on |
| `G` | empty the box you are looking at onto the shelves |
| `X` | pick up the moving box you are looking at and carry it; `X` again sets it down |
| `L` | write a label on the bookcase you are aiming at |
| `T` | write a note to pin up — then `E` at whatever wall you want it on |
| `F` | draw the book under the crosshair out to look at its cover — or, aimed at the cat, ask it to fetch you one |
| `R` | read the book in your hand — PDF or EPUB |
| `V` | call the cat |
| drag | while reading, drag a page across to turn it — let go early and it falls back |
| `←` `→` | turn pages without dragging; `Esc` closes the book |
| `B` | put a bookmark in the page you are on, or take it out again |
| `P` | while reading, tear out a copy of the page — the book keeps its own |
| `J` | while reading, go to a page by number |
| `N` | day to night and back |
| `K` | rain on and off |
| `H` | hide the interface, and bring it back |
| `F1` | the controls card, in the room |
| `F2` | settings |

Bookmarks are slips standing out of the top of the book, placed along its width
by how far in they are, and each one is a different colour with a stitched edge
so several in one book stay tellable apart. Click one to open the book there.
They are saved with the library, so they are still in it next time.

A book you leave open stays open: it lies there showing the spread you were on,
and picking it up again and pressing `R` puts you back on that page.

There are no modes to choose. You are walking, or you are reading a book you
opened — and `Esc` gets you out of the second.

## The menu, and settings

The app opens on a main menu: which library folder, and then **go in**. The room
loads *behind* it, so choosing is a decision rather than a wait, and nothing you
press reaches the room until you have gone in.

Settings are `F2`, and they are the things that are about your machine rather
than about your library — **low performance mode** (no shadows, no window light,
one pixel per pixel, for an older GPU), whether you can see your own body, the
volume, whether sound is placed in the room, and the mouse sensitivity. They are
kept in browser storage keyed by the app, so a library folder you copy to another
computer does not carry an opinion about that computer.

What *is* about the library — which lamps are on, whether it is night, whether it
is raining — stays in the library folder, in `lights.json`, and comes back with
it.

## Verify

```bash
npm run verify         # typecheck + bundle + headless smoke tests + cargo test
```

Individually:

| Command | What it proves |
| --- | --- |
| `npm run typecheck` | The front end type-checks |
| `npm run build` | The production bundle builds from the CLI |
| `npm test` | Headless Chromium boots the bundle, WebGL comes up, the room rasterises geometry, a real PDF opens and turns a page, and the console is clean. Plus the world, roof, terrain, collision and shelving units |
| `npm run test:rust` | All three crates: the core's indexing and probes, the desktop shell's settings, the server's routing and its path scope |
| `npm run scan -- <folder>` | Indexes a library folder's `books/` from the command line, no app needed |
| `npm run tauri:build` | A Windows installer builds end to end |
| `npm run test:desktop` | The *built* app boots, renders in WebView2, and an IPC command round-trips |
| `npm run docker:build` | The container image builds end to end |

`npm test` writes `tests/screenshots/room.png` — the render is checked by
assertion (draw calls, triangles, frames, no console errors), and the screenshot
is there for a human to glance at.

`npm run test:desktop` needs `npm run tauri:build` first. It launches the real
executable with WebView2's remote debugging port open and attaches over CDP,
which is the only way to cover what the browser tests structurally cannot: the
Tauri bridge, the CSP, and WebView2 itself. It is read-only and never writes to
your settings.

## Layout

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
  state/            zustand stores: world, library, media, video, lights, app;
                    plus player and metrics, deliberately outside React
  data/             placeholder catalogue + book proportions
  ui/               DOM overlay: crosshair, focus cards, panels, typed fields
core/               Rust: indexing, SQLite, format + tag probes, media folders.
                    No GUI — which is what lets the container skip Tauri entirely
src-tauri/          Rust: the desktop shell. IPC commands, settings, asset scope
server/             Rust: the same core over HTTP, for the container
tests/              Playwright harness — smoke tests plus world/layout units
scripts/            asset generation, icon, test corpus, desktop probe
Dockerfile          three build stages, one small runtime
docs/               see docs/README.md — architecture first
```

## The rule

**Nothing above `src/services/` imports `@tauri-apps/*`.** Everything reaches the
filesystem through the `LibraryService` interface, which has three
implementations: the desktop app over IPC, a browser over HTTP against
`kleib3ry-server`, and a no-filesystem browser driver with a generated catalogue.

That rule earned its keep: the HTTP driver and the whole container were added
without a single change above `src/services/`, which is exactly what it was
written down for.

## Regenerating the icon

The app icon is generated, not committed as an opaque binary:

```bash
npm run icon           # scripts/make-icon.mjs -> assets/icon-source.png -> src-tauri/icons/
```
