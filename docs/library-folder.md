# The library folder

A library is a **folder**. Point the app at one and you get that library: its
rooms, its furniture, and which book is on which shelf. Point it at a different
folder and you get a different library. Copy the folder and you have copied the
library; back it up and you have backed it up.

```text
My Library/                   ← the folder you choose in the app
  books/                      ← your books, in whatever folders you like
    Essays/
      on_the_provinces.pdf
      letters_to_clocks.pdf
    in_praise_of_quiet.epub
  music/                      ← one record per file, for the record player
    Nina Simone/
      Wild Is the Wind/
        04 Four Women.mp3
  artwork/                    ← one picture per file, for the frames on the wall
    lake.jpg
  video/                      ← one tape per file, for the television
    Tarkovsky/
      Stalker.mp4
  .library/                   ← everything the app owns, in one place
    library.json               ← the rooms. You edit this. The app never does.
    books.json                 ← which book is where, and what you wrote on the
                                 shelves. The app writes this.
    lights.json                ← which lamps are on. Delete it and they all are.
    index.sqlite               ← what was found in the folder. Rebuildable.
    covers/                    ← extracted and rendered cover art, cached
```

Everything the app owns lives in `.library/`, so the rest of the folder stays
yours. A scan never looks inside `.library/` — it is skipped by name, like
`node_modules` — so nothing in there can be mistaken for a book.

**Books live in `books/`.** A library folder holds more than books, and three
names are reserved for the rest of it: `music/` (records for the player),
`artwork/` (what hangs on the walls) and `video/` (tapes for the television). As
soon as a `books/` folder exists, indexing reads that and nothing else — so sleeve
notes filed with an album never turn up on a shelf. A folder from before this
convention, with books lying loose at the top level, is still read whole, minus
those three; the scan says which of the two it is doing.

**Only `books/` is indexed.** The other three are walked on demand, every time the
app asks. A book index is worth caching — probing a PDF is slow and a collection
is tens of thousands of files — while a music folder is hundreds and a video
folder is dozens, so a second cache to keep in sync would buy nothing and a record
you dropped in five seconds ago would not be on the shelf.

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

The same indexer the app runs, without the app: it walks the folder's `books/`,
reads metadata from every PDF and EPUB, extracts EPUB cover art, and writes both
into `.library/`. Useful for indexing a large collection ahead of time — and for
finding out which file a failing scan died on, since it names each one before
reading it. The first line it prints is the folder it is actually reading.

It cannot produce PDF cover art: those first pages are rasterised by pdf.js
inside the app, so the build does not have to ship a native PDF renderer. They
are filled in the first time you look at the book, and cached from then on.

## `library.json` — the rooms

This is the file you edit. It is JSON, except that **comments are allowed**,
because a file meant to be read by a person should be able to explain itself:

```jsonc
{
  // both // and /* */ work
  "schemaVersion": 2,
  "name": "The Cabin",
  "spawn": { "room": "main", "at": [0, 1.0], "facing": 0 },
  "rooms": [ ... ]
}
```

What follows is the reference. **[Building a map](custom-maps.md) is the guide**
— rooms over rooms, stairs, railings, lighting, and the arithmetic that makes a
staircase arrive at a floor rather than under one.

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
  front, so a case against the west wall faces `90` — into the room. For
  `spawn.facing` it is the direction you are *looking*, so there `0` is north.

### Rooms

```jsonc
{
  "id": "main",              // required, unique
  "name": "Main room",       // optional, defaults to the id
  "origin": [0, 0],          // centre, in world metres
  "size": [8, 6],            // width along X, depth along Z
  "height": 3.2,             // optional, default 3.2
  "elevation": 0,            // height of this room's floor. A loft has one.
  "walls": ["north", "south", "east", "west"],  // which walls to build
  "ceiling": true,           // false where the room above is your ceiling
  "floor": "boards",         // boards | deck | stone
  "outdoor": false,          // a porch: decking, no skirting, no room light
  "holes": [],               // rectangles missing from the floor, for a stairwell
  "openings": [ ... ],
  "shelves": [ ... ],
  "furniture": [ ... ]
}
```

Rooms are axis-aligned boxes. Walls are 0.12 m thick and are drawn **outward**
from the floor area, so a room's `size` is the space you can actually walk in.

