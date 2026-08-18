# Building a Map

A library is a folder, and the _room_ is one file in it:
`<your library folder>/.library/library.json`. Edit it and the building reloads
while you are standing in it. Break it and nothing happens except an error in
the panel — the room you are in keeps running and your file is never written
over.

This is the long version; [the library folder](library-folder.md) is the short
one. The default document the app writes is a commented worked example, and
reading it top to bottom is the fastest way in.

---

## The Shape of the File

```jsonc
{
  // Both // and /* */ work. The file is meant to be read by a person.
  "name": "The Cabin",
  "spawn": { "room": "main", "at": [0, 1.0], "facing": 0 },
  "rooms": [/* … */]
}
```

Metres throughout, and the vertical axis is Y.

- A room's `origin` is its **centre**, in world metres.
- Everything _inside_ a room — shelves, furniture, spawn — is positioned
  relative to **that room's centre**, so moving a whole room moves its contents.
- `facing` is **degrees clockwise about Y**. For an object, `0` points its front
  at +Z (south); `90` east, `180` north, `270` west. For `spawn.facing` it is
  the direction the person is looking, so `0` is north — the two are opposite
  because an object's front faces you and yours faces away.

Nothing the app does is written back into this file. Where you shove the boxes,
which lamps you switch off and what you write on a shelf label all live in
`books.json` and `ambience.json` beside it.

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

Rooms are axis-aligned boxes. Walls are 0.12 m thick and drawn **outward** from
the floor area, so a room's `size` is the space you can walk in. The floor runs
out under them, which gives two rooms a wall-gap apart something to stand on in
the doorway between them.

**Joining two rooms:** place them `0.24` m apart — twice the wall thickness — so
their wall slabs sit flush, and put a matching door in each facing wall. The
arithmetic is written out in a comment in the default document.

**Butting two rooms together instead:** place them exactly touching and give the
second no wall on the shared side. That is what the porch does: its north edge
is the cabin's south edge, so the decking meets the floorboards with nothing to
step over, and the cabin's own south wall is what you walk through.

**A second building** is just rooms somewhere else: put a room a hundred metres
away and it is a separate building, with its own roof, light and bookcases. The
default document does this with the lake house above the south-west shore. Two
things to know before siting one:

- **the forest is grown around every room's footprint**, plus a few metres of
  clearing, so a building anywhere gets somewhere to stand;
- **the walk round the lake and the trail between the buildings are cleared
  ground**, and putting a room on one means walking through your own building to
  get past. Both live in `src/world/terrain.ts`, not in this file — a route
  between buildings is a fact about the valley rather than about either of them.

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

That last property is how you build a **railing**: a very wide window with a
metre-high sill and `"glazed": false` is a balustrade — you can see over it, you
cannot walk off it, and there is no glass in the way. The loft's open side and
all three sides of the porch are built this way.

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

Put the **bottom of the flight somewhere you can stand**: a flight whose bottom
step is a hand's width from a wall is a staircase nobody can get onto. Keep
doors off the wall the flight runs along, or the door opens into its side.

The measurement that has to be right is **where the flight reaches the top**
relative to the stairwell. The floor above exists only outside the hole, so the
hole must end exactly where the ramp reaches the upper floor — otherwise you
climb the stairs and find a 60 cm step you cannot take. Work it out from the
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
at either height — the ramp has run out and the boards have not started — so you
stop dead one pace short of the landing. Ending it earlier is harmless as long
as the ramp is within a step of the floor by then.

The walk controller allows a move only if the floor you step onto is within
0.42 m of the floor you are on. That is both how a staircase works and why you
cannot walk off the loft.

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

`label` is an optional _starting_ label for the card on its top edge. The
default map uses it nowhere: a bookcase arrives bare and you write on it with
`L`. An in-app label overrides whatever is written here — the app's labels live
in `books.json`, so a hand edit and an in-app edit never fight over one file.

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

