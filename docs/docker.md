# Running kleib3ry in a Container

**This is hosted mode** — the second of the two ways to run kleib3ry, the
desktop app being the first. [modes.md](modes.md) puts them side by side; this
page is how to run this one.

The two are the same library through different drivers. Point both at the same
folder and they see the same shelves, boxes and bookmarks: the library is the
folder, and the save files live in it (see
[library-folder.md](library-folder.md)).

```bash
docker build -t kleib3ry .
docker run --rm -p 127.0.0.1:8080:8080 -v /path/to/your/library:/library kleib3ry
```

Then open <http://localhost:8080>. On a fresh library folder, open the panel and
press **Scan** once; after that the index lives in the folder and every launch
reads it.

No library of your own to hand? The repository carries a small real one:

```bash
docker run --rm -p 127.0.0.1:8080:8080 -v "$PWD/demo-data/demo-library:/library" kleib3ry
```

With compose:

```bash
LIBRARY=/srv/books docker compose up --build
```

## What Is in the Image

Three build stages and one small runtime:

| stage    | builds                            | from                    |
| -------- | --------------------------------- | ----------------------- |
| `web`    | the front end, `VITE_DRIVER=http` | `node:22-bookworm-slim` |
| `server` | `kleib3ry-server`                 | `rust:1-bookworm`       |
| runtime  | nothing; it just runs the server  | `debian:bookworm-slim`  |

Nothing to do with Tauri is built here — that is why `core/` is a separate
crate. The binary is pure Rust, with no native library linked and no C
toolchain, so the runtime needs nothing but libc.

## The Folder It Expects

Exactly what the desktop app expects:

```text
/library/
  books/        your PDFs and EPUBs
  music/        records for the player
  artwork/      pictures for the frames
  video/        tapes for the television
  roms/         cartridges for the arcade machine
  .library/     everything the app writes — created for you
```

The server writes into `.library/`: the index, the cover cache, the book layout,
the lamps. Everything else in the folder it only reads.

## Running as Yourself

The image deliberately does **not** drop to a baked-in unprivileged uid: the
server writes into your mounted folder, and a uid that does not own it fails on
first run with a permission error nobody can act on. Pass your own instead:

```bash
docker run --rm -p 127.0.0.1:8080:8080 \
  --user "$(id -u):$(id -g)" \
  -v /path/to/your/library:/library \
  kleib3ry
```

or with compose, in a `.env` file beside `docker-compose.yml`:

```dotenv
LIBRARY=/srv/books
UID=1000
GID=1000
```

## What the Container Cannot Do

- **It cannot choose a folder.** The library is whatever was mounted; a picker
  would let a browser walk the server's disk. `canPickFolder` is false here and
  the panel's button is disabled rather than broken.
- **It has no TLS and no authentication.** One library, one household, a network
  you trust. Anything more exposed wants a reverse proxy doing both. Which is why
  every `docker run` on this page publishes to `127.0.0.1:8080` rather than to
  `8080`: Docker publishes a port by writing its own firewall rules, so a bare
  `-p 8080:8080` reaches the whole network whatever the host's firewall says.
  Dropping the address is how you open it to the house, and worth doing on
  purpose rather than by copying a line.
- **It has no idea who is looking at it.** The shelving, bookmarks and reading
  positions are files in the library folder, not per-viewer state. Two browsers
  open at once are two writers of the same document, last save wins — fine for a
  laptop and a tablet, wrong for two people.

The reasoning behind all three is in
[modes.md](modes.md#what-hosted-mode-is-not).

## What the Browser Has to Be

Two things set the floor, and the higher of them wins. The bundle is built for
`chrome110`; and the EPUB reader unzips books with the platform's own
`DecompressionStream('deflate-raw')` rather than shipping a zip library, which
arrived in Chrome 103, Safari 16.4 and Firefox 113. So: **Chrome 110+, Edge
110+, Safari 16.4+, Firefox 113+**. Below the reader's bar the room still loads
and only EPUBs fail — a PDF reads either way, since pdf.js does its own
decompression.

One thing that is not a browser requirement but looks like one: an EPUB is set in
type against the fonts that machine has, so the same book paginates slightly
differently on a machine without Georgia. See
[library-folder.md](library-folder.md#a-page-number-is-per-machine).

## What the Browser Is Allowed to Read

One function: `is_allowed` in [../server/src/main.rs](../server/src/main.rs).

Four directories are reachable over HTTP — `covers`, `music`, `artwork`,
`video` — and every path is canonicalised and checked against them before a byte
is opened, so a `..` in a URL or a symlink planted in `music/` resolves away
first. `books/` is **not** reachable: a book is served by index id through
`/api/book/<id>`, so the only files a browser can name directly are the ones the
index already told it about. `roms/` follows the book's rule rather than the
media rule — a ROM is read once, not streamed — and is served by listing id
through `/api/rom/<id>`.

The desktop app gets the same property from Tauri's asset scope. There is no
such scope here, which is why the check is the server's own job.

## The Routes

One per `LibraryService` method, in the order they are declared in
[../src/services/types.ts](../src/services/types.ts), so the two files read side
by side.

| route                                          | does                                                   |
| ---------------------------------------------- | ------------------------------------------------------ |
| `GET /api/root`                                | where the library is                                   |
| `POST /api/scan`                               | walk the folder and reconcile                          |
| `GET /api/scan/progress`                       | how a scan is getting on                               |
| `GET /api/books`                               | the index                                              |
| `GET /api/book/<id>`                           | a book's bytes, for pdf.js                             |
| `POST /api/cover/<id>`                         | cache a cover the browser rasterised                   |
| `POST /api/paper`                              | download an arXiv paper, index it, return the book     |
| `GET`/`POST` `/api/world`                      | the room document, as text                             |
| `GET /api/world/stamp`                         | cheap changed-ness, for live reload                    |
| `GET /api/paths`                               | which files this library is saved into                 |
| `GET`/`PUT` `/api/layout`                      | which book is where                                    |
| `GET /api/music`, `/api/artwork`, `/api/video` | the media folders                                      |
| `GET /api/roms`                                | the games for the arcade machine                       |
| `GET /api/rom/<id>`                            | one ROM's bytes, by listing id — like a book's         |
| `GET`/`PUT` `/api/ambience`                    | which lamps are on, and whether it is night or raining |
| `GET`/`PUT` `/api/annotations`                 | bookmarks, page notes and page ink                     |
| `GET /media/<path>`                            | a media file, with byte ranges                         |
| anything else                                  | the built front end, falling back to `index.html`      |

Scan progress is **polled**, not pushed: there is no event channel here, and a
websocket for one number would be a second protocol to keep working. The driver
polls four times a second during a scan and not at all otherwise.

`GET /media/` honours `Range`, which is not optional. Chromium will play a video
served as a plain `200`, but dragging the position bar sends a range request and
gives up if it gets the whole file back — leaving it out means a television that
cannot seek.

## Without Docker

The server is an ordinary binary and the front end is an ordinary bundle:

```bash
npm run assets            # pdf.js cmaps and fonts into public/
npm run build:http        # bundle with the HTTP driver selected
npm run serve -- --root /path/to/library --dist dist --port 8080
```

For front-end work against a running server, `npm run dev:http` starts Vite on
5180 with the same driver selected. It expects the API on the same origin, so put
a proxy in `vite.config.ts` or run the server on 5180's behalf.

## Live Reload Still Works

`library.json` is polled through `/api/world/stamp`, a `stat` call. Edit the
file on the host — it is inside the mounted folder — and the room rebuilds while
you are standing in it, as it does on the desktop.
