# The Library Folder

A library is a **folder**. Point the app at one and you get that library: its
rooms, its furniture, and which book is on which shelf. Copy the folder and you
have copied the library.

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
  roms/                       ← one cartridge per file, for the arcade machine
    ch8/
      pong.ch8
  .library/                   ← everything the app owns, in one place
    library.json               ← the rooms. You edit this. The app never does.
    books.json                 ← which book is where, and what you wrote on the
                                 shelves. The app writes this.
    ambience.json              ← lamps, night, weather. Delete it for a bright dry day.
    annotations.json           ← your bookmarks and notes, by page. Readable as it is.
    index.json                 ← what was found in the folder. Rebuildable — and readable.
    covers/                    ← extracted and rendered cover art, cached
```

Everything the app owns lives in `.library/`, so the rest of the folder stays
yours. A scan never looks inside `.library/` — it is skipped by name, like
`node_modules` — so nothing in there can be mistaken for a book.

**Books live in `books/`.** A library folder holds more than books, and four
names are reserved for the rest of it: `music/` (records for the player),
`artwork/` (what hangs on the walls), `video/` (tapes for the television) and
`roms/` (games for the arcade machine). As soon as a `books/` folder exists,
indexing reads that and nothing else — so sleeve notes filed with an album never
turn up on a shelf. A folder from before this convention, with books lying loose
at the top level, is still read whole, minus those four; the scan says which of
the two it is doing.

**Only `books/` is indexed.** The other four are walked on demand. A book index
is worth caching — probing a PDF is slow and a collection is tens of thousands
of files — while a music folder is hundreds and a video folder dozens, so a
second cache would buy nothing and a record dropped in five seconds ago would
not be on the shelf.

**Before you have chosen a folder**, `library.json`, `books.json`,
`ambience.json` and `annotations.json` live in the app's own config directory,
so a fresh install has somewhere to put them. They move to the library folder
the first time you choose one. The panel always shows the live path.

**Covers are cached in `.library/covers/`.** Rasterising a thousand PDF first
pages takes minutes, so the artwork travels with the library. Delete the folder
and it is rebuilt on demand.

**The index is in there too**, so `npm run scan` and the app read the same one.
It is still derived: delete `.library/index.json` and rescan.

Every file in `.library/` is plain JSON, which means the whole folder can go into
version control as it is — a rescan that finds nothing new writes nothing at
all, and a diff is exactly the books that changed. The paths inside the index are
relative to the library folder, so copying it to another machine, or into a
container, does not strand a single book.

One consequence worth knowing: a scan skips any file whose size and modified time
are unchanged, so if you correct a `title` or an `author` in `index.json` by hand,
the correction survives every later scan. A typo that breaks the JSON is reported
rather than overwritten — deleting the file is how you start the index over.

## Scanning from the Command Line

```bash
npm run scan -- "D:\Books"
npm run scan -- "D:\Books" --quiet
```

The same indexer the app runs, without the app: it walks the folder's `books/`,
reads metadata from every PDF and EPUB, extracts EPUB cover art, and writes both
into `.library/`. Useful for indexing a large collection ahead of time, and for
finding which file a failing scan died on, since it names each before reading
it. The first line printed is the folder it is reading.

It cannot produce PDF cover art: those first pages are rasterised by pdf.js
inside the app, so the build need not ship a native PDF renderer. They are
filled in the first time you look at the book, and cached from then on.

## `library.json` — The Rooms

This is the file you edit. It is JSON, except that **comments are allowed**:

```jsonc
{
  // both // and /* */ work
  "name": "The Cabin",
  "spawn": { "room": "main", "at": [0, 1.0], "facing": 0 },
  "rooms": [/* … */]
}
```

What follows is the reference. **[Building a Map](custom-maps.md) is the guide**
— rooms over rooms, stairs, railings, lighting, and the arithmetic that makes a
staircase arrive at a floor rather than under one.

Save it and **the room reloads while you are standing in it**. The app watches
the file and re-reads it every 700 ms.

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
- Everything _inside_ a room — shelves, furniture, spawn — is positioned
  relative to **that room's centre**, so moving a whole room moves its contents
  with it.
- `facing` is **degrees clockwise about Y**. `0` faces +Z; `90` faces +X; `180`
  faces −Z; `270` faces −X. For a bookcase, the facing direction is its open
  front, so a case against the west wall faces `90` — into the room. For
  `spawn.facing` it is the direction you are _looking_, so there `0` is north.

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
  "openings": [/* … */],
  "shelves": [/* … */],
  "furniture": [/* … */]
}
```

