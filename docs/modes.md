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

Everything above `src/services/` is the same code in both, down to the bundle:
the room, the walking, the reader, the record player, the cat. What differs is
the four or five things below that seam, and this document is a list of them.

**The hosted mode _is_ the container.** Not "a web version" — there is no
deployment of kleib3ry that is not either the desktop app or this image. The
server is an ordinary binary and you can run it by hand
([without Docker](docker.md#without-docker)), but that is the same mode with the
packaging taken off, useful when you are working on it. In the app itself the
mode is called _container_, in the panel and in the menu; `http` is the transport
underneath it, which is why the settings card shows both.

To actually run either one: [getting-started.md](getting-started.md) for the
desktop app, [docker.md](docker.md) for the container.

## What Is the Same

**The library folder is the library.** Both modes read the same folder shape —
`books/`, `music/`, `artwork/`, `video/`, `roms/`, and a `.library/` the app
writes into —
and everything either one decides goes back into it. Point them both at the same
folder and they see the same shelves, the same boxes, the same bookmarks, the
same lamps. Move that folder to another machine, or mount it into a container
instead of opening it in the app, and your library arrives arranged.

That is not a coincidence, it is the design: see
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
container: a picker there would mean letting a browser walk the server's disk.
The button is disabled with the reason next to it rather than failing when
pressed. To read a different library, mount a different folder.

**Scan progress is pushed on the desktop and polled in the container.** Tauri has
an event channel and the server does not; a websocket carrying one number would
be a second protocol to keep working. The driver polls four times a second while
a scan is running and not at all otherwise.

**Two different ways of refusing to open the wrong file.** The desktop app gets
it from Tauri's asset scope, which starts empty and is granted four directories
at runtime. The container has no such thing, so it is the server's own job:
`is_allowed` in [server/src/main.rs](../server/src/main.rs) canonicalises every
path and checks it against `covers`, `music`, `artwork` and `video`. `books/` is
not reachable by name in either — a book is fetched by its index id — and
`roms/` follows the same rule: a ROM is fetched by the id its listing handed out.

**Covers are rendered by whoever is looking.** Page one is rasterised by pdf.js
in the WebView or the browser and posted back to be cached in `.library/covers/`.
So a container that nobody has opened yet has no covers, and the first visit
warms them for every visit after it — including the desktop app, if it is the
same folder.

## What Hosted Mode Is Not

It serves **one library to one household on a network you trust**. Three limits
follow from that, and none of them is an oversight:

- **No authentication and no TLS.** The server binds `0.0.0.0:8080` and answers
  anyone who can reach it, including `POST /api/scan`. Anything more exposed than
  a home network wants a reverse proxy in front of it doing both.
- **One reader at a time — really.** There are no accounts, and there is nothing
  per-viewer: the shelving, the bookmarks, the reading positions, the pinned
  pages and the lamps are all files in the library folder. Two browsers open at
  once are two writers of the same layout document, debounced 600 ms, last one
  wins. That is fine for you on a laptop and a tablet. It is wrong for two
  people, and making it right is not a hosting change — it is a per-identity
  layer under [src/state/library.ts](../src/state/library.ts) and a scoping
  change to `/api/layout`.
- **A thread per connection**, deliberately ([server/src/main.rs](../server/src/main.rs)).
  Household scale. It is not written to survive the open internet.

## The Third Driver Is Not a Third Mode

There is a `browserDriver`: a plain tab, no filesystem, a generated 1,700-book
placeholder catalogue in `localStorage` plus two real generated books so read
mode can be tested headlessly. `npm run dev` and the Playwright suite use it.

It is a **fixture**, not a way to run kleib3ry, and it is worth knowing because
it is also the _fallback_ — any non-Tauri bundle built without `VITE_DRIVER=http`
gets it. A hosted deployment built with plain `npm run build` therefore comes up
looking like a working library full of books that do not exist. If a container
shows 1,700 books you have never heard of, that is the bundle, not the mount:
check the panel, which says which of the three is live.

## Why the Choice Is Made at Build Time

`isTauri()` picks the desktop driver at runtime, by looking for the injected IPC
bridge. The other two cannot be told apart that way — the container's bundle is
served by a plain HTTP server and looks exactly like a static one — so that
choice is `VITE_DRIVER=http`, set by `.env.http` and used by `npm run build:http`
(which is what the Dockerfile's `web` stage runs) and `npm run dev:http`.

A runtime probe would read better and live worse. `library` is read
synchronously the moment the first store is created, so probing would mean an
`await` before the app can start, and a server slow to answer would come up as
an empty stand-in library — the failure in the section above, arrived at by
accident instead of by misconfiguration. A flag cannot be wrong about which
thing it is. See [src/services/index.ts](../src/services/index.ts).

## The Seam Itself

One interface, `LibraryService` in
[src/services/types.ts](../src/services/types.ts), and the rule that nothing
above `src/services/` may import `@tauri-apps/*`. The hosted mode is the return
on that rule: the HTTP driver and the whole container were added without a
single change above the seam. [architecture.md](architecture.md#the-one-rule)
has the long version.
