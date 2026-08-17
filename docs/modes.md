# The Two Ways to Run It

kleib3ry ships in two forms, and they are the same program:

|                      | **Desktop App**                             | **Hosted**                                 |
| -------------------- | ------------------------------------------- | ------------------------------------------ |
| what it is           | a Tauri 2 window on your own machine        | the Docker container, serving to a browser |
| you run              | `npm run tauri:dev`, or the built installer | `docker run … -v /your/library:/library`   |
| the library is       | a folder you pick, on that machine          | the folder you mounted into the container  |
| the Rust half        | `core/` behind `src-tauri/`, over IPC       | `core/` behind `server/`, over HTTP        |
| the front-end driver | `tauriDriver`                               | `httpDriver`                               |
| built by             | `npm run tauri:build`                       | `npm run docker:build`                     |

Everything above `src/services/` is the same code in both, down to the bundle.
What differs is the handful of things below that seam, listed here.

**The hosted mode _is_ the container** — not "a web version". There is no
deployment of kleib3ry that is not either the desktop app or this image. The
server is an ordinary binary you can run by hand
([without Docker](docker.md#without-docker)), which is the same mode unpackaged
and useful while working on it. The app calls the mode _container_ in the panel
and the menu; `http` is the transport underneath, which is why the settings card
shows both.

To run either: [getting-started.md](getting-started.md) for the desktop app,
[docker.md](docker.md) for the container.

## What Is the Same

**The library folder is the library.** Both modes read the same folder shape —
`books/`, `music/`, `artwork/`, `video/`, `roms/`, and a `.library/` the app
writes into — and everything either decides goes back into it. Point both at the
same folder and they see the same shelves, boxes, bookmarks and lamps. See
[library-folder.md](library-folder.md).

**The room reloads while you stand in it** in both. `library.json` is polled by a
`stat` on the desktop and by `GET /api/world/stamp` in the container, which is
also a `stat`.

**What is about your machine stays on your machine.** Low Performance Mode, the
volume, the mouse sensitivity and the recent-libraries list are in browser
storage, not in the library folder — so the container's settings are the
settings of the browser you are looking at it in, and the desktop app's are that
computer's.

## What Differs

**Only the desktop app can choose a folder.** `canPickFolder` is false in the
container: a picker there would let a browser walk the server's disk. The button
is disabled with the reason beside it rather than failing when pressed. To read
a different library, mount a different folder.

**Scan progress is pushed on the desktop and polled in the container.** Tauri
has an event channel; the server does not, and a websocket for one number would
be a second protocol to keep working. The driver polls four times a second while
a scan runs, and not at all otherwise.

**Two different ways of refusing to open the wrong file.** The desktop app uses
Tauri's asset scope, which starts empty and is granted four directories at
runtime. The container has no such thing, so it is the server's job: `is_allowed`
in [server/src/main.rs](../server/src/main.rs) canonicalises every path and
checks it against `covers`, `music`, `artwork` and `video`. `books/` is not
reachable by name in either — a book is fetched by index id — and `roms/`
follows the same rule.

**Covers are rendered by whoever is looking.** Page one is rasterised by pdf.js
in the WebView or the browser and posted back to `.library/covers/`. A container
nobody has opened has no covers; the first visit warms them for every visit
after, including the desktop app on the same folder.

## What Hosted Mode Is Not

It serves **one library to one household on a network you trust**. Three limits
follow from that; none is an oversight:

- **No authentication and no TLS.** The server binds `0.0.0.0:8080` and answers
  anyone who can reach it, including `POST /api/scan`. Anything more exposed
  than a home network wants a reverse proxy doing both.
- **One reader at a time.** There are no accounts and no per-viewer state: the
  shelving, bookmarks, reading positions, pinned pages and lamps are all files
  in the library folder. Two browsers open at once are two writers of the same
  layout document, debounced 600 ms, last write wins — fine for a laptop and a
  tablet, wrong for two people. Fixing it means a per-identity layer under
  [src/state/library.ts](../src/state/library.ts) and scoping `/api/layout`, not
  a hosting change.
- **A thread per connection**, deliberately
  ([server/src/main.rs](../server/src/main.rs)). Household scale; not written to
  survive the open internet.

## The Third Driver Is Not a Third Mode

There is a `browserDriver`: a plain tab, no filesystem, a generated 1,700-book
placeholder catalogue in `localStorage` plus two real generated books so read
mode can be tested headlessly. `npm run dev` and the Playwright suite use it.

It is a **fixture**, not a way to run kleib3ry — and it is also the _fallback_:
any non-Tauri bundle built without `VITE_DRIVER=http` gets it. A hosted
deployment built with plain `npm run build` therefore comes up looking like a
working library full of books that do not exist. If a container shows 1,700
unfamiliar books, that is the bundle, not the mount; the panel says which driver
is live.

## Why the Choice Is Made at Build Time

`isTauri()` picks the desktop driver at runtime by looking for the injected IPC
bridge. The other two cannot be told apart that way — the container's bundle is
served by a plain HTTP server and looks exactly like a static one — so that
choice is `VITE_DRIVER=http`, set by `.env.http` and used by `npm run build:http`
(the Dockerfile's `web` stage) and `npm run dev:http`.

A runtime probe would live worse: `library` is read synchronously the moment the
first store is created, so probing would mean an `await` before the app can
start, and a slow server would come up as an empty stand-in library — the
failure above, reached by accident rather than misconfiguration. See
[src/services/index.ts](../src/services/index.ts).

## The Seam Itself

One interface, `LibraryService` in
[src/services/types.ts](../src/services/types.ts), and the rule that nothing
above `src/services/` may import `@tauri-apps/*`. The HTTP driver and the whole
container were added without a single change above that seam.
[architecture.md](architecture.md#the-one-rule) has the long version.
