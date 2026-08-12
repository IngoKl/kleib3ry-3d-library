# Building a Map

A library is a folder, and the _room_ is one file in it:
`<your library folder>/.library/library.json`. Edit it and the building reloads
while you are standing in it. Break it and nothing happens except an error in
the panel — the room you are in keeps running and your file is never written
over.

This is the long version. [The library folder](library-folder.md) is the short
one, and the default document the app writes for you is the worked example: it
is commented throughout, and reading it top to bottom is the fastest way in.

---

## The Shape of the File

```jsonc
{
  // Both // and /* */ work. The file is meant to be read by a person.
  "schemaVersion": 2,
  "name": "The Cabin",
  "spawn": { "room": "main", "at": [0, 1.0], "facing": 0 },
  "rooms": [/* … */]
}
```

Metres throughout, and the vertical axis is Y.

- A room's `origin` is its **centre**, in world metres.
- Everything _inside_ a room — shelves, furniture, spawn — is positioned
  relative to **that room's centre**, so moving a whole room moves its contents.
- `facing` is **degrees clockwise about Y**. For a thing, `0` points its front
  at +Z (south); `90` points east, `180` north, `270` west. For a _person_ —
  `spawn.facing` — it is the direction they are looking, and `0` is north. The
  two are opposite because a bookcase's front faces you and your front faces
  away; it is easier to remember than to justify.

Nothing the app does is ever written back into this file. Where you shove the
boxes, which lamps you switch off, what you write on a shelf label: all of that
lives in `books.json` and `ambience.json` beside it, so your comments and your
formatting are yours.

---

## Rooms

```jsonc
{
  "id": "main", // required, unique, no colons
  "name": "Great room", // optional, defaults to the id
  "origin": [0, 0], // centre, in world metres
  "size": [10, 8], // width along X, depth along Z
  "height": 4.8, // floor to ceiling
  "elevation": 0, // height of this room's floor. A loft has one.
  "walls": ["north", "south", "east", "west"], // which walls to build
  "ceiling": true,
  "floor": "boards", // boards | deck | stone
  "outdoor": false, // a porch: decking, no skirting, no room light
  "holes": [], // rectangles missing from the floor
  "openings": [/* … */],
  "shelves": [/* … */],
  "furniture": [/* … */]
}
```

Rooms are axis-aligned boxes. Walls are 0.12 m thick and are drawn **outward**
from the floor area, so a room's `size` is the space you can actually walk in.
The floor runs out under them, which is what lets two rooms a wall-gap apart
have something to stand on in the doorway between them.

**Joining two rooms:** place them `0.24` m apart — twice the wall thickness — so
their wall slabs sit flush, and put a matching door in each of the facing walls.
The arithmetic is written out in a comment in the default document.

**Butting two rooms together instead:** place them exactly touching and give the
second one no wall on the shared side. That is what the porch does: its north
edge is the cabin's south edge, so the decking meets the floorboards with
nothing to step over, and the cabin's own south wall is what you walk through.

**A second building** is just rooms somewhere else. Nothing in the format ever
said there had to be one house — put a room a hundred metres away and it is a
separate building, with its own roof, its own light and its own bookcases. The
default document does exactly this: the lake house and its deck sit on the rise
above the south-west shore, a walk away from the cabin. Two things are worth
knowing before you site one:

- **the forest is grown around every room's footprint**, plus a few metres of
  clearing, so a building anywhere gets somewhere to stand;
- **the walk round the lake and the trail between the buildings are cleared
  ground**, and putting a room on top of one means walking through your own
  building to get past. Both live in `src/world/terrain.ts`, which is also
  where the trail is drawn — the _route_ between two buildings is a fact about
  the valley rather than about either of them, so it is not in this file.

### Openings

```jsonc
{ "wall": "north", "at": 0, "width": 4.4, "height": 2.1, "sill": 0.8, "kind": "window" }
{ "wall": "east",  "at": 1.4, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" }
{ "wall": "south", "at": 0, "width": 8.6, "height": 1.4, "sill": 1.0,
  "kind": "window", "glazed": false }
```

