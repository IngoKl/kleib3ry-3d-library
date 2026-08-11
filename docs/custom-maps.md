# Building a map

A library is a folder, and the *room* is one file in it:
`<your library folder>/.library/library.json`. Edit it and the building reloads
while you are standing in it. Break it and nothing happens except an error in
the panel — the room you are in keeps running and your file is never written
over.

This is the long version. [The library folder](library-folder.md) is the short
one, and the default document the app writes for you is the worked example: it
is commented throughout, and reading it top to bottom is the fastest way in.

---

## The shape of the file

```jsonc
{
  // Both // and /* */ work. The file is meant to be read by a person.
  "schemaVersion": 2,
  "name": "The Cabin",
  "spawn": { "room": "main", "at": [0, 1.0], "facing": 0 },
  "rooms": [ /* … */ ]
}
```

Metres throughout, and the vertical axis is Y.

- A room's `origin` is its **centre**, in world metres.
- Everything *inside* a room — shelves, furniture, spawn — is positioned
  relative to **that room's centre**, so moving a whole room moves its contents.
- `facing` is **degrees clockwise about Y**. For a thing, `0` points its front
  at +Z (south); `90` points east, `180` north, `270` west. For a *person* —
  `spawn.facing` — it is the direction they are looking, and `0` is north. The
  two are opposite because a bookcase's front faces you and your front faces
  away; it is easier to remember than to justify.

Nothing the app does is ever written back into this file. Where you shove the
boxes, which lamps you switch off, what you write on a shelf label: all of that
lives in `books.json` and `lights.json` beside it, so your comments and your
formatting are yours.

---

## Rooms

```jsonc
{
  "id": "main",              // required, unique, no colons
  "name": "Great room",      // optional, defaults to the id
  "origin": [0, 0],          // centre, in world metres
  "size": [9, 7],            // width along X, depth along Z
  "height": 4.8,             // floor to ceiling
  "elevation": 0,            // height of this room's floor. A loft has one.
  "walls": ["north", "south", "east", "west"],   // which walls to build
  "ceiling": true,
  "floor": "boards",         // boards | deck | stone
  "outdoor": false,          // a porch: decking, no skirting, no room light
  "holes": [],               // rectangles missing from the floor
  "openings": [ /* … */ ],
  "shelves": [ /* … */ ],
  "furniture": [ /* … */ ]
}
```

Rooms are axis-aligned boxes. Walls are 0.12 m thick and are drawn **outward**
from the floor area, so a room's `size` is the space you can actually walk in.

**Joining two rooms:** place them `0.24` m apart — twice the wall thickness — so
their wall slabs sit flush, and put a matching door in each of the facing walls.
The arithmetic is written out in a comment in the default document.

**Butting two rooms together instead:** place them exactly touching and give the
second one no wall on the shared side. That is what the porch does: its north
edge is the cabin's south edge, so the decking meets the floorboards with
nothing to step over, and the cabin's own south wall is what you walk through.

### Openings

```jsonc
{ "wall": "north", "at": 0, "width": 4.4, "height": 2.1, "sill": 0.8, "kind": "window" }
{ "wall": "east",  "at": 1.4, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" }
{ "wall": "south", "at": 0, "width": 8.6, "height": 1.4, "sill": 1.0,
  "kind": "window", "glazed": false }
```

| field | meaning |
| --- | --- |
| `wall` | `north` (−Z), `south` (+Z), `east` (+X), `west` (−X) |
| `at` | centre of the opening, measured from the **middle** of that wall |
| `width`, `height` | the hole |
| `sill` | height of its bottom edge above **this room's floor** |
| `kind` | `door` or `window` |
| `glazed` | whether a pane is fitted. Defaults to true for a window. |

A `door` at floor level is walkable. A `window` is not — its apron is a wall you
bump into, which is what you want when the sill is at 0.9 m.

That last property is load-bearing and worth understanding, because **the apron
under an unglazed window is how you build a railing**. A very wide "window" with
a metre-high sill and `"glazed": false` is a balustrade: you can see the whole
room over it, you cannot walk off it, and there is no glass in the way. The
loft's open side and all three sides of the porch are built this way.

---

## Two floors

A loft is a room with an `elevation`, standing **inside** another room's volume
rather than on top of it. Four things make that work, and all four are in the
default document:

```jsonc
{
  "id": "loft",
  "origin": [0, -1.15],
  "size": [9, 4.7],
  "elevation": 2.4,          // 1. its floor is 2.4 m up
  "height": 2.4,             // …and its head height is the cabin's ceiling
  "walls": ["south"],        // 2. only the balustrade. The other three walls
                             //    are the cabin's, which run the full 4.8 m.
  "ceiling": false,          // 3. its ceiling is the cabin's
  "holes": [{ "at": [4.0, -0.75], "size": [1.35, 3.5] }]   // 4. the stairwell
}
```

1. **`elevation`** raises the floor, and everything in the room with it: shelves
   stand on it, boxes sit on it, books dropped on it land on it.
2. **`walls`** stops you building a second wall in the same place as the room
   below's. Rooms on different levels are allowed to overlap in plan; rooms on
   the *same* level should not.
3. **`ceiling: false`** where the room below already has one at the same height.
4. **`holes`** cuts rectangles out of the floor, in room-local metres. Without
   one, the staircase arrives underneath a floor.

### Stairs

```jsonc
{ "id": "stairs", "kind": "stairs", "at": [4.0, -1.85],
  "facing": 0, "size": [0.95, 3.3], "rise": 2.4 }
```

A flight climbs **towards its facing direction**. `size` is `[width, run]` and
`rise` is how far up it gets. Underfoot it is a smooth ramp; what you see is
treads.

