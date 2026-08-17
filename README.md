# kleib3ry — 3D Virtual Personal Library

Your own PDFs and EPUBs, on shelves you place, in a building you design, read as
physical books — with a record player wired to your music folder and a television
wired to your videos.

- **Read them.** Take a book off the shelf, turn pages on a curved mesh — PDF or
  EPUB.
- **Furnish it.** Records, tapes, framed artwork, lamps, tables to leave a book
  on.
- **Leave things.** Tear out a page, pin it to a wall, write on the whiteboard.
- **Live in it.** Weather, a searchable terminal on the office desk, and a cat.
- **Design it.** The building is a file — `.library/library.json` — and editing it
  reloads the room while you stand in it.

The default map is a cabin in the woods with twenty bookcases, a loft, a lake, a
forest you can walk into, and a second building on the far shore. A freshly
indexed library arrives in moving boxes; unpacking it is yours to do.

## Two Ways to Run It

Both are the same program over the same library folder — see
[docs/modes.md](docs/modes.md).

**Desktop app** — a Tauri 2 window, with a native folder picker:

```bash
npm install
npm run assets         # pdf.js fonts + cmaps — needed after a fresh clone
npm run tauri:dev
```

Then **Choose Folder…**, then **Scan**. `npm run tauri:build` makes a Windows
installer and a standalone `.exe`.

**Hosted, in a container** — the same library served to a browser:

```bash
docker build -t kleib3ry .
docker run --rm -p 8080:8080 -v /path/to/your/library:/library kleib3ry
```

Open <http://localhost:8080> and press **Scan** once. One library, one household,
a network you trust — no accounts, no TLS ([docs/docker.md](docs/docker.md)).

## Demo Library

[`demo-data/demo-library/`](demo-data/demo-library/) is a complete, freely-licensed
library folder: ten [Standard Ebooks](https://standardebooks.org/) titles, two
records, two pictures, a tape and a Pong cartridge. Point the desktop app at it,
or mount it:

```bash
docker run --rm -p 8080:8080 -v "$PWD/demo-data/demo-library:/library" kleib3ry
```

Credits in [its own README](demo-data/demo-library/README.md).

## Your Library Folder

```text
My Library/
  books/        your PDFs and EPUBs
  music/        one record per file
  artwork/      one picture per file
  video/        one tape per file
  roms/         one game cartridge per .ch8 file
  .library/     everything the app writes — created for you
```

Only `books/` is needed. The app never writes among your books and never rewrites
`library.json`. See [docs/library-folder.md](docs/library-folder.md).

## Controls

`F1` in the room shows every key; [docs/controls.md](docs/controls.md) is the
same list on a page. The short version: click to look, `WASD` to walk, `E` to
take a book off the shelf, `R` to read it, drag a page to turn it.

## Documentation

Everything is in **[docs/](docs/README.md)**. The ones people want first:

|                                               |                                                              |
| --------------------------------------------- | ------------------------------------------------------------ |
| [modes.md](docs/modes.md)                     | the desktop app and the container, side by side              |
| [getting-started.md](docs/getting-started.md) | point it at your books, find your way round                  |
| [custom-maps.md](docs/custom-maps.md)         | build your own building — rooms, lofts, stairs, roofs, light |
| [architecture.md](docs/architecture.md)       | how it is put together, and why                              |
| [development.md](docs/development.md)         | commands, tests, the frame budget                            |

## Built With

React Three Fiber and three.js in a Tauri 2 shell, with a Rust core doing
indexing, a JSON index and format probing — and the same core behind a small
HTTP server for the container. pdf.js reads the PDFs; EPUBs are unzipped and set
in type by the app itself. Nothing above `src/services/` imports `@tauri-apps/*`,
which is why the hosted mode could be added without touching the app.

## Licence

MIT — see [LICENSE](LICENSE). © 2026 Ingo Kleiber. The demo library has its own
credits in [its README](demo-data/demo-library/README.md).