Two rooms on the **same** level should not overlap. Two rooms on different
levels are how you build a loft: give the upper one an `elevation`, only the
walls the lower one does not already have, no ceiling of its own, and a hole for
the stairs to come up through. [Building a map](custom-maps.md#two-floors) walks
through it.

**Joining two rooms:** place them `0.24` m apart — twice the wall thickness — so
their wall slabs sit flush, and put a matching door in each of the facing walls.
The default document does this between `main` and `reading`; the arithmetic is
written out in a comment there.

### Openings

```jsonc
{ "wall": "north", "at": 0, "width": 2.6, "height": 1.5, "sill": 0.9, "kind": "window" }
{ "wall": "east",  "at": 0, "width": 1.1, "height": 2.05, "sill": 0, "kind": "door" }
{ "wall": "south", "at": 0, "width": 8.6, "height": 1.4, "sill": 1.0,
  "kind": "window", "glazed": false }
```

| field | meaning |
| --- | --- |
| `wall` | `north` (−Z), `south` (+Z), `east` (+X), `west` (−X) |
| `at` | centre of the opening, measured from the **middle** of that wall |
| `width`, `height` | the hole |
| `sill` | height of its bottom edge above the floor |
| `kind` | `door` or `window` |
| `glazed` | whether a pane is fitted. Defaults to true for a window. |

A `door` at floor level is walkable. A `window` is not — its apron is a
waist-high wall you bump into, which is what you want when the sill is at 0.9 m.

That last property is how you build a **railing**: a very wide window with a
waist-high sill and `"glazed": false` is something you can see the room over and
cannot walk off. The loft balustrade and the porch rails are all built this way.

### Shelves

```jsonc
{ "id": "west-0", "at": [-4.825, -3.2], "facing": 90, "rows": 5, "label": "Fiction" }
```

`rows` is how many compartments the case has; the compartments divide the same
carcass, so **fewer rows means taller shelves**. `at` is where the case stands,
relative to the room centre. To stand one flush against a wall, offset it from
the wall by half the case's depth plus a little: `0.175`. A case is 1.0 m wide
and 0.32 m deep, so cases stand 1.05 m apart in a run.

`label` is a *starting* label for the card on the case's top edge. You can
relabel a case in the app with `L`, and that overrides what is written here —
the app's labels live in `books.json`, so a hand edit and an in-app edit never
fight over the same file.

**The `id` is load-bearing.** It is what `books.json` is keyed by — see below.

### Furniture

```jsonc
{ "id": "chair", "kind": "armchair", "at": [1.55, 0.25], "facing": 265 }
{ "id": "rug",   "kind": "rug", "at": [1.0, 0.3], "facing": 0, "size": [2.6, 2.4] }
```

Optional fields: `size` (footprint, or width by height for a picture), `height`,
`y` (how far off the floor the piece sits — a coffee maker on a counter is
`"y": 0.92`), `source` (which file in `artwork/` a picture shows), `rise` (how
far a staircase climbs), and `on` (whether a lamp starts lit).

| `kind` | notes |
| --- | --- |
| `armchair` `sofa` `diningchair` `bench` | solid, and you can sit — look at it and press `E` |
| `table` `sidetable` `footstool` `kitchencounter` | solid, and you can put a book down on it |
| `floorlamp` `pendant` `fireplace` | light. `E` switches it; the state goes to `lights.json` |
| `recordplayer` `coffeemaker` | `E` works it. Give it a `y` so it stands on something |
| `recordshelf` | a crate that fills itself from your `music/` folder |
| `picture` | a framed image from `artwork/`; `y` is the centre of the frame |
| `plant` | solid; `height` varies it |
| `rug` | not solid; `size` sets its footprint |
| `stairs` | a ramp underfoot, treads to look at; `size` is [width, run] and `rise` is how far up |
| `box` | a moving box — solid; books with no shelf are piled in it, `G` empties it onto the shelves and `X` picks it up to carry |

The full table, with what is solid and what you can do to it, is in
[Building a map](custom-maps.md#the-kinds).

Most of these are something you bump into, so keep furniture out of
the line you walk in on. (The default reading corner has a comment about exactly
this: a footstool in a doorway is the kind of thing you only find by walking
into it.)

## `books.json` — which book is where

Written by the app, not by you. It is a map from `shelfId:row` to an ordered
list of book ids, and a map from box id to the books in that box:

```json
{
  "schemaVersion": 5,
  "rows": {
    "west-0:0": ["a3f1…", "9c02…"],
    "west-0:1": ["71bd…"]
  },
  "boxes": {
    "box-1": ["5e77…", "c410…"]
  },
  "loose": {
    "d81a…": { "x": 2.61, "y": 0.77, "z": 1.4, "yaw": 1.9, "open": true, "spread": 74 }
  },
  "bookmarks": { "a3f1…": [0, 12, 41] },
  "progress":  { "a3f1…": 41 },
  "labels":    { "west-0": "Fiction" },
  "furniture": { "box-1": { "at": [-0.9, 2.4], "facing": 8 } }
}
```

A book id is a hash of its path, size and modification time, so renaming or
moving a file reconciles to the same book instead of duplicating it.

`boxes` is keyed by the `id` of a `box` piece of furniture, so a book you drop
into the box by the door is in *that* box and is still in it next time. A box
holds as many books as you put in it; it shows as many as physically fit.

`loose` is the third place a book can be: on a table, or on the floor where you
dropped it. It is the only part of this file that stores coordinates, because
"there, where I put it" is not derivable from an ordering the way a shelf
position is. `open` and `spread` are what let a book lie face down at the page
you were reading.

`bookmarks` maps a book to the spreads you have left a slip in, and `progress`
to the one it was last open at. `labels` is what you have written on each
bookcase — it overrides the `label` in `library.json`. `furniture` is where you
have shoved things; only the moving boxes can be shoved.

All four of those are here rather than in `library.json` for the same reason:
**`library.json` is a file you wrote**, comments and all, and pushing a box
across the room must not reformat it.

A bookmark, a label or a placement referring to something the library no longer
has is dropped on load, the same way a shelf entry is.

Version 2 rekeyed `rows` from shelf index to shelf id; version 3 added
`bookmarks`; version 4 added `boxes` and stopped shelving newly indexed books
for you; version 5 added `loose`, `progress`, `labels` and `furniture`. Older
documents still load — everything added since has been optional — but a version
2 file will not have its shelves where you left them if it predates the rekey,
since the old keys named positions rather than bookcases.

### Pages and notes

`books.json` also carries `pins`: the sheets of paper stuck to the walls.

```json
"pins": [
  { "id": "pin-lq3x9-1", "kind": "page", "bookId": "9f3c…", "page": 47,
    "x": 7.24, "y": 1.42, "z": 7.32, "yaw": 3.14159, "tilt": 0.03 },
  { "id": "pin-lq3xb-2", "kind": "note", "text": "ask about the 1963 edition",
    "colour": 1, "x": 5.3, "y": 1.6, "z": 6.1, "yaw": 1.5708, "tilt": -0.05 }
]
```

A `page` is a **copy**. It records which book and which page number, and the book
keeps its own page — nothing is torn out of anything, and the sheet is rasterised
from the same file the next time it is drawn. That is also why taking one down and
putting it up somewhere else loses nothing.

Positions are in world metres with a `yaw`, like a book left on a table, and for
the same reason: you stuck it *there*. A wall that goes away leaves the sheet
hanging over where it was rather than teleporting to whichever wall inherited
the id.

On load, a page whose book the index has lost is dropped — it is a page of
nothing. A note is nobody's but yours and always stays.

## `lights.json` — which lamps are on

Also written by the app, and deliberately tiny:

```json
{ "schemaVersion": 1, "on": { "porch-lamp": true, "kitchen-pendant": false } }
```

Keyed by the `id` of a piece of furniture that gives light. A lamp missing from
here is however `library.json` said it should start. **Delete the file and every
light in the library comes back on** — which is a repair anybody can perform
without knowing what a schema is, and the reason it is its own file rather than
four more lines in `books.json`.

## What happens to your books when you change the room

This is the part worth understanding, because it is the part that could lose
work. The rule is: **the app never puts a book on a shelf. You do.** A book it
has not been told where to put is in a box — which is where a whole newly
indexed library starts.

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
| a book is new since the last scan | into the boxes, for you to unpack |
| a book's file was deleted | simply gone; not reported as displaced |
| you delete a `box` from the document | its books tip into the boxes that are left |

**Deleting a bookcase is reversible.** `books.json` is deliberately *not* pruned
when a shelf disappears: the books are shown in the boxes, but the file still
records which shelf they belonged to. Put the bookcase back — same id — and they
go straight back onto it, in the same order. That only stops being true once you
shelve one of them somewhere else, which is you making a new decision.

The panel tells you when an edit cost something:

```text
23 books lost their shelves — packed into the boxes.
```

If there is no `box` furniture anywhere, unshelved books have nowhere to be
shown — they are still counted in the panel, and still there. Add a box to
`library.json`. The default document comes with four.

## Unpacking

The default library has four boxes, and a freshly indexed collection is in them.

| | |
| --- | --- |
| look at a box, press `G` | every book in it goes onto the shelves — empty ones first, in no particular order, so a boxful spreads around the room rather than filling the first bookcase by the door |
| look at a book in a box, press `E` | take that one out |
| holding a book, look at a box, press `E` | put it in *that* box |

Whatever will not fit on the shelves stays in the box rather than being dropped.
Which box a book is in is written down, so a box you have sorted by hand stays
sorted.

## Starting over

Delete `.library/library.json` and the app writes a fresh default room the next
time it starts. Delete `.library/books.json` as well and your whole library goes
back into the boxes, ready to be unpacked again.