| field             | meaning                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `wall`            | `north` (−Z), `south` (+Z), `east` (+X), `west` (−X)             |
| `at`              | centre of the opening, measured from the **middle** of that wall |
| `width`, `height` | the hole                                                         |
| `sill`            | height of its bottom edge above **this room's floor**            |
| `kind`            | `door` or `window`                                               |
| `glazed`          | whether a pane is fitted. Defaults to true for a window.         |

A `door` at floor level is walkable. A `window` is not — its apron is a wall you
bump into, which is what you want when the sill is at 0.9 m.

That last property is load-bearing and worth understanding, because **the apron
under an unglazed window is how you build a railing**. A very wide "window" with
a metre-high sill and `"glazed": false` is a balustrade: you can see the whole
room over it, you cannot walk off it, and there is no glass in the way. The
loft's open side and all three sides of the porch are built this way.

---

## Two Floors

A loft is a room with an `elevation`, standing **inside** another room's volume
rather than on top of it. Four things make that work, and all four are in the
default document:

```jsonc
{
  "id": "loft",
  "origin": [0, -1.3],
  "size": [10, 5.4],
  "elevation": 2.5, // 1. its floor is 2.5 m up
  "height": 2.3, // its head height is the cabin's ceiling
  "walls": ["south"], // 2. only the balustrade
  "ceiling": false, // 3. its ceiling is the cabin's
  "holes": [{ "at": [4.4, 0.675], "size": [1.45, 2.95] }] // 4. the stairwell
}
```

1. **`elevation`** raises the floor, and everything in the room with it: shelves
   stand on it, boxes sit on it, books dropped on it land on it. A bookcase is
   2.24 m tall and the floor slab 0.22 m thick, so any lower than this and the
   cases downstairs stand up into the boards.
2. **`walls`** stops you building a second wall in the same place as the room
   below's — the other three here are the cabin's, which run the full 4.8 m.
   Rooms on different levels are allowed to overlap in plan; rooms on the _same_
   level should not.
3. **`ceiling: false`** where the room below already has one at the same height.
4. **`holes`** cuts rectangles out of the floor, in room-local metres. Without
   one, the staircase arrives underneath a floor.

### Stairs

```jsonc
{
  "id": "stairs",
  "kind": "stairs",
  "at": [4.4, -0.4],
  "facing": 180,
  "size": [1.05, 3.4],
  "rise": 2.5
}
```

A flight climbs **towards its facing direction**. `size` is `[width, run]` and
`rise` is how far up it gets. Underfoot it is a smooth ramp; what you see is
treads.

Put the **bottom of the flight somewhere you can actually stand**: the default
one is entered from the open floor by the seating and climbs north along the
east wall. A flight whose bottom step is a hand's width from a wall is a
staircase nobody can get onto — and keep doors off the wall the flight runs
along, or the door opens into the side of it.

The one measurement that has to be right is **where the flight reaches the top**
relative to the stairwell. The floor above only exists outside the hole, so the
hole must end exactly where the ramp reaches the upper floor — otherwise you
walk up the stairs and find a 60 cm step you cannot climb. Work it out from the
run:

```text
flight at z = -0.4, run 3.4, facing 180 (climbing -Z)
  → bottom at z =  1.30 (floor level)
  → top    at z = -2.10 (2.5 m up)
the stairwell hole must therefore END at z = -2.10, not after it
  → hole from z = -2.10 back to 0.85  →  centre -0.625, length 2.95   (world)
    (0.85 is where your head would otherwise meet the underside of the loft)
  → local to a room at origin z = -1.3:  "at": [4.4, 0.675], "size": [1.45, 2.95]
```

Ending the hole _later_ than the top of the flight leaves a strip with no floor
at either height — the ramp has run out and the boards have not started — and
you will climb the stairs and stop dead one pace short of the landing. Ending it
earlier is harmless as long as the ramp is within a step of the floor by then.

The rule the walk controller applies is that a move is only allowed if the floor
you are stepping onto is within 0.42 m of the floor you are on. That is both how
a staircase works and why you cannot walk off the loft, which is a good sign it
is the right rule.

---

## Shelves

```jsonc
{ "id": "west-0", "at": [-4.825, -3.2], "facing": 90, "rows": 5 }
```

`rows` is how many compartments the case has; the compartments divide the same
carcass, so **fewer rows means taller shelves**. `at` is where the case stands,
relative to the room centre. To stand one flush against a wall, offset it from
the wall by half the case's depth plus a little: `0.175`.

