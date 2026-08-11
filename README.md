# kleib3ry

**A 3D personal library.** Your own PDFs and EPUBs, on shelves you place, in a
building you design, read as physical books — with a record player wired to your
music folder and a television wired to your videos.

*Status: you can walk it, live in it, and read in it.*

The default library is a cabin in the woods: a great room with a hearth, a loft
up a flight of stairs, a reading corner with a bedroom above it looking over the
lake, a kitchen, an office with a whiteboard, and a porch looking into the
forest. Twenty bookcases and ~1,700 books, first-person movement with collisions
and stairs, a crosshair that finds a book and takes it off the shelf, and
page-by-page reading on a curved mesh — **PDF or EPUB**. There is a lake through
the north window; out past the porch steps there is grass, a forest you can walk
into, a path round the water, and a trail to a second building, the lake house on
the far shore.

**The room is furnished as well as shelved.** A record player wired to your
`music/` folder, a television and a crate of tapes wired to your `video/` folder,
framed pictures from your `artwork/` folder, lamps you can switch on and off,
tables you can leave a book on — face down and open at the page you were reading
— and a floor you can simply drop one onto.

**And it is somewhere you can leave things.** Tear a copy of a page out of a book
— the book keeps its own — and pin it to the office whiteboard, or to any wall in
the house. Type a note and stick that up too. Sheets have a body: an edge, a
shadow, and a corner lifting off the plaster.

**There is an index, and there is weather, and there is a cat.** The terminal on
the office desk searches every book, record, tape and picture the library knows
about and tells you which case, which shelf and which room — and then you walk
there, because a library that teleports you is a library with no rooms in it.
Rain falls outside and beads on the windows. The cat roams, sleeps, comes when
you call it more often than not, purrs when you make a fuss of it, and will go
and fetch you a book off a shelf if you ask.

**A library arrives in boxes.** A freshly indexed collection is stacked in the
four moving boxes on the floor, and the shelves start empty: unpacking is yours
to do.

The building itself is a file — `<your library folder>/.library/library.json` —
and editing it reloads the room while you are standing in it.

---

## Two ways to run it

Both are the same program over the same library folder. Full comparison in
[docs/modes.md](docs/modes.md).

### The desktop app

A Tauri 2 window on your own machine, with a native folder picker.

```bash
npm install
npm run assets         # pdf.js fonts + cmaps and the sample book — needed after a fresh clone
npm run tauri:dev
```

Then **choose folder…**, then **scan**. `npm run tauri:build` makes a Windows
installer, and a standalone `.exe` beside it.
[docs/getting-started.md](docs/getting-started.md) walks the rest.

### Hosted, in a container

The same library served to a browser, reading a folder on the host.

```bash
docker build -t kleib3ry .
docker run --rm -p 8080:8080 -v /path/to/your/library:/library kleib3ry
```

Then open <http://localhost:8080> and press **scan** once. It serves one library
to one household on a network you trust — no accounts, no TLS — which
[docs/docker.md](docs/docker.md) explains and tells you what to put in front of
it if you want more.

## No books to hand? There is a demo library

[`demo-data/demo-library/`](demo-data/demo-library/) is a small, complete,
freely-licensed library folder in this repository: ten
[Standard Ebooks](https://standardebooks.org/) titles, two Creative Commons
records, two pictures and a tape. Point the desktop app at it, or mount it:

```bash
docker run --rm -p 8080:8080 -v "$PWD/demo-data/demo-library:/library" kleib3ry
```

Credits are in [its own README](demo-data/demo-library/README.md).

## Your library folder

```text
My Library/
  books/        your PDFs and EPUBs
  music/        one record per file
  artwork/      one picture per file
  video/        one tape per file
  .library/     everything the app writes — created for you
```

Only `books/` is needed. The app never writes among your books, and never
rewrites `library.json` — so your comments and your formatting are safe from it.
See [docs/library-folder.md](docs/library-folder.md).

## Controls

`F1` in the room shows every key; [docs/controls.md](docs/controls.md) is the
same table to read here. The short version: click to look, `WASD` to walk, `E`
to take a book off the shelf, `R` to read it, drag a page to turn it.

## Documentation

Everything is in **[docs/](docs/README.md)**. The ones people want first:

| | |
| --- | --- |
| [modes.md](docs/modes.md) | the desktop app and the container, side by side |
| [getting-started.md](docs/getting-started.md) | point it at your books, find your way round |
| [custom-maps.md](docs/custom-maps.md) | build your own building — rooms, lofts, stairs, roofs, light |
| [architecture.md](docs/architecture.md) | how it is put together, and why |
| [development.md](docs/development.md) | commands, tests, the frame budget |

## Built with

React Three Fiber and three.js inside a Tauri 2 shell, with a Rust core doing the
indexing, SQLite persistence and format probing — and the same core behind a
small HTTP server for the container. pdf.js reads the PDFs; EPUBs are unzipped
and set in type by the app itself.

**Nothing above `src/services/` imports `@tauri-apps/*`.** Everything reaches the
filesystem through one interface, which is why the hosted mode exists at all: the
HTTP driver and the whole container were added without a single change above that
seam.
