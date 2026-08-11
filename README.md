# Library

A 3D personal library. Your own PDFs and EPUBs, on shelves you place, in a room
you design, read as physical books — with a record player wired to your music
folder.

Desktop app: React Three Fiber inside a Tauri 2 shell, with a Rust core doing
the indexing and page rasterisation. The architecture notes live in
[CLAUDE.md](CLAUDE.md) and the docs under [docs/](docs/).

**Status: you can walk it, live in it, and read in it.** The default library is
a cabin in the woods: a great room with a hearth, a loft up a flight of stairs,
a reading corner with a bedroom above it looking over the lake, a kitchen, and
a porch looking into the forest. Sixteen
bookcases and ~1,700 books, first-person movement with collisions and stairs, a
crosshair that finds a book and takes it off the shelf, and page-by-page reading
on a curved mesh. There is a lake through the north window.

**The room is furnished as well as shelved.** A record player wired to your
`music/` folder, framed pictures from your `artwork/` folder, lamps you can
switch on and off, tables you can leave a book on — face down and open at the
page you were reading — and a floor you can simply drop one onto.

**A library arrives in boxes.** A freshly indexed collection is stacked in the
four moving boxes on the floor, and the shelves start empty: unpacking is yours
to do. Look at a box and press `G` to tip the whole thing onto empty shelves, or
take books out one at a time with `E` and put them where you want them — and
back in a box if you change your mind.

The building itself is a file: `<your library folder>/.library/library.json`.
Edit it and the room reloads while you are standing in it. The format is
described in [docs/library-folder.md](docs/library-folder.md), and there is a
full guide to building your own — rooms, lofts, stairs, railings, lighting — in
[docs/custom-maps.md](docs/custom-maps.md).

A library folder holds three folders of yours: `books/` for the shelves,
`music/` for the record player, `artwork/` for the walls. The Rust indexer is
wired: `choose folder…` then `scan` in the desktop app indexes the PDFs and
EPUBs in `books/` and leaves the other two alone. In the browser build there is
no filesystem, so the boxes are filled from a **placeholder catalogue** plus one
real generated PDF (`sample-book.pdf`) so read mode can be tested headlessly.

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

## Controls

| | |
| --- | --- |
| click | capture the mouse to look around (`Esc` releases) |
| `W` `A` `S` `D` | walk |
| `shift` | run |
| `ctrl` | kneel, to read the bottom shelf — held, not toggled |
| `E` | take the book or record under the crosshair; put it on the shelf, in the box, on the table or on the deck you are looking at; sit down — with a book in hand, if reading is the plan; switch a lamp; put the coffee on |
| `Q` | drop the book you are holding — it falls, tumbles and stays where it lands; a record files itself back into its crate |
| `O` | put it down open, at the page you were on |
| `G` | empty the box you are looking at onto the shelves |
| `X` | pick up the moving box you are looking at and carry it; `X` again sets it down |
| `L` | write a label on the bookcase you are aiming at |
| `F` | draw the book under the crosshair out to look at its cover |
| `R` | read the book in your hand |
| drag | while reading, drag a page across to turn it — let go early and it falls back |
| `←` `→` | turn pages without dragging; `Esc` closes the book |
| `B` | put a bookmark in the page you are on, or take it out again |
| `J` | while reading, go to a page by number |
| `H` | hide the interface, and bring it back |
| `F1` | the controls card, in the room |

Bookmarks are slips standing out of the top of the book, placed along its width
by how far in they are, and each one is a different colour with a stitched edge
so several in one book stay tellable apart. Click one to open the book there.
They are saved with the library, so they are still in it next time.

A book you leave open stays open: it lies there showing the spread you were on,
and picking it up again and pressing `R` puts you back on that page.

There are no modes to choose. You are walking, or you are reading a book you
opened — and `Esc` gets you out of the second.

## Verify

```bash
npm run verify         # typecheck + bundle + headless smoke tests + cargo test
```

Individually:

| Command | What it proves |
| --- | --- |
| `npm run typecheck` | The front end type-checks |
| `npm run build` | The production bundle builds from the CLI |
| `npm test` | Headless Chromium boots the bundle, WebGL comes up, the room rasterises geometry, a real PDF opens and turns a page, and the console is clean |
| `npm run test:rust` | Settings persistence round-trips |
| `npm run scan -- <folder>` | Indexes a library folder's `books/` from the command line, no app needed |
| `npm run tauri:build` | A Windows installer builds end to end |
| `npm run test:desktop` | The *built* app boots, renders in WebView2, and an IPC command round-trips |

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
  services/         the ONLY place that touches the filesystem
  world/            the library.json document: schema, defaults, geometry,
                    floor heights and stairs, and what happens to shelved
                    books when the room changes
  scene/            R3F scene graph — rooms, shelves, books, boxes, furniture,
                    the forest outside, the spine atlas that prints titles,
                    and the little bit of gravity that dropped books fall under
  reader/           read mode: page cache, page mesh, the turn
  state/            zustand stores: world, library, media, lights, app, player
  data/             placeholder catalogue + book proportions
  ui/               DOM overlay: crosshair, focus cards, panels, typed fields
src-tauri/          Rust core: commands, settings, db, format + tag probes
tests/              Playwright harness — smoke tests plus world/layout units
scripts/            asset generation, icon, test corpus
docs/reading-spike.md   findings from the spike that de-risked 3D page reading
docs/library-folder.md  the library folder format, and the reconciliation rules
docs/custom-maps.md     building your own building: rooms, lofts, stairs, light
docs/ideas.md           the running wish list
```

## The rule

**Nothing above `src/services/` imports `@tauri-apps/*`.** Everything reaches
the filesystem through the `LibraryService` interface, which has a native driver
and a no-filesystem browser driver today. That is what keeps a Linux-hosted web
build a driver swap instead of a rewrite.

## Regenerating the icon

The app icon is generated, not committed as an opaque binary:

```bash
npm run icon           # scripts/make-icon.mjs -> assets/icon-source.png -> src-tauri/icons/
```