Rooms are axis-aligned boxes. Walls are 0.12 m thick and are drawn **outward**
from the floor area, so a room's `size` is the space you can actually walk in.

Two rooms on the **same** level should not overlap. Two rooms on different
levels are how you build a loft: give the upper one an `elevation`, only the
walls the lower one does not already have, no ceiling of its own, and a hole for
the stairs to come up through. [Building a Map](custom-maps.md#two-floors) walks
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

| field             | meaning                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `wall`            | `north` (−Z), `south` (+Z), `east` (+X), `west` (−X)             |
| `at`              | centre of the opening, measured from the **middle** of that wall |
| `width`, `height` | the hole                                                         |
| `sill`            | height of its bottom edge above the floor                        |
| `kind`            | `door` or `window`                                               |
| `glazed`          | whether a pane is fitted. Defaults to true for a window.         |

A `door` at floor level is walkable. A `window` is not — its apron is a
waist-high wall you bump into, which is what you want when the sill is at 0.9 m.

That last property is how you build a **railing**: a very wide window with a
waist-high sill and `"glazed": false` is something you can see the room over and
cannot walk off. The loft balustrade and the porch rails are all built this way.

### Shelves

```jsonc
{
  "id": "west-0",
  "at": [-4.825, -3.2],
  "facing": 90,
  "rows": 5,
  "label": "Fiction"
}
```

`rows` is how many compartments the case has; the compartments divide the same
carcass, so **fewer rows means taller shelves**. `at` is where the case stands,
relative to the room centre. To stand one flush against a wall, offset it from
the wall by half the case's depth plus a little: `0.175`. A case is 1.0 m wide
and 0.32 m deep, so `1.05` apart is the tightest a run can stand.

`label` is a _starting_ label for the card on the case's top edge. You can
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

| `kind`                                           | notes                                                                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `armchair` `sofa` `diningchair` `bench`          | solid, and you can sit — look at it and press `E`                                                                                                                      |
| `table` `sidetable` `footstool` `kitchencounter` | solid, and you can put a book down on it                                                                                                                               |
| `bathtub` `basin` `toilet`                       | solid; the first two take a book on their rim                                                                                                                          |
| `floorlamp` `pendant` `fireplace` `fairylights`  | light. `E` switches it; the state goes to `ambience.json`, with the night and the weather                                                                              |
| `lightswitch`                                    | hung like a picture; `E` works every light in the library at once                                                                                                      |
| `recordplayer` `coffeemaker`                     | `E` works it. Give it a `y` so it stands on something. The coffee maker brews a pot, hands you its one cup, and the coffee makes you quicker for a while               |
| `phone` `fridge` `bin`                           | the kitchen's verbs: `E` orders food — a courier walks it to the nearest `step` — takes a cold can, and swallows the empties; `F` drinks or eats what you hold         |
| `headlamp`                                       | lying on the porch table; `E` wears it — hands free, the beam follows your eyes — and a bare tabletop takes it off again                                               |
| `door` `tent` `campfire`                         | a hinged door for a doorway (`E` swings it; closed blocks), and the camp: an A-frame tent, and a fire lit at the fire itself                                           |
| `crt` `tapecrate`                                | a television and a crate that fills itself from your `video/` folder                                                                                                   |
| `computer`                                       | the catalogue terminal: `E` searches the whole library and says where a thing is                                                                                       |
| `postits`                                        | a pad of notes; `E` peels one off to write on                                                                                                                          |
| `marker`                                         | a whiteboard marker; `E` takes it, then the left mouse button draws                                                                                                    |
| `whiteboard`                                     | hung like a picture; `E` pins a page or a note to it, and the marker writes on it                                                                                      |
| `recordshelf`                                    | a crate that fills itself from your `music/` folder                                                                                                                    |
| `picture` `clock`                                | hung on a wall; `y` is the centre of it                                                                                                                                |
| `plant`                                          | solid; `height` varies it                                                                                                                                              |
| `rug`                                            | not solid; `size` sets its footprint                                                                                                                                   |
| `stairs`                                         | a ramp underfoot, treads to look at; `size` is [width, run] and `rise` is how far up                                                                                   |
| `box`                                            | a moving box — solid; books with no shelf are piled in it, `G` empties it onto the nearest shelves, `X` picks it up to carry, and `Backspace` breaks an empty one down |
| `boxstack`                                       | flattened spare boxes — `E` takes one into your arms, `X` stands it up as a new box (the default map keeps the stack in the kitchen)                                   |

The full table, with what is solid and what you can do to it, is in
[Building a Map](custom-maps.md#the-kinds).

Most of these are solid, so keep furniture out of the line you walk in on — a
footstool in a doorway is the kind of thing you only find by walking into it.

## `books.json` — Which Book Is Where

Written by the app, not by you. It is a map from `shelfId:row` to an ordered
list of book ids, and a map from box id to the books in that box:

```json
{
  "rows": {
    "west-0:0": ["a3f1…", "9c02…"],
    "west-0:1": ["71bd…"]
  },
  "boxes": {
    "box-1": ["5e77…", "c410…"]
  },
  "loose": {
    "d81a…": {
      "x": 2.61,
      "y": 0.77,
      "z": 1.4,
      "yaw": 1.9,
      "open": true,
      "spread": 74
    }
  },
  "progress": { "a3f1…": 41 },
  "labels": { "west-0": "Fiction" },
  "furniture": { "box-1": { "at": [-0.9, 2.4], "facing": 8 } },
  "spawnedBoxes": {
    "box-5": { "room": "main", "at": [1.2, -0.4], "facing": 90 }
  },
  "removedBoxes": ["box-3"],
  "props": {
    "cup": { "kind": "cup", "full": false, "x": 6.7, "y": 0.92, "z": 0.9, "yaw": 0.4 }
  }
}
```

A book id is a hash of the file's length and its first 64 KiB — its contents, not
its path — so renaming or moving a file reconciles to the same book instead of
duplicating it.

`boxes` is keyed by the `id` of a `box` piece of furniture, so a book you drop
into the box by the door is in _that_ box and is still in it next time. A box
holds as many books as you put in it; it shows as many as physically fit.

`loose` is the third place a book can be: on a table, or on the floor. It is the
only part of this file that stores coordinates, because "there, where I put it"
is not derivable from an ordering the way a shelf position is. `open` and
`spread` let a book lie face down at the page you were reading.

`progress` maps a book to the spread it was last open at — a fact about the
room's copy rather than marginalia, which is why bookmarks and notes live in
`annotations.json` instead. `labels` is what you have written on each bookcase,
overriding the `label` in `library.json`. `furniture` is where you have shoved
things; only the moving boxes and the portable furniture can be shoved.

`spawnedBoxes` are the boxes you have made up off a `boxstack` — each records
which room's frame its position is written in — and `removedBoxes` are the
document's boxes you have broken down. Both are the app's own edits to the box
population, which is why they live here and never touch `library.json`.

`props` are the small things — the coffee cup, the cans, the takeaway boxes and
the headlamp — each with a real position, for the same reason `loose` has one.
There is exactly one cup (`cup`) and one headlamp (`headlamp`); the headlamp is
written down only while it is _off_ your head, since worn is session state. Cans
and takeaway boxes are minted on arrival and vanish into the kitchen bin.

All of this is in `books.json` rather than `library.json` for one reason:
**`library.json` is a file you wrote**, comments and all, and pushing a box
across the room must not reformat it.

A label or a placement referring to something the library no longer has is
dropped on load, the same way a shelf entry is.

The file carries no version number, and neither do the other three the app
writes. Every field but `rows` is optional and unknown ones are ignored, so the
document reads by its shape alone — which is all a file the app writes and only
the app reads has ever needed.

### Pages and Notes

`books.json` also carries `pins`: the sheets of paper stuck to the walls.

```json
"pins": [
  { "id": "pin-lq3x9-1", "kind": "page", "bookId": "9f3c…", "page": 47,
    "x": 7.24, "y": 1.42, "z": 7.32, "yaw": 3.14159, "tilt": 0.03 },
  { "id": "pin-lq3xb-2", "kind": "note", "text": "ask about the 1963 edition",
    "colour": 1, "x": 5.3, "y": 1.6, "z": 6.1, "yaw": 1.5708, "tilt": -0.05 }
]
```

A `page` is a **copy**: it records which book and which page number, and the
book keeps its own page. The sheet is rasterised from the same file next time it
is drawn, which is also why taking one down and putting it up elsewhere loses
nothing.

Positions are in world metres with a `yaw`, like a book left on a table. A wall
that goes away leaves the sheet hanging where it was rather than teleporting to
whichever wall inherited the id.

On load, a page whose book the index has lost is dropped. A note is always kept.

### Records You Have Moved

`books.json` also carries `records`, and it is deliberately sparse: a record
nobody has touched is dealt into a crate from the `music/` folder's own order,
so the usual state of this key is empty.

```json
"records": {
  "filed": { "b71c…": "records" },
  "loose": { "2ad9…": { "x": -1.3, "y": 0.78, "z": -1.5, "yaw": 2.4 } }
}
```

`filed` is a record you carried to a particular crate; `loose` is one you set
down on a table. One entry each rather than an ordering, because unlike a shelf
a crate has no order worth keeping. `Q` with a record in hand clears both.

### What Is Drawn on the Whiteboards

`drawings` maps a `whiteboard`'s furniture id to the lines on it, oldest first.

```json
"drawings": {
  "board": [{ "ink": 0, "points": [0.21, 0.62, 0.24, 0.61, 0.29, 0.58] }]
}
```

`points` are flattened `u, v` pairs in board space — across from the left edge
and up from the bottom, both 0 to 1 — so resizing a board in `library.json`
keeps its drawing instead of scattering it. `ink` is which pen, as an index into
the three in the tray.

## `annotations.json` — Your Bookmarks and Notes

Written by the app, but **meant to be read without it** — this is the file to
open when you want your marginalia somewhere else.

```json
{
  "books": {
    "a3f1…": {
      "title": "The Shelf as Argument",
      "author": "A. Sample",
      "bookmarks": [1, 45, 203],
      "notes": [
        {
          "id": "note-mfx9k2-1",
          "page": 45,
          "text": "Check this against the 1972 edition.",
          "created": "2026-08-13T10:12:00.000Z"
        }
      ],
      "drawings": {
        "45": [{ "ink": 1, "points": [0.21, 0.62, 0.24, 0.61] }]
      }
    }
  }
}
```

`drawings` is ink drawn on a page with the pen (`D` in the reader), keyed by
page number. Strokes are the same shape a whiteboard stores — flattened `u, v`
pairs in page space, across from the left edge and up from the bottom, 0 to
1 — so the line lands in the same place on the page at any screen size.

Unlike everything in `books.json` it speaks **1-based page numbers**, as
printed, rather than the reader's spreads, so a bookmark on page 45 means
something in any other reader. Each entry carries the book's title and author so
it stays legible alone, and **nothing here is ever pruned**: a book that leaves
the index keeps its entry, and because ids are content hashes, the marginalia
reattach by themselves if the file comes back.

Bookmarks are recorded as the right-hand page of the spread the slip is in. For
an EPUB, page numbers are the reader's own pagination (the same one "go to
page" uses), since an EPUB has no printed pages; a bookmark on the last spread
of one can name a page one past the end, which is harmless.

The app can also write the whole thing out as prose: **Export Annotations** in
the settings panel produces `annotations.md` — a Markdown digest ordered by
title — beside this file on the desktop, or as a download in the container.

### A Page Number Is Per Machine

For a PDF this is exact: page 45 is the page the publisher printed 45 on, and it
is the same everywhere.

For an **EPUB** it is not quite. An EPUB has no printed pages, so the reader sets
one — the same pagination "go to page" uses — and it sets it in whatever font
that machine resolved `Georgia, "Iowan Old Style", "Times New Roman", serif` to.
Within one machine it is completely stable: pagination is computed once at open
time in abstract units, so page 200 is page 200 on any monitor, in any window,
next session. Across machines it can shift by a page or so, because a machine
without Georgia is measuring a different typeface.

Which matters here because this file is meant to travel with the folder. Carry a
library between a Windows desktop and a Linux-hosted container and an EPUB
bookmark may land a page out. The books, the shelving and everything in
`books.json` are unaffected — they are keyed by content hash, not by layout.

## `ambience.json` — The Lamps, the Hour and the Weather

Also written by the app, and deliberately tiny:

```json
{
  "on": { "porch-lamp": true, "kitchen-pendant": false },
  "night": false,
  "rain": true
}
```

`on` is keyed by the `id` of a piece of furniture that gives light. A lamp
missing from here starts however `library.json` says. **Delete the file and
every light comes back on** — a repair anybody can perform, and the reason this
is its own file rather than four more lines in `books.json`.

`night` and `rain` are here for the same reason as the lamps: they are facts
about the room right now rather than settings about the app, so they travel with
the library. Deleting the file restores the daylight and dry weather too.
Anything about your _machine_ — low performance mode, whether you see your own
body, how loud things are — is deliberately not here; it is in browser storage,
so it does not follow a library folder onto somebody else's computer.

## What Happens to Your Books When You Change the Room

This is the part that could lose work, so it is worth understanding. The rule:
**the app never puts a book on a shelf. You do.** A book it has not been told
where to put is in a box — which is where a newly indexed library starts.

| you edit `library.json` to…        | what happens to the books                             |
| ---------------------------------- | ----------------------------------------------------- |
| move or rotate a bookcase          | they ride along — same id, new position               |
| reorder or rename things around it | nothing; ids do not care about order                  |
| **delete** a bookcase              | its books go into the **moving boxes**                |
| **rename** a bookcase              | same as deleting it — the id is the identity          |
| give it fewer rows, or narrow it   | whatever no longer fits goes into the boxes           |
| add a bookcase                     | it arrives **empty**, ready for books                 |
| break the JSON                     | rejected; the live room and your layout are untouched |

And separately:

|                                      |                                            |
| ------------------------------------ | ------------------------------------------ |
| a book is new since the last scan    | into the boxes, for you to unpack          |
| a book's file was deleted            | simply gone; not reported as displaced     |
| you delete a `box` from the document | its books tip into the boxes that are left |

**Deleting a bookcase is reversible.** `books.json` is not pruned when a shelf
disappears: the books show in the boxes, but the file still records which shelf
they belonged to. Put the bookcase back with the same id and they return to it
in order — until you shelve one of them somewhere else.

The panel tells you when an edit cost something:

```text
23 books lost their shelves — packed into the boxes.
```

If there is no `box` furniture anywhere, unshelved books have nowhere to be
shown — they are still counted in the panel, and still there. Add a box to
`library.json`. The default document comes with four.

## Unpacking

The default library has four boxes, and a freshly indexed collection is in them.

|                                          |                                                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| look at a box, press `G`                 | every book in it goes onto the shelves: empty rows first, nearest bookcase first, so carrying the box to the case you mean to fill fills _that_ case |
| look at a book in a box, press `E`       | take that one out                                                                                                                                    |
| holding a book, look at a box, press `E` | put it in _that_ box                                                                                                                                 |

Whatever will not fit on the shelves stays in the box rather than being dropped.
Which box a book is in is written down, so a box you have sorted by hand stays
sorted.

## Starting Over

Delete `.library/library.json` and the app writes a fresh default room the next
time it starts. Delete `.library/books.json` as well and your whole library goes
back into the boxes, ready to be unpacked again.