A case is 1.0 m wide and 0.32 m deep, so `1.05` apart is the tightest a run can
stand. The default map uses `1.2`, which leaves a hand's width between cases and
reads as furniture rather than as built-in shelving.

`label` is an optional _starting_ label for the card on its top edge, and the
default map deliberately uses it nowhere: a bookcase arrives bare, and you write
on it with `L` once you have decided what is in it. A room that arrives
pre-sorted into somebody else's categories is a room you have to undo first.
An in-app label overrides whatever is written here — the app's labels live in
`books.json` so that a hand edit and an in-app edit never fight over one file.

**The `id` is load-bearing.** It is what `books.json` is keyed by. Move a case
and its books move with it; rename or delete one and its books go into the
moving boxes. See [the library folder](library-folder.md#what-happens-to-your-books-when-you-change-the-room).

---

## Furniture

```jsonc
{ "id": "chair", "kind": "armchair", "at": [1.35, 1.1], "facing": 265 }
{ "id": "rug",   "kind": "rug", "at": [0.9, 1.1], "facing": 0, "size": [2.6, 2.4] }
{ "id": "coffee", "kind": "coffeemaker", "at": [-1.15, 1.35], "facing": 0, "y": 0.92 }
{ "id": "picture-1", "kind": "picture", "at": [-3.4, -3.46], "facing": 0,
  "y": 2.1, "size": [1.0, 0.75], "source": "lake.jpg" }
```

Common fields: `id`, `kind`, `at`, `facing`. Then, all optional:

- **`size`** — footprint `[width, depth]`, or for anything hung on a wall,
  `[width, height]`.
- **`height`** — height override, for the kinds where it is worth varying.
- **`y`** — how far off this room's floor the piece sits. A coffee maker on a
  counter is `"y": 0.92`. For anything **hung on a wall** — a `picture`, a
  `whiteboard`, a `clock`, a `lightswitch` — it is the centre of the thing; for a
  **pendant** it is where the fitting is; for `fairylights` it is the line they
  hang from.
- **`source`** — which file in `artwork/` a picture shows.
- **`rise`** — how far a flight of stairs climbs.
- **`on`** — whether a lamp starts lit.

### The Kinds

| kind             | solid | you can                                                 | notes                                                                                                                                                   |
| ---------------- | ----- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `armchair`       | yes   | sit (`E`)                                               |                                                                                                                                                         |
| `sofa`           | yes   | sit                                                     | `size` sets its length                                                                                                                                  |
| `diningchair`    | yes   | sit                                                     |                                                                                                                                                         |
| `bench`          | yes   | sit                                                     | a porch bench; sitting wins over setting things down                                                                                                    |
| `footstool`      | yes   | put books on                                            | for feet                                                                                                                                                |
| `sidetable`      | yes   | put books on                                            |                                                                                                                                                         |
| `table`          | yes   | put books on                                            | `size` and `height` both worth setting                                                                                                                  |
| `desk`           | yes   | put books on                                            | deeper and a little higher than a table                                                                                                                 |
| `bed`            | yes   | sit, put books on                                       | headboard is its back; `facing` points the foot into the room                                                                                           |
| `kitchencounter` | yes   | put books on                                            | comes with a sink                                                                                                                                       |
| `recordshelf`    | yes   | put books on, file records in                           | fills with records from `music/`                                                                                                                        |
| `tapecrate`      | yes   | put books on                                            | fills with tapes from `video/`; low, so the labels stand proud                                                                                          |
| `bathtub`        | yes   | put books on                                            | its rim is a surface                                                                                                                                    |
| `toilet`         | yes   | —                                                       | `facing` points the seat into the room                                                                                                                  |
| `basin`          | yes   | put books on                                            | on a pedestal                                                                                                                                           |
| `box`            | yes   | fill, carry (`X`), break down (`Backspace`, empty only) | a moving box; books with no shelf pile up in it                                                                                                         |
| `boxstack`       | yes   | take a box (`E`)                                        | flattened spares. `E` puts one in your arms; `X` stands it up as a real box, remembered in `books.json`                                                 |
| `recordplayer`   | no    | play (`E`)                                              | put it on a `y` so it stands on something. An empty one does nothing: bring it a record                                                                 |
| `crt`            | yes   | play a tape (`E`)                                       | a television. `E` with a tape in hand puts it in; `E` empty-handed pauses                                                                               |
| `coffeemaker`    | no    | brew (`E`)                                              | ditto                                                                                                                                                   |
| `computer`       | no    | search (`E`)                                            | the catalogue terminal. Searches every book, record, tape and picture the library knows about and says where each one is. Stand it on a desk with a `y` |
| `postits`        | no    | take one (`E`)                                          | a pad of notes. `E` peels one off and opens the field you write on it — the same note `T` writes                                                        |
| `marker`         | no    | take it (`E`)                                           | a whiteboard marker. With it in hand, hold the left mouse button to draw on any `whiteboard`; `F` changes pen, `G` wipes the board                      |
| `fireplace`      | yes   | switch (`E`)                                            | lights the room it is in                                                                                                                                |
| `floorlamp`      | yes   | switch (`E`)                                            |                                                                                                                                                         |
| `pendant`        | no    | switch (`E`)                                            | hangs from `y`; do not hang one under a loft floor                                                                                                      |
| `fairylights`    | no    | switch (`E`)                                            | a string of bulbs. `size` is `[length, sag]` and `y` is the line it hangs from                                                                          |
| `lightswitch`    | no    | switch everything (`E`)                                 | one press works every light in the library. Hung like a picture                                                                                         |
| `plant`          | yes   | —                                                       | `height` varies it                                                                                                                                      |
| `rug`            | no    | —                                                       | `size` sets its footprint                                                                                                                               |
| `picture`        | no    | —                                                       | takes an image from `artwork/`                                                                                                                          |
| `clock`          | no    | —                                                       | tells this machine's time. Hung like a picture; `size` is the dial                                                                                      |
| `whiteboard`     | no    | pin things to (`E`), draw on                            | hung like a picture; `size` is `[width, height]`                                                                                                        |
| `stairs`         | no    | climb                                                   | see above                                                                                                                                               |
| `step`           | no    | walk down                                               | a pair of treads hanging off the edge of a deck. Decoration: the walk controller takes a 24 cm drop unaided                                             |

Everything marked solid is something you bump into, so keep furniture out of the
line you walk in on. (The default reading corner has a comment about exactly
this: a footstool in a doorway is the kind of thing you only find by walking
into it.)

---

## Roofs

Every room gets one without being asked, and only the **topmost** room over any
patch of ground gets one at all — so a loft inside the great room's volume, and a
reading corner with a bedroom on top of it, do not sprout roofs indoors. That is
worked out from the document rather than declared, because "is there a room above
me" is a fact about the file and not a decision anybody wants to restate every
time they move a wall.

The default is a 30° gable over the room's longer axis, or an 18° lean-to over
anything `"outdoor"`. Say otherwise with a `roof` block:

```json
"roof": { "kind": "gable", "pitch": 28, "overhang": 0.5, "fall": "south" }
```

| field      | means                                                                        |
| ---------- | ---------------------------------------------------------------------------- |
| `kind`     | `gable` (two slopes, a ridge), `shed` (one slope), `flat`, or `none`         |
| `pitch`    | degrees from horizontal. 0 is flat, 30 is a house, 45 is steep               |
| `overhang` | how far the eaves stand out past the walls, in metres                        |
| `fall`     | for a gable, the sides the **eaves** run along; for a shed, the **low** side |

`fall` is the one worth thinking about. `"south"` puts the eaves on the north and
south walls, which runs the ridge east to west — along the length of a building
that is wider than it is deep. And a lean-to must fall _away_ from what it leans
on: get the porch's backwards and you have a roof draining into the house.

Two things are handled for you. The plane is pinned to the **top of the walls** and
only rises from there, so a roof can never come down into a room's headroom or
through the ceiling below it. And a roof does not overhang into a building it
abuts — without that, the porch's shed roof reaches 45 cm through the cabin's
south wall and comes out over the great room.

An opening's _head_ is your problem, though. The great room's north window used to
reach 2.9 m up a wall the loft floor crosses at 2.28, so from the lake the view
window had a plank across it. It is invisible from inside, where the sill and the
head are both just wall, and there is a test that now refuses it.

---

## Light

Rooms are lit by the sun, by the sky, by a wash off each glazed window's
reveal — and by the lamps you put in them. A room that declares no lamp at all
gets one soft ceiling fixture so that a map you are halfway through writing is
not pitch dark while you write it.

Switching a lamp is `E` while looking at it, and which lamps are on is saved in
`.library/ambience.json`, keyed by furniture id. Delete that file and every light
goes back to whatever the document says. `"on": false` in the document is the
_initial_ state, not a lock.

Two things to watch:

- **A pendant hangs from its `y`.** Under a loft, that has to be below the loft
  floor, or the fitting is inside the floor above and lights the room upstairs.
- **Brightness is not a field.** A lamp's intensity is fixed per kind in the
  scene, and it is in candela, falling off with the square of distance — 7 cd at
  the 2 m from a pendant to the table under it arrives as under 2. If a room
  reads dim, the answer is another lamp, not a number to turn up.

---

## The Other Three Folders

A library folder holds more than books:

```text
My Library/
  books/       ← indexed for the shelves
  music/       ← one record per mp3/wav/flac/ogg/m4a
  artwork/     ← one picture per jpg/png/webp/gif
  video/       ← one tape per mp4/webm/m4v/mov/mkv/ogv
  .library/    ← everything the app owns
```

`music/` fills the record crates. Records are dealt into whatever `recordshelf`
pieces the world has, in folder order — there is no arranging to do, and adding
a file puts it on the shelf. Titles come from the file's tags where it has them
(ID3 for MP3, Vorbis comments for FLAC) and otherwise from the filename, with
the folder above it as the artist: `music/Nina Simone/Wild Is the Wind/04
Four Women.mp3` reads exactly as you would hope.

A record is also a **thing you can carry**. `E` takes one out of a crate, and
then `E` puts it on a deck, files it in any crate you like, or sets it down flat
on a table; `F` takes it back off the deck and `Q` sends it to wherever the
folder deals it. Only the records you have moved are written down — see
[library-folder.md](library-folder.md) — so a collection nobody has rearranged
costs nothing. There is one of each record: it is on whichever deck you carried
it to, and a deck with nothing on it stays quiet.

`artwork/` fills the picture frames. A frame with a `source` names its file; the
rest are dealt out of the folder in document order, so dropping images in is the
whole of the work.

`video/` fills the tape crates, dealt the same way the records are — folder order,
nothing to arrange, and the folder a file sits in becomes what is written under
the title on its label. Whether a tape actually plays is up to the WebView, which
decodes what Chromium decodes: roughly H.264 in MP4, VP8 or VP9 in WebM. A
container it cannot read is still a tape in the crate — it goes in the machine,
fails to start, and the panel says why, which is a better answer than pretending
the file is not there.

---

## Pinning Things Up

Any wall in the building takes a sheet of paper, and so does a `whiteboard`.

- **`P`** while reading tears out a copy of the page you are on. The book keeps
  its own — see [library-folder.md](library-folder.md#pages-and-notes) for what is
  actually stored.
- **`T`** writes a note.
- **`E`** aimed at a wall or a board pins whichever you are holding to it.
- **`E`** on something already up takes it down, back into your hand — so moving
  a page from a wall to the board is `E`, `E`.
- **`Q`** throws away the sheet in your hand.

Nothing about this needs anything in `library.json`: a wall is a wall. The
whiteboard in the default map's office is a good place to aim at, and the office
is the room the feature was built for, but a page pins just as happily over the
hearth.

## Drawing on a Whiteboard

Put a `marker` anywhere in the room — the default map leaves one on the office
desk. `E` picks it up, holding the left mouse button draws, `F` changes pen and
`G` wipes the board you are looking at. The line follows the crosshair, so you
write by moving your head.

Strokes are stored per board in fractions of its width and height, so resizing a
board in `library.json` keeps the drawing on it rather than scattering it.

---

## Starting Over

Delete `.library/library.json` and the app writes a fresh default the next time
it starts. Delete `.library/books.json` as well and your whole library goes back
into the boxes. Delete `.library/ambience.json` and every lamp comes back on.

None of the three take your books with them.
