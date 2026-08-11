# The library folder

A library is a **folder**. Point the app at one and you get that library: its
rooms, its furniture, and which book is on which shelf. Point it at a different
folder and you get a different library. Copy the folder and you have copied the
library; back it up and you have backed it up.

```text
My Books/                     ← the folder you choose in the app
  Essays/
    on_the_provinces.pdf       ← your books, wherever you like them
    letters_to_clocks.pdf
  in_praise_of_quiet.epub
  .library/                   ← everything the app owns, in one place
    library.json               ← the rooms. You edit this.
    books.json                 ← which book is on which shelf. The app writes this.
    index.sqlite               ← what was found in the folder. Rebuildable.
    covers/                    ← extracted and rendered cover art, cached
```

Everything the app owns lives in `.library/`, so the rest of the folder stays
your books. A scan never looks inside `.library/` — it is skipped by name, like
`node_modules` — so nothing in there can be mistaken for a book.

**Before you have chosen a folder**, the same two files live in the app's own
config directory instead, so a fresh install still has somewhere to put them.
They move to the library folder the first time you choose one. The panel in the
app always shows the path of the file that is currently live.

**Covers are cached in `.library/covers/`.** Rasterising a thousand PDF first
pages takes minutes, so the artwork travels with the library: copy the folder to
another machine and it does not have to be done again. Delete the folder and it
is rebuilt on demand.

**The index is in there too**, so that `npm run scan` and the app read the same
one. It is still derived: delete `.library/index.sqlite` and rescan.

## Scanning from the command line

```bash
npm run scan -- "D:\Books"
npm run scan -- "D:\Books" --quiet
```

The same indexer the app runs, without the app: it walks the folder, reads
metadata from every PDF and EPUB, extracts EPUB cover art, and writes both into
`.library/`. Useful for indexing a large collection ahead of time — and for
finding out which file a failing scan died on, since it names each one before
reading it.

It cannot produce PDF cover art: those first pages are rasterised by pdf.js
inside the app, so the build does not have to ship a native PDF renderer. They
are filled in the first time you look at the book, and cached from then on.

## `library.json` — the rooms

This is the file you edit. It is JSON, except that **comments are allowed**,
because a file meant to be read by a person should be able to explain itself:

```jsonc
{
  // both // and /* */ work
  "schemaVersion": 1,
  "name": "My Library",
  "spawn": { "room": "main", "at": [0, 2.1], "facing": 0 },
  "rooms": [ ... ]
}
```

Save it and **the room reloads while you are standing in it**. The app watches
the file and re-reads it about once a second.

If an edit does not parse, it is **rejected whole**. The room you are standing
in keeps running exactly as it was, and the error appears in the panel naming
the field that is wrong:

```text
library.json — rooms[1].shelves[3].at: expected two numbers like [x, z], found a number
```

Nothing is written back over your file, ever. You cannot lose a library by
mistyping in here.

### Coordinates

Metres throughout, and the vertical axis is Y.

- A room's `origin` is its **centre**, in world metres.
- Everything *inside* a room — shelves, furniture, spawn — is positioned
  relative to **that room's centre**, so moving a whole room moves its contents
  with it.
- `facing` is **degrees clockwise about Y**. `0` faces +Z; `90` faces +X; `180`
  faces −Z; `270` faces −X. For a bookcase, the facing direction is its open
  front, so a case against the west wall faces `90` — into the room.

### Rooms

```jsonc
{
  "id": "main",              // required, unique
  "name": "Main room",       // optional, defaults to the id
  "origin": [0, 0],          // centre, in world metres
  "size": [8, 6],            // width along X, depth along Z
  "height": 3.2,             // optional, default 3.2
  "openings": [ ... ],
  "shelves": [ ... ],
  "furniture": [ ... ]
}
```

Rooms are axis-aligned boxes and should not overlap. Walls are 0.12 m thick and
are drawn **outward** from the floor area, so a room's `size` is the space you
can actually walk in.

**Joining two rooms:** place them `0.24` m apart — twice the wall thickness — so
their wall slabs sit flush, and put a matching door in each of the facing walls.
The default document does this between `main` and `reading`; the arithmetic is
written out in a comment there.

### Openings

```jsonc
{ "wall": "north", "at": 0, "width": 2.6, "height": 1.5, "sill": 0.9, "kind": "window" }
{ "wall": "east",  "at": 0, "width": 1.1, "height": 2.05, "sill": 0, "kind": "door" }
```