| kind             | solid | you can                                                 | notes                                                                                                                                                                                                                                             |
| ---------------- | ----- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `armchair`       | yes   | sit (`E`)                                               |                                                                                                                                                                                                                                                   |
| `sofa`           | yes   | sit                                                     | `size` sets its length                                                                                                                                                                                                                            |
| `diningchair`    | yes   | sit                                                     |                                                                                                                                                                                                                                                   |
| `bench`          | yes   | sit                                                     | a porch bench; sitting wins over setting things down                                                                                                                                                                                              |
| `footstool`      | yes   | put books on                                            | for feet                                                                                                                                                                                                                                          |
| `sidetable`      | yes   | put books on                                            |                                                                                                                                                                                                                                                   |
| `table`          | yes   | put books on                                            | `size` and `height` both worth setting                                                                                                                                                                                                            |
| `desk`           | yes   | put books on                                            | deeper and a little higher than a table                                                                                                                                                                                                           |
| `bed`            | yes   | sit, put books on                                       | headboard is its back; `facing` points the foot into the room                                                                                                                                                                                     |
| `foldingchair`   | yes   | sit, carry (`X`)                                        | a folding chair. `X` takes it with you, `X` again stands it wherever you are; where you left it lives in `books.json`, so this line is only its home                                                                                              |
| `foldingtable`   | yes   | put books on, carry (`X`)                               | the same, with a top on it. `size` and `height` both work                                                                                                                                                                                         |
| `kitchencounter` | yes   | put books on                                            | comes with a sink                                                                                                                                                                                                                                 |
| `recordshelf`    | yes   | put books on, file records in                           | fills with records from `music/`                                                                                                                                                                                                                  |
| `tapecrate`      | yes   | put books on                                            | fills with tapes from `video/`; low, so the labels stand proud                                                                                                                                                                                    |
| `bathtub`        | yes   | put books on                                            | its rim is a surface                                                                                                                                                                                                                              |
| `toilet`         | yes   | —                                                       | `facing` points the seat into the room                                                                                                                                                                                                            |
| `basin`          | yes   | put books on                                            | on a pedestal                                                                                                                                                                                                                                     |
| `box`            | yes   | fill, carry (`X`), break down (`Backspace`, empty only) | a moving box; books with no shelf pile up in it                                                                                                                                                                                                   |
| `boxstack`       | yes   | take a box (`E`)                                        | flattened spares. `E` puts one in your arms; `X` stands it up as a real box, remembered in `books.json`                                                                                                                                           |
| `recordplayer`   | no    | play (`E`)                                              | put it on a `y` so it stands on something. An empty one does nothing: bring it a record                                                                                                                                                           |
| `crt`            | yes   | play a tape (`E`)                                       | a television. `E` with a tape in hand puts it in; `E` empty-handed pauses                                                                                                                                                                         |
| `coffeemaker`    | no    | brew, then take the coffee (`E`)                        | ditto. `E` puts a brew on; when the pot is full, `E` hands you its one cup, coffee in it — drinking it (`F`) makes you quicker for a while                                                                                                        |
| `phone`          | no    | order a delivery (`E`)                                  | a telephone. `E` asks what you want — a takeaway, or an arXiv paper by id, which is downloaded into `books/arxiv/` and indexed. Either is carried out of the trees by a courier and left at the foot of the nearest `step` (the spawn, with none) |
| `fridge`         | yes   | take a cold can (`E`)                                   | never runs out, the way the box stack never runs out of cardboard. Drink the can with `F`; the empty goes in the `bin`                                                                                                                            |
| `bin`            | yes   | throw empties in (`E`)                                  | takes cans and takeaway boxes, full or not. It refuses the coffee cup — the crockery lives by its machine                                                                                                                                         |
| `headlamp`       | no    | wear it (`E`)                                           | a headlamp, lying where `y` puts it — the porch table, by default. Worn, not held: hands free, beam follows your eyes; a bare tabletop takes it off                                                                                               |
| `door`           | shut  | open and close (`E`)                                    | a hinged leaf for a doorway. Whether it stands open is remembered in `ambience.json`, and a closed one really blocks the doorway                                                                                                                  |
| `tent`           | yes   | —                                                       | an A-frame shelter, open at both ends. `size` is [width, depth]                                                                                                                                                                                   |
| `campfire`       | yes   | light it (`E`)                                          | a fire in a ring of stones. A lamp to the machinery — lit at the fire itself — but the light switch indoors leaves it alone                                                                                                                       |
| `arcade`         | yes   | slot a cartridge, play (`E`)                            | a CHIP-8 cabinet. `E` with a cartridge slots and boots it; `E` at a running one steps up to the controls, `Esc` steps away, `F` ejects                                                                                                            |
| `rombox`         | yes   | take a cartridge (`E`)                                  | the crate the games live in, filled from `roms/`. `E` takes a cartridge; `E` again over the box swaps it for the next                                                                                                                             |
| `computer`       | no    | search (`E`)                                            | the catalogue terminal. Searches every book, record, tape and picture the library knows about and says where each one is. Stand it on a desk with a `y`                                                                                           |
| `postits`        | no    | take one (`E`)                                          | a pad of notes. `E` peels one off and opens the field you write on it — the same note `T` writes                                                                                                                                                  |
| `marker`         | no    | take it (`E`)                                           | a whiteboard marker. With it in hand, hold the left mouse button to draw on any `whiteboard`; `F` changes pen, `G` wipes the board                                                                                                                |
| `fireplace`      | yes   | switch (`E`)                                            | lights the room it is in                                                                                                                                                                                                                          |
| `floorlamp`      | yes   | switch (`E`)                                            |                                                                                                                                                                                                                                                   |
| `pendant`        | no    | switch (`E`)                                            | hangs from `y`; do not hang one under a loft floor                                                                                                                                                                                                |
| `fairylights`    | no    | switch (`E`)                                            | a string of bulbs. `size` is `[length, sag]` and `y` is the line it hangs from                                                                                                                                                                    |
| `lightswitch`    | no    | switch everything (`E`)                                 | one press works every light in the library. Hung like a picture                                                                                                                                                                                   |
| `plant`          | yes   | —                                                       | `height` varies it                                                                                                                                                                                                                                |
| `rug`            | no    | —                                                       | `size` sets its footprint                                                                                                                                                                                                                         |
| `picture`        | no    | —                                                       | takes an image from `artwork/`                                                                                                                                                                                                                    |
| `clock`          | no    | —                                                       | tells this machine's time. Hung like a picture; `size` is the dial                                                                                                                                                                                |
| `whiteboard`     | no    | pin things to (`E`), draw on                            | hung like a picture; `size` is `[width, height]`                                                                                                                                                                                                  |
| `stairs`         | no    | climb                                                   | see above                                                                                                                                                                                                                                         |
| `step`           | no    | walk down                                               | a pair of treads hanging off the edge of a deck. Decoration: the walk controller takes a 24 cm drop unaided                                                                                                                                       |

