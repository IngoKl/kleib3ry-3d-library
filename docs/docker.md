# Running kleib3ry in a container

The desktop app and the container are the same library seen through two
different drivers. Point them both at the same folder and they see the same
shelves, the same boxes, the same bookmarks — the library is the folder, and the
save files live in it (see [library-folder.md](library-folder.md)).

```bash
docker build -t kleib3ry .
docker run --rm -p 8080:8080 -v /path/to/your/library:/library kleib3ry
```

Then open <http://localhost:8080>. On a fresh library folder, open the panel and
press **scan** once; after that the index lives in the folder and every launch
reads it.

With compose:

```bash
LIBRARY=/srv/books docker compose up --build
```

## What is in the image

Three build stages and one small runtime:

| stage | builds | with |
| --- | --- | --- |
| `web` | the front end, `VITE_DRIVER=http` | node |
| `server` | `kleib3ry-server` | rust |
| runtime | neither | `debian:bookworm-slim` |

Notably absent is anything to do with Tauri. The desktop shell is not built here
at all, which is the whole reason `core/` was carved out of it — a container that
had to link GTK and WebKit in order to read a directory would be an order of
magnitude larger than this one. SQLite is compiled into the binary, so the
runtime needs nothing but libc.

## The folder it expects

Exactly what the desktop app expects:

```text
/library/
  books/        your PDFs and EPUBs
  music/        records for the player
  artwork/      pictures for the frames
  video/        tapes for the television
  .library/     everything the app writes — created for you
```

The server writes into `.library/`: the index, the cover cache, the book layout,
the lamps. Everything else in the folder it only reads.

## Running as yourself

The image deliberately does **not** drop to a baked-in unprivileged uid. The
server writes into your mounted folder, and a uid that does not own it is a first
run that fails with a permission error nobody can act on. Pass your own instead:

```bash
docker run --rm -p 8080:8080 \
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

## What the container cannot do

- **It cannot choose a folder.** The library is whatever was mounted, and a
  picker would mean letting a browser walk the server's disk. `canPickFolder` is
  false in this driver and the panel's button is disabled rather than broken.
- **It has no TLS and no authentication.** This serves one library to one
  household on a network you trust. Anything more exposed wants a reverse proxy
  in front of it doing both.

## What the browser is allowed to read

One function, and it is worth knowing where it is: `is_allowed` in
[../server/src/main.rs](../server/src/main.rs).

Four directories are reachable over HTTP — `covers`, `music`, `artwork`, `video`
— and every path is canonicalised and checked against them before a byte is
opened, so a `..` in a URL or a symlink planted in `music/` resolves away before
the comparison. `books/` is **not** reachable: a book is served by its index id
through `/api/book/<id>`, which means the only files a browser can name directly
are the ones the index already told it about.

The desktop app gets the same property from Tauri's asset scope, which starts
empty and is granted those directories at runtime. There is no such scope here,
which is why the check is the server's own job.

## The routes

One per `LibraryService` method, in the same order they are declared in
[../src/services/types.ts](../src/services/types.ts), so the two files can be
read side by side.

| route | does |
| --- | --- |
| `GET /api/root` | where the library is |
| `GET /api/books` | the index |
| `POST /api/scan` | walk the folder and reconcile |
| `GET /api/scan/progress` | how a scan is getting on |
| `GET /api/book/<id>` | a book's bytes, for pdf.js |
| `POST /api/cover/<id>` | cache a cover the browser rasterised |
| `GET`/`POST` `/api/world` | the room document, as text |
| `GET /api/world/stamp` | cheap changed-ness, for live reload |
| `GET /api/paths` | which files this library is saved into |
| `GET`/`PUT` `/api/layout` | which book is where |
| `GET`/`PUT` `/api/lights` | which lamps are on |
| `GET /api/music`, `/api/artwork`, `/api/video` | the other three folders |
| `GET /media/<path>` | a media file, with byte ranges |
| anything else | the built front end, falling back to `index.html` |

Scan progress is **polled**, not pushed. The desktop app gets Tauri events; there
is no event channel here and a websocket for one number would be a second
protocol to keep working. The driver polls four times a second for the duration
of a scan and not at all the rest of the time.

`GET /media/` honours `Range`, which is not optional: Chromium will play a video
served as a plain `200`, but dragging the position bar sends a range request and
gives up if it gets the whole file back. A television with no seeking is exactly
what leaving it out looks like.

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

## Live reload still works

`library.json` is polled through `/api/world/stamp`, which is a `stat` call. Edit
the file on the host — it is inside the mounted folder — and the room rebuilds
while you are standing in it, exactly as it does on the desktop.
