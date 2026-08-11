# Library

A 3D personal library. Your own PDFs and EPUBs, on shelves you place, in a room
you design, read as physical books — with a record player wired to your music
folder.

Desktop app: React Three Fiber inside a Tauri 2 shell, with a Rust core doing
the indexing and page rasterisation. The full architecture and phase plan live
in [docs/plan.md](docs/plan.md).

**Status: you can walk it and read in it.** Two rooms — a main room and a
reading corner with an armchair — seventeen bookcases and ~1,700 books,
first-person movement with collisions, a crosshair that finds a book and takes
it off the shelf, and page-by-page reading on a curved mesh.

The room itself is a file: `<your library folder>/.library/library.json`. Edit
it and the room reloads while you are standing in it. See
[docs/library-folder.md](docs/library-folder.md).

The Rust indexer is wired: `choose folder…` then `scan` in the desktop app
indexes your real PDFs and EPUBs. In the browser build there is no filesystem,
so the shelves are stocked from a **placeholder catalogue** plus one real
generated PDF (`sample-book.pdf`) so read mode can be tested headlessly.

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
| `E` | take the book under the crosshair (off a shelf or out of a box), put it back, or sit in the chair you are looking at |
| `R` | read the book in your hand |
| drag | while reading, drag a page across to turn it — let go early and it falls back |
| `←` `→` | turn pages without dragging; `Esc` closes the book |
| `B` | put a bookmark in the page you are on, or take it out again |

Bookmarks are slips standing out of the top of the book, placed along its width
by how far in they are. Click one to open the book there. They are saved with
the library, so they are still in it next time.

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
| `npm run scan -- <folder>` | Indexes a folder from the command line, no app needed |
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
                    and what happens to shelved books when the room changes
  scene/            R3F scene graph — rooms, shelves, books, boxes, furniture,
                    and the spine atlas that prints titles onto them
  reader/           read mode: page cache, page mesh, the turn
  state/            zustand stores: world, library, app, player pose
  data/             placeholder catalogue + book proportions
  ui/               DOM overlay: crosshair, focus card, panels
src-tauri/          Rust core: commands, settings, db + format probes
tests/              Playwright harness — smoke tests plus world/layout units
scripts/            asset generation, icon, test corpus
spikes/reading/     throwaway spike that de-risked 3D page reading
docs/plan.md            architecture, phase plan, spike amendments
docs/library-folder.md  the library folder format, and the reconciliation rules
docs/ideas.md           the running wish list
```

## The rule

**Nothing above `src/services/` imports `@tauri-apps/*`.** Everything reaches
the filesystem through the `LibraryService` interface, which has a native driver
and a no-filesystem browser driver today. That is what keeps a Linux-hosted web
build a driver swap instead of a rewrite — see
[docs/plan.md](docs/plan.md#the-one-architectural-rule).

## Regenerating the icon

The app icon is generated, not committed as an opaque binary:

```bash
npm run icon           # scripts/make-icon.mjs -> assets/icon-source.png -> src-tauri/icons/
```