Everything marked solid is something you bump into, so keep furniture out of the
line you walk in on — a footstool in a doorway is the kind of thing you only
find by walking into it.

---

## Roofs

Every room gets one without being asked, and only the **topmost** room over any
patch of ground gets one at all — so a loft inside the great room's volume does
not sprout a roof indoors. That is derived from the document rather than
declared: "is there a room above me" is a fact about the file, not a decision to
restate every time a wall moves.

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

`fall` is the one worth thinking about. `"south"` puts the eaves on the north
and south walls, running the ridge east to west — along the length of a building
wider than it is deep. A lean-to must fall _away_ from what it leans on: get the
porch's backwards and the roof drains into the house.

Two things are handled for you. The plane is pinned to the **top of the walls**
and only rises from there, so a roof can never come down into a room's headroom
or through the ceiling below. And a roof does not overhang into a building it
abuts — without that, the porch's shed roof reaches 45 cm through the cabin's
south wall.

An opening's _head_ is your problem. A window reaching higher than a floor slab
above it puts a plank across the view from outside while looking like plain wall
from inside; a test refuses it.

---

## Light

Rooms are lit by the sun, the sky, a wash off each glazed window's reveal, and
the lamps you put in them. A room that declares no lamp gets one soft ceiling
fixture, so a half-written map is not pitch dark while you write it.

Switching a lamp is `E` while looking at it, and which lamps are on is saved in
`.library/ambience.json`, keyed by furniture id. Delete that file and every light
goes back to whatever the document says. `"on": false` in the document is the
_initial_ state, not a lock.

Two things to watch:

- **A pendant hangs from its `y`.** Under a loft, that has to be below the loft
  floor, or the fitting is inside the floor above and lights the room upstairs.
- **Brightness is not a field.** A lamp's intensity is fixed per kind in the
  scene, in candela, falling off with the square of distance — 7 cd over the 2 m
  from a pendant to the table under it arrives as under 2. If a room reads dim,
  add another lamp.

---

## The Other Four Folders

A library folder holds more than books:

```text
My Library/
  books/       ← indexed for the shelves
  music/       ← one record per mp3/wav/flac/ogg/m4a
  artwork/     ← one picture per jpg/png/webp/gif
  video/       ← one tape per mp4/webm/m4v/mov/mkv/ogv
  roms/        ← one cartridge per ch8
  .library/    ← everything the app owns
```

`music/` fills the record crates. Records are dealt into whatever `recordshelf`
pieces the world has, in folder order — there is no arranging to do, and adding
a file puts it on the shelf. Titles come from the file's tags where it has them
(ID3 for MP3, Vorbis comments for FLAC) and otherwise from the filename, with
the folder above it as the artist: `music/Nina Simone/Wild Is the Wind/04
Four Women.mp3` reads exactly as you would hope.

A record is also a **thing you can carry**. `E` takes one out of a crate; `E`
then puts it on a deck, files it in any crate, or sets it down on a table. `F`
takes it back off the deck and `Q` returns it to wherever the folder deals it.
Only records you have moved are written down (see
[library-folder.md](library-folder.md)), so an unrearranged collection costs
nothing. There is one of each record, and an empty deck stays quiet.

`artwork/` fills the picture frames. A frame with a `source` names its file; the
rest are dealt out of the folder in document order, so dropping images in is the
whole of the work.

`video/` fills the tape crates, dealt like the records — folder order, and the
folder a file sits in is written under the title on its label. Whether a tape
plays is up to the WebView, which decodes what Chromium decodes: roughly H.264
in MP4, VP8 or VP9 in WebM. A container it cannot read is still a tape in the
crate; it goes in the machine, fails to start, and the panel says why.

`roms/` fills the `rombox` beside the `arcade` cabinet. Only `.ch8` files count
— CHIP-8 images, which is what the cabinet's emulator implements — and a ROM's
filename is its title, since a CHIP-8 image has no header to ask. The demo
library ships a Pong in `roms/ch8/`, assembled by
`scripts/lib/make-chip8.mjs`.

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

None of this needs anything in `library.json`: a wall is a wall. The default
map's office has a whiteboard, but a page pins just as happily over the hearth.

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