| field | meaning |
| --- | --- |
| `wall` | `north` (−Z), `south` (+Z), `east` (+X), `west` (−X) |
| `at` | centre of the opening, measured from the **middle** of that wall |
| `width`, `height` | the hole |
| `sill` | height of its bottom edge above the floor |
| `kind` | `door` or `window` |

A `door` at floor level is walkable. A `window` is not — its apron is a
waist-high wall you bump into, which is what you want when the sill is at 0.9 m.

### Shelves

```jsonc
{ "id": "west-0", "at": [-3.835, -1.9], "facing": 90, "rows": 5 }
```

`rows` is how many compartments the case has; the compartments divide the same
carcass, so **fewer rows means taller shelves**. `at` is where the case stands,
relative to the room centre. To stand one flush against a wall, offset it from
the wall by half the case's depth plus a little: `0.165`.

**The `id` is load-bearing.** It is what `books.json` is keyed by — see below.

### Furniture

```jsonc
{ "id": "chair", "kind": "armchair", "at": [1.55, 0.25], "facing": 265 }
{ "id": "rug",   "kind": "rug", "at": [1.0, 0.3], "facing": 0, "size": [2.6, 2.4] }
```

| `kind` | notes |
| --- | --- |
| `armchair` | solid, and you can sit in it — look at it and press `E` |
| `footstool` | solid |
| `sidetable` | solid |
| `floorlamp` | solid, and lights the corner it stands in |
| `rug` | not solid; `size` sets its footprint |
| `box` | a moving box — solid, and books with no shelf are piled in it |

Everything except the rug is something you bump into, so keep furniture out of
the line you walk in on. (The default reading corner has a comment about exactly
this: a footstool in a doorway is the kind of thing you only find by walking
into it.)

## `books.json` — which book is where

Written by the app, not by you. It is a map from `shelfId:row` to an ordered
list of book ids:

```json
{
  "schemaVersion": 3,
  "rows": {
    "west-0:0": ["a3f1…", "9c02…"],
    "west-0:1": ["71bd…"]
  },
  "bookmarks": {
    "a3f1…": [0, 12, 41]
  }
}
```

A book id is a hash of its path, size and modification time, so renaming or
moving a file reconciles to the same book instead of duplicating it.

`bookmarks` maps a book to the spreads you have left a slip in. A bookmark in a
book the index no longer has is dropped on load, the same way a shelf entry is.

Version 2 rekeyed `rows` from shelf index to shelf id; version 3 added
`bookmarks`. Older documents still load — everything added since has been
optional — but a version 2 file will not have its shelves where you left them
if it predates the rekey, since the old keys named positions rather than
bookcases.

## What happens to your books when you change the room

This is the part worth understanding, because it is the part that could lose
work. The rule is: **the app only chooses a home for a book you have never
placed.**

| you edit `library.json` to… | what happens to the books |
| --- | --- |
| move or rotate a bookcase | they ride along — same id, new position |
| reorder or rename things around it | nothing; ids do not care about order |
| **delete** a bookcase | its books go into the **moving boxes** |
| **rename** a bookcase | same as deleting it — the id is the identity |
| give it fewer rows, or narrow it | whatever no longer fits goes into the boxes |
| add a bookcase | it arrives **empty**, ready for books |
| break the JSON | rejected; the live room and your layout are untouched |

And separately:

| | |
| --- | --- |
| a book is new since the last scan | auto-arranged into whatever space is free |
| …and the shelves are full | into the boxes |
| a book's file was deleted | simply gone; not reported as displaced |

**Deleting a bookcase is reversible.** `books.json` is deliberately *not* pruned
when a shelf disappears: the books are shown in the boxes, but the file still
records which shelf they belonged to. Put the bookcase back — same id — and they
go straight back onto it, in the same order. That only stops being true once you
shelve one of them somewhere else, which is you making a new decision.

The panel tells you when an edit cost something:

```text
23 books lost their shelves — packed into the boxes.
```

If there is no `box` furniture anywhere, displaced books have nowhere to be
shown. Add one to `library.json`.

## Starting over

Delete `.library/library.json` and the app writes a fresh default room the next
time it starts. Delete `.library/books.json` as well and it will arrange your
whole library onto the shelves from scratch.