The one measurement that has to be right is **where the flight reaches the top**
relative to the stairwell. The floor above only exists outside the hole, so the
hole must end exactly where the ramp reaches the upper floor — otherwise you
walk up the stairs and find a 60 cm step you cannot climb. Work it out from the
run:

```text
flight at z = -1.85, run 3.3, facing 0 (climbing +Z)
  → bottom at z = -3.50 (floor level)
  → top    at z = -0.20 (2.4 m up)
stairwell hole must therefore end at z = -0.20 or a whisker beyond
  → hole centre z = -1.90, length 3.5   (world)
  → local to a room at origin z = -1.15:  "at": [4.0, -0.75]
```

If you get it wrong you will know immediately: you will climb the stairs and
stop dead at the top. The rule the walk controller applies is that a move is
only allowed if the floor you are stepping onto is within 0.42 m of the floor
you are on — which is also what stops you walking off the loft.

---

## Shelves

```jsonc
{ "id": "west-0", "at": [-4.325, -2.9], "facing": 90, "rows": 5, "label": "Fiction" }
```

`rows` is how many compartments the case has; the compartments divide the same
carcass, so **fewer rows means taller shelves**. `at` is where the case stands,
relative to the room centre. To stand one flush against a wall, offset it from
the wall by half the case's depth plus a little: `0.175`.

A case is 1.0 m wide and 0.32 m deep, so cases stand 1.05 m apart in a run.

`label` is a *starting* label for the card on its top edge. You can relabel a
case in the app with `L`, and that overrides what is written here — the app's
labels live in `books.json` so that a hand edit and an in-app edit never fight
over the same file.

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

Common fields: `id`, `kind`, `at`, `facing`. Then:

| field | meaning |
| --- | --- |
| `size` | footprint `[width, depth]` — or for a picture, `[width, height]` |
| `height` | height override, for the kinds where it is worth varying |
| `y` | how far off this room's floor the piece sits. A coffee maker on a counter is `"y": 0.92`. For a **picture** it is the centre of the frame; for a **pendant** it is where the fitting is. |
| `source` | which file in `artwork/` a picture shows |
| `rise` | how far a flight of stairs climbs |
| `on` | whether a lamp starts lit |

### The kinds

| kind | solid | you can | notes |
| --- | --- | --- | --- |
| `armchair` | yes | sit (`E`) | |
| `sofa` | yes | sit | `size` sets its length |
| `diningchair` | yes | sit | |
| `bench` | yes | sit | a porch bench; sitting wins over setting things down |
| `footstool` | yes | put books on | for feet |
| `sidetable` | yes | put books on | |
| `table` | yes | put books on | `size` and `height` both worth setting |
| `kitchencounter` | yes | put books on | comes with a sink |
| `recordshelf` | yes | put books on | fills with records from `music/` |
| `box` | yes | fill, carry (`X`) | a moving box; books with no shelf pile up in it |
| `recordplayer` | no | play (`E`) | put it on a `y` so it stands on something |
| `coffeemaker` | no | brew (`E`) | ditto |
| `fireplace` | yes | switch (`E`) | lights the room it is in |
| `floorlamp` | yes | switch (`E`) | |
| `pendant` | no | switch (`E`) | hangs from `y`; do not hang one under a loft floor |
| `plant` | yes | — | `height` varies it |
| `rug` | no | — | `size` sets its footprint |
| `picture` | no | — | takes an image from `artwork/` |
| `stairs` | no | climb | see above |

Everything marked solid is something you bump into, so keep furniture out of the
line you walk in on. (The default reading corner has a comment about exactly
this: a footstool in a doorway is the kind of thing you only find by walking
into it.)

---

## Light

Rooms are lit by the sun, by the sky, by a wash off each glazed window's
reveal — and by the lamps you put in them. A room that declares no lamp at all
gets one soft ceiling fixture so that a map you are halfway through writing is
not pitch dark while you write it.

Switching a lamp is `E` while looking at it, and which lamps are on is saved in
`.library/lights.json`, keyed by furniture id. Delete that file and every light
goes back to whatever the document says. `"on": false` in the document is the
*initial* state, not a lock.

Two things to watch:

- **A pendant hangs from its `y`.** Under a loft, that has to be below the loft
  floor, or the fitting is inside the floor above and lights the room upstairs.
- **A `distance` of nothing.** Lamp intensity is in candela and falls off with
  the square of distance, so the numbers in the scene are larger than they look:
  at the 2 m from a pendant to the table under it, 7 cd arrives as under 2.

---

## The other two folders

A library folder holds more than books:

```text
My Library/
  books/       ← indexed for the shelves
  music/       ← one record per mp3/wav/flac/ogg/m4a
  artwork/     ← one picture per jpg/png/webp/gif
  .library/    ← everything the app owns
```

`music/` fills the record crates. Records are dealt into whatever `recordshelf`
pieces the world has, in folder order — there is no arranging to do, and adding
a file puts it on the shelf. Titles come from the file's tags where it has them
(ID3 for MP3, Vorbis comments for FLAC) and otherwise from the filename, with
the folder above it as the artist: `music/Nina Simone/Wild Is the Wind/04
Four Women.mp3` reads exactly as you would hope.

`artwork/` fills the picture frames. A frame with a `source` names its file; the
rest are dealt out of the folder in document order, so dropping images in is the
whole of the work.

---

## Starting over

Delete `.library/library.json` and the app writes a fresh default the next time
it starts. Delete `.library/books.json` as well and your whole library goes back
into the boxes. Delete `.library/lights.json` and every lamp comes back on.

None of the three take your books with them.
