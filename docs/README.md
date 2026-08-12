# Documentation

Start wherever your question is.

## Using It

- **[modes.md](modes.md)** — the two ways to run it: the desktop app, and the
  container that serves a library folder to a browser. What is the same in both,
  what differs, and what hosted mode deliberately does not do. Read this first if
  you are deciding how to run it.
- **[getting-started.md](getting-started.md)** — install the desktop app, try the
  demo library, point it at your own books, find your way round the room.
- **[docker.md](docker.md)** — the hosted mode: running the container, what is in
  the image, and the routes it serves.
- **[controls.md](controls.md)** — every key, plus the menu and what is in
  settings. `F1` shows the same keys in the room.
- **[library-folder.md](library-folder.md)** — what a library folder is, what the
  app writes into it, and what happens to your shelved books when you change the
  room underneath them.
- **[custom-maps.md](custom-maps.md)** — building your own building: rooms,
  openings, lofts, stairs, roofs, furniture, light. Read this before editing
  `library.json`.

## Working on It

- **[architecture.md](architecture.md)** — the map. What the pieces are, which way
  the dependencies point, and why the awkward decisions were made the way they
  were. Start here.
- **[development.md](development.md)** — commands, how the tests are arranged, the
  frame budget, and how to add a furniture kind or a key.

## What Is Next

- **[known-bugs-ideas.md](known-bugs-ideas.md)** — the running list of known
  bugs and what to build next.

---

Two documents outside this folder are worth knowing about:

- **[../README.md](../README.md)** — the front page: what kleib3ry is, the two
  quick starts, and the demo library.
- **[../CLAUDE.md](../CLAUDE.md)** — the short form of the architecture, for an
  agent working in the repo. It is a summary of `architecture.md`, not a second
  source of truth: if the two disagree, `architecture.md` is the one that was
  written to be read by a person.
