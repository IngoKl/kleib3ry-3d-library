/**
 * The world written into a library folder the first time it is opened.
 *
 * It is kept as *text*, not as an object, because this file is the thing you
 * will edit: the comments are the documentation, and generating them from a
 * structure would mean maintaining the prose somewhere it cannot be read next
 * to what it describes.
 *
 * Positions inside a room are relative to that room's centre, in metres.
 * `facing` is degrees clockwise about Y, where 0 means the front points towards
 * +Z (south). Rooms are placed 0.24 m apart — twice the wall thickness — so
 * their walls sit flush and a door in each makes one short doorway. The porch
 * is the exception: it is placed flush against the cabin so the decking and the
 * floorboards meet with nothing to step over.
 */
export const DEFAULT_WORLD_TEXT = `{
  // A cabin in the woods, with a lake through the north window — and a way out
  // of the porch, down onto the grass, round the water, and along the trail to
  // the little house at the far end of it.
  //
  // Edit this file and the room reloads as you save it. If an edit is wrong the
  // room you are standing in keeps running and the problem is reported in the
  // panel, so you cannot break your library by mistyping in here. Nothing the
  // app does is ever written back over this file — where you shove the boxes,
  // which lamps you switch off, what you write on a shelf label, all of that
  // lives in books.json and ambience.json beside it.
  //
  // Nothing here carries a "label". A bookcase is bare until you write on it
  // with L, which is the point: the labels are yours, and a room that arrives
  // pre-sorted into somebody else's categories is a room you have to undo.
  //
  // A full guide to building your own is in docs/custom-maps.md.
  "schemaVersion": 2,
  "name": "The Cabin",

  // Standing in the great room, looking north at the lake. Note that "facing"
  // for a *person* is the way they are looking, so 0 is north (-Z) — the
  // opposite of a bookcase, whose 0 is the way its open front points.
  "spawn": { "room": "main", "at": [0, 1.0], "facing": 0 },

  "rooms": [
    {
      "id": "main",
      "name": "Great room",
      // Centre of the room in world metres, then width (X) by depth (Z).
      "origin": [0, 0],
      "size": [10, 8],
      // A cathedral ceiling, because the loft lives inside this volume rather
      // than on top of it: the loft floor is at 2.4 and its head height is the
      // same ceiling you see from down here.
      "height": 4.8,

      // The roof. Only the *topmost* room over a patch of ground is roofed, so
      // this one covers the loft inside it as well and the loft needs no roof
      // of its own — which is worked out from the document rather than declared.
      //
      // "fall" names the sides the eaves run along, so "south" puts them on the
      // north and south walls and runs the ridge east to west, along the length
      // of the building. Every other room in this file leaves the roof out
      // entirely and gets a 30-degree gable over the longer axis, which is what
      // you want nine times out of ten.
      "roof": { "kind": "gable", "pitch": 28, "overhang": 0.5, "fall": "south" },

      "openings": [
        // "at" is measured from the middle of that wall. The big one faces the
        // lake; it is wide and low so it reads as a view rather than as a window.
        //
        // Its *top* is the number that matters. The loft floor reaches this wall,
        // and its slab hangs from 2.28 to 2.5 — so an opening any taller than
        // 1.48 above this sill has the floor of the room above crossing it, which
        // from outside is a window with a plank through it. 1.38 leaves a hand's
        // width of plaster between the head of the window and the boards.
        { "wall": "north", "at": 0, "width": 4.6, "height": 1.38, "sill": 0.8, "kind": "window" },
        // The third window. It has been on the west wall (the reading corner is
        // built against that one) and on the east wall (the bathroom is now
        // built against that one); both times it looked at 24 cm of air and
        // then a neighbour's blank plaster. The north wall is the one side of
        // this room nothing will ever abut, so here it stays. Its head clears
        // the loft floor for the same reason the big one's does: the slab hangs
        // from 2.28, and 0.85 + 1.35 stops at 2.2.
        { "wall": "north", "at": 4.2, "width": 1.2, "height": 1.35, "sill": 0.85, "kind": "window" },
        // The loft's window, in this room's wall because the loft stands inside
        // this room's volume and builds no north wall of its own. Its sill is
        // above the loft floor at 2.5, so from down here it is out of sight
        // behind the boards and from up there it is a window by the sofa.
        //
        // It has to *tile* with the two below it rather than overlap them: two
        // openings that share a stretch of wall cut each other's panels to
        // ribbons, whatever their heights. The big one ends at x = 2.3 and the
        // small one starts at 3.6, so this one has the pier between them.
        { "wall": "north", "at": 2.95, "width": 1.1, "height": 1.25, "sill": 3.05, "kind": "window" },
        { "wall": "south", "at": 0.3, "width": 1.6, "height": 1.4, "sill": 0.95, "kind": "window" },
        // Doors need a matching door in the next room's facing wall. The east
        // door sits towards the south end of its wall because the staircase
        // owns the north end, and the bathroom is built against the north half
        // of it — a door opening into the side of a flight is a door you cannot
        // use.
        { "wall": "west", "at": 0.9, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" },
        { "wall": "east", "at": 2.1, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" },
        { "wall": "south", "at": 2.6, "width": 1.3, "height": 2.1, "sill": 0, "kind": "door" }
      ],

      // Bookcases. The "id" is what your book layout is keyed by: move a shelf
      // and its books move with it, but rename or delete one and its books are
      // packed into the boxes on the floor rather than being reshuffled.
      //
      // A case is 1.0 m wide; these stand 1.2 m apart, so a run of them reads
      // as furniture standing along a wall rather than as built-in shelving
      // crammed edge to edge.
      "shelves": [
        { "id": "west-0", "at": [-4.825, -3.2], "facing": 90, "rows": 5 },
        { "id": "west-1", "at": [-4.825, -2.0], "facing": 90, "rows": 5 },
        { "id": "west-2", "at": [-4.825, -0.8], "facing": 90, "rows": 5 },

        { "id": "north-0", "at": [2.9, -3.825], "facing": 0, "rows": 5 },

        { "id": "east-0", "at": [4.825, 3.4], "facing": 270, "rows": 5 },

        { "id": "south-0", "at": [-4.0, 3.825], "facing": 180, "rows": 6 },
        { "id": "south-1", "at": [-2.8, 3.825], "facing": 180, "rows": 5 },
        { "id": "south-2", "at": [-1.6, 3.825], "facing": 180, "rows": 5 }
      ],

      "furniture": [
        // The hearth end of the room. The sofa keeps a fireside rug's width of
        // floor between itself and the hearth — close enough to warm your
        // feet, far enough that nothing reads as pushed against the fire.
        // The seating is an island in the middle of the hearth end, not a
        // lining of the walls: the sofa's west end stops at x = -3.26, which
        // leaves an open corridor along the whole west shelf run — room to
        // stand at a case and browse, not sidle past upholstery. The lamp
        // stands on the seating's east side, out of every shelf lane.
        { "id": "hearth", "kind": "fireplace", "at": [-3.4, -3.75], "facing": 0 },
        { "id": "hearth-rug", "kind": "rug", "at": [-2.3, -1.7], "facing": 0, "size": [3.0, 2.6] },
        { "id": "sofa", "kind": "sofa", "at": [-2.3, -1.15], "facing": 180 },
        { "id": "reading-chair", "kind": "armchair", "at": [-0.85, -2.35], "facing": 250 },
        { "id": "hearth-table", "kind": "sidetable", "at": [-0.85, -1.3], "facing": 0 },
        { "id": "hearth-lamp", "kind": "floorlamp", "at": [-0.15, -3.05], "facing": 0 },

        // Records live under the window, with the deck on top of the crate.
        { "id": "records", "kind": "recordshelf", "at": [1.6, -3.8], "facing": 0 },
        { "id": "deck", "kind": "recordplayer", "at": [1.6, -3.73], "facing": 0, "y": 0.78 },

        // A picture over the hearth. With no "source" it takes whatever is next
        // in your artwork/ folder, so dropping images in is enough. It is sized
        // to the band of wall it has — above the mantel (1.57) and below the
        // underside of the loft floor (2.28) — *including the frame*, which adds
        // 4.5 cm on every side beyond "size".
        { "id": "picture-1", "kind": "picture", "at": [-3.4, -3.96], "facing": 0, "y": 1.96, "size": [0.78, 0.42] },

        { "id": "fern", "kind": "plant", "at": [4.4, -3.5], "facing": 0 },
        { "id": "palm", "kind": "plant", "at": [-4.5, 2.0], "facing": 0, "height": 1.35 },

        // The clock, telling this machine's own time. It hangs on the last
        // 90 cm of north wall west of the chimney breast — the mantel and its
        // picture own everything from x = -4.08 eastwards — and, like the
        // picture, its top has to stay under the loft floor at 2.28. Like a
        // picture, "y" is the centre of its face and "size" is the dial.
        { "id": "clock", "kind": "clock", "at": [-4.55, -3.96], "facing": 0, "y": 1.95, "size": [0.34, 0.34] },

        // Ceiling lights. "on": false starts one dark; switching a light in the
        // app is remembered in .library/ambience.json, not written back here.
        //
        // The two tall ones hang in the open half of the room, south of where
        // the loft floor ends at z = 1.4 — a pendant on a long flex under a
        // loft is a pendant inside the floor above it. The low one lights the
        // hearth end, where the ceiling is the loft.
        // The switch by the porch door: one press works every light in the
        // library, not just this room's. Hung like a picture, so "y" is the
        // middle of the plate. There is a second one in the bedroom.
        { "id": "main-switch", "kind": "lightswitch", "at": [3.6, 3.97], "facing": 180, "y": 1.15 },

        { "id": "main-pendant-w", "kind": "pendant", "at": [-2.6, 2.6], "facing": 0, "y": 2.9 },
        { "id": "main-pendant-e", "kind": "pendant", "at": [2.6, 2.6], "facing": 0, "y": 2.9 },
        { "id": "hearth-pendant", "kind": "pendant", "at": [-1.5, -1.5], "facing": 0, "y": 1.95 },

        // Up to the loft. A flight climbs towards its facing direction, "size"
        // is [width, run], and "rise" is how far up it gets.
        //
        // It runs along the east wall and is *entered from the middle of the
        // room*: the bottom step is at z = 1.3, in the open floor by the
        // seating, and you climb north. The number that has to be right is
        // where the run ends — this one tops out at z = -2.1, and the loft's
        // stairwell hole ends at exactly the same z, so the last tread and the
        // first floorboard are the same height and you walk off one onto the
        // other. End the hole any later and there is a strip of nothing at the
        // top of the stairs.
        { "id": "stairs", "kind": "stairs", "at": [4.4, -0.4], "facing": 180, "size": [1.05, 3.4], "rise": 2.5 },

        // The front door, hung in the south doorway to the porch. E swings it;
        // whether it stands open is remembered in ambience.json with the
        // lamps, and a closed one really does block the doorway.
        { "id": "front-door", "kind": "door", "at": [2.6, 4.06], "facing": 180, "size": [1.24, 0.08], "height": 2.03, "on": true },

        // Books with nowhere to go end up in these. Add more if you run out.
        { "id": "box-1", "kind": "box", "at": [-1.0, 2.5], "facing": 8 },
        { "id": "box-2", "kind": "box", "at": [-0.3, 2.65], "facing": -6 },
        { "id": "box-3", "kind": "box", "at": [0.45, 2.45], "facing": 3 },
        { "id": "box-4", "kind": "box", "at": [-0.7, 1.9], "facing": -12 }
      ]
    },

    {
      "id": "loft",
      "name": "The loft",
      // Standing inside the great room's volume rather than on top of it: same
      // origin, an elevation, and no ceiling of its own. "walls" lists only the
      // walls this room builds — the other three are the cabin's, which run the
      // full 4.8 m, so building them again would be two walls in one place.
      "origin": [0, -1.3],
      "size": [10, 5.4],
      // 2.5 rather than a rounder 2.4, because a bookcase is 2.24 m tall and
      // the loft floor is 0.22 m thick: any lower and the cases downstairs
      // stand up into the boards.
      "elevation": 2.5,
      "height": 2.3,
      "walls": ["south"],
      "ceiling": false,

      // The stairwell. Its far edge is at world z = -2.1, which is exactly
      // where the flight reaches 2.5 — so you walk off the top step onto the
      // boards without a step to climb, and without a gap to fall down.
      "holes": [{ "at": [4.4, 0.675], "size": [1.45, 2.95] }],

      "openings": [
        // The balustrade: a very wide window with a waist-high sill and no
        // glass in it. You can see the whole room over it and you cannot walk
        // off it — "glazed": false is what tells the difference between a
        // window and a hole with a railing under it.
        { "wall": "south", "at": 0, "width": 9.6, "height": 1.3, "sill": 1.0, "kind": "window", "glazed": false }
      ],

      "shelves": [
        { "id": "loft-0", "at": [-3.6, -2.525], "facing": 0, "rows": 5 },
        { "id": "loft-1", "at": [-2.4, -2.525], "facing": 0, "rows": 5 },
        { "id": "loft-2", "at": [-1.2, -2.525], "facing": 0, "rows": 5 },
        { "id": "loft-3", "at": [-4.825, 0.0], "facing": 90, "rows": 4 }
      ],

      "furniture": [
        { "id": "loft-rug", "kind": "rug", "at": [-1.0, 0.6], "facing": 0, "size": [3.0, 2.2] },
        { "id": "loft-chair", "kind": "armchair", "at": [-1.7, 0.8], "facing": 20 },
        { "id": "loft-stool", "kind": "footstool", "at": [-1.7, -0.05], "facing": 20 },
        { "id": "loft-table", "kind": "sidetable", "at": [-0.6, 0.95], "facing": 0 },
        // The couch, east of the chair and turned to the same television, with
        // the side table between the two. A sofa is 1.86 wide, so at x = 0.75 it
        // runs to 1.68 — clear of the stairwell hole, which starts at 3.675.
        { "id": "loft-sofa", "kind": "sofa", "at": [0.75, 0.75], "facing": 5 },
        { "id": "loft-lamp", "kind": "floorlamp", "at": [-2.7, 1.0], "facing": 0 },
        { "id": "loft-plant", "kind": "plant", "at": [0.5, -2.3], "facing": 0, "height": 0.8 },
        { "id": "picture-2", "kind": "picture", "at": [-4.94, 1.6], "facing": 90, "y": 1.5, "size": [0.7, 0.9] },

        // The television, in front of the armchair and turned back towards it,
        // with the tapes in a crate beside it. Press E on the set to play the
        // tape in your hands, or to stop the one that is running; E on a tape
        // takes it out of the crate, and Q files it back. The crate fills itself
        // from your video/ folder in folder order, the way the record crates
        // fill themselves from music/ — so there is nothing to arrange.
        { "id": "telly", "kind": "crt", "at": [-1.6, 2.15], "facing": 195 },
        { "id": "tapes", "kind": "tapecrate", "at": [-0.8, 2.25], "facing": 195 },

        // The games corner, up here in the north-east nook past the stairwell:
        // the cabinet against the east wall facing west into the loft, the
        // crate of cartridges round the corner on the north wall. The cabinet
        // plays whatever is in roms/. The stairwell hole ends at local z -0.8,
        // so everything here stands on solid boards.
        { "id": "arcade", "kind": "arcade", "at": [4.61, -1.9], "facing": 270 },
        { "id": "roms", "kind": "rombox", "at": [3.85, -2.53], "facing": 180 },

        // Strung along the inside of the balustrade. Visible from the whole
        // great room, so it is also the hearth end's night-light: the railing
        // top is at 1.0 over the loft floor and the line hangs just above it.
        { "id": "loft-lights", "kind": "fairylights", "at": [0, 2.55], "facing": 0, "y": 1.15, "size": [9.6, 0.16] }
      ]
    },

    {
      "id": "reading",
      "name": "Reading corner",
      // 5 (the cabin's edge) + 0.24 (two wall thicknesses) + 2.8 (half of 5.6).
      // Grown from 4.4 x 4.4 when the bedroom arrived: a flight of stairs in a
      // four-metre room owned the place, so the room got the extra metre and
      // the flight got a longer, shallower run.
      "origin": [-8.04, 0.9],
      "size": [5.6, 5.0],
      "height": 3.0,
      // The bedroom sits on top: its floor slab is this room's ceiling, so
      // building a ceiling plane here as well would be two surfaces in one
      // place, flickering.
      "ceiling": false,

      "openings": [
        { "wall": "east", "at": 0, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" },
        // No west window: the flight to the bedroom runs the length of that
        // wall, and a staircase across a window reads as a mistake. The west
        // light comes into the bedroom above instead.
        { "wall": "north", "at": 1.4, "width": 1.4, "height": 1.4, "sill": 0.95, "kind": "window" }
      ],

      // The north cases sit east of the flight, leaving the corridor along the
      // west wall clear for boarding it.
      "shelves": [
        { "id": "reading-n0", "at": [-0.85, -2.325], "facing": 0, "rows": 5 },
        { "id": "reading-n1", "at": [0.2, -2.325], "facing": 0, "rows": 5 },
        { "id": "reading-s0", "at": [-1.2, 2.325], "facing": 180, "rows": 5 },
        { "id": "reading-s1", "at": [-0.15, 2.325], "facing": 180, "rows": 5 }
      ],

      // Everything is kept clear of the line you walk in on, which runs from
      // the door at local x = 2.8 straight across at z = 0 — so nothing solid
      // sits within about 0.6 m of that line. A side table in a doorway is
      // exactly the sort of thing you only notice by walking into it.
      "furniture": [
        { "id": "rug", "kind": "rug", "at": [0.9, 1.4], "facing": 0, "size": [3.0, 2.4] },
        { "id": "chair", "kind": "armchair", "at": [1.6, 1.5], "facing": 265 },
        { "id": "stool", "kind": "footstool", "at": [0.75, 1.65], "facing": 265 },
        // At the chair's arm, which is the only place a side table is any use.
        // Pushing it east to clear the upholstery had put it *behind* the chair
        // and half off the rug, against the east wall — out of reach of anybody
        // sitting down, which is the whole job. Beside it instead: a chair turned
        // 265° reaches z = 1.97, so a table at 2.2 stands 3 cm off its arm, on
        // the rug, clear of the lamp at 2.25 and 7 cm short of the south wall.
        { "id": "table", "kind": "sidetable", "at": [1.5, 2.2], "facing": 0 },
        { "id": "lamp", "kind": "floorlamp", "at": [2.25, 2.1], "facing": 0 },
        { "id": "reading-plant", "kind": "plant", "at": [2.3, -2.05], "facing": 0 },
        { "id": "picture-3", "kind": "picture", "at": [0.9, 2.44], "facing": 180, "y": 1.6, "size": [0.8, 0.6] },
        { "id": "reading-pendant", "kind": "pendant", "at": [0, 0], "facing": 0 },

        // Up to the bedroom, along the west wall. Boarded at the north end —
        // the corridor between the flight and the north cases is kept clear —
        // and it tops out at z = 2.0, where the bedroom's stairwell hole ends.
        { "id": "bedroom-stairs", "kind": "stairs", "at": [-2.25, 0.1], "facing": 0, "size": [1.0, 3.8], "rise": 3.22 }
      ]
    },

    {
      "id": "bedroom",
      "name": "Bedroom",
      // Directly over the reading corner: same footprint, floor slab resting
      // on its walls. 3.22 is the reading corner's 3.0 walls plus the 0.22
      // slab — any lower and the slab stands into the room below.
      "origin": [-8.04, 0.9],
      "size": [5.6, 5.0],
      "elevation": 3.22,
      "height": 2.3,

      // The stairwell. Ends exactly at z = 2.0, where the flight below
      // reaches 3.22 — top step and first floorboard at the same height.
      "holes": [{ "at": [-2.2, 0.5], "size": [1.2, 3.0] }],

      "openings": [
        // The point of the room: a low, wide window looking north over the
        // lake, at the height of the bed and the chair.
        { "wall": "north", "at": -0.3, "width": 2.8, "height": 1.4, "sill": 0.7, "kind": "window" },
        { "wall": "west", "at": -0.8, "width": 1.2, "height": 1.1, "sill": 0.9, "kind": "window" }
      ],

      "shelves": [
        { "id": "bedroom-s0", "at": [-0.35, 2.325], "facing": 180, "rows": 4 },
        { "id": "bedroom-s1", "at": [0.85, 2.325], "facing": 180, "rows": 4 }
      ],

      "furniture": [
        // The bed stands along the east wall, head to the north, so waking up
        // is looking at the lake. A bed is 2.05 deep and its headboard is the
        // -Z face, so -2.5 + 1.025 is what puts the board against the plaster.
        { "id": "bed", "kind": "bed", "at": [1.95, -1.475], "facing": 0 },
        { "id": "bedroom-rug", "kind": "rug", "at": [0.2, 0.6], "facing": 0, "size": [2.6, 2.0] },
        // The reading chair, pointed out of the window.
        { "id": "bedroom-chair", "kind": "armchair", "at": [-0.7, -1.7], "facing": 175 },
        { "id": "bedroom-table", "kind": "sidetable", "at": [0.2, -1.8], "facing": 0 },
        { "id": "bedroom-lamp", "kind": "floorlamp", "at": [-1.55, -2.05], "facing": 0, "on": false },
        { "id": "bedroom-plant", "kind": "plant", "at": [2.3, 1.9], "facing": 0, "height": 0.8 },
        { "id": "picture-4", "kind": "picture", "at": [2.74, -1.6], "facing": 270, "y": 1.5, "size": [0.6, 0.8] },
        { "id": "bedroom-pendant", "kind": "pendant", "at": [0.0, 0.5], "facing": 0, "y": 1.85 },
        // The other switch, at the head of the stairs. Same thing it does
        // downstairs: every light in the library, on or off together — which is
        // the one you want from a bed.
        { "id": "bedroom-switch", "kind": "lightswitch", "at": [-1.0, 2.44], "facing": 180, "y": 1.15 }
      ]
    },

    {
      "id": "kitchen",
      "name": "Kitchen",
      "origin": [7.24, 1.4],
      "size": [4, 3.4],
      "height": 2.7,

      "openings": [
        // World z = 2.1, matching the great room's east door.
        { "wall": "west", "at": 0.7, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" },
        // The one window. The north wall used to have a second, and the bathroom
        // is now built against it — so what that window showed was the back of
        // the bathroom's plaster. The east wall is the only side of this room
        // with the forest behind it, which is why the big one is there.
        { "wall": "east", "at": 0, "width": 1.6, "height": 1.2, "sill": 1.05, "kind": "window" },
        // Through to the bathroom, at world x = 6.19. The dining set was moved
        // east to keep this lane bare.
        { "wall": "north", "at": -1.05, "width": 0.9, "height": 2.05, "sill": 0, "kind": "door" },
        // Through to the office, at world x = 8.44. It sits at the east end of
        // the wall because the west end of it is the run of counter.
        { "wall": "south", "at": 1.2, "width": 1.0, "height": 2.05, "sill": 0, "kind": "door" }
      ],

      "shelves": [],

      "furniture": [
        // Both stand against the south wall, so their fronts face *north* into
        // the room — facing 0 here pointed the drawers (and the coffee maker's
        // carafe) into the plaster.
        { "id": "counter-south", "kind": "kitchencounter", "at": [-0.6, 1.39], "facing": 180 },
        { "id": "counter-east", "kind": "kitchencounter", "at": [1.69, -0.4], "facing": 270 },
        { "id": "coffee", "kind": "coffeemaker", "at": [-1.15, 1.35], "facing": 180, "y": 0.92 },
        // The telephone, on the counter east of the coffee maker. E orders a
        // food delivery; it is left at the foot of the porch steps a while
        // later, and the empty box goes in the bin.
        { "id": "phone", "kind": "phone", "at": [0.0, 1.38], "facing": 180, "y": 0.92 },
        // A slim larder fridge, full of cold cans, on the north wall west of
        // the bathroom door's lane (which runs x -1.5 to -0.6). E takes a can;
        // the empties go in the bin. Slimmed to fit the strip of wall it has.
        { "id": "fridge", "kind": "fridge", "at": [-1.74, -1.38], "facing": 0, "size": [0.5, 0.56] },
        // The bin, in the corner west of the counter run, south of the west
        // door's lane (which ends at z 1.25). Cans and takeaway boxes go in;
        // it refuses the crockery.
        { "id": "bin", "kind": "bin", "at": [-1.78, 1.45], "facing": 0 },
        // Chairs at the ends rather than at the sides: the north side of the
        // table is now the way through to the bathroom.
        { "id": "kitchen-table", "kind": "table", "at": [0.0, -0.6], "facing": 0, "size": [1.1, 0.72] },
        { "id": "kitchen-chair-1", "kind": "diningchair", "at": [0.0, 0.15], "facing": 180 },
        { "id": "kitchen-chair-2", "kind": "diningchair", "at": [0.9, -0.6], "facing": 270 },
        // A rug under the table and a clock over the counter: the kitchen was
        // the one room with neither, and it read as a workroom for it. The rug
        // is not solid, so the lanes to both doors stay walkable.
        { "id": "kitchen-rug", "kind": "rug", "at": [0.0, -0.5], "facing": 0, "size": [1.7, 1.2] },
        { "id": "kitchen-clock", "kind": "clock", "at": [-0.6, 1.66], "facing": 180, "y": 2.1, "size": [0.3, 0.3] },
        // On the east counter's north end, up out of the walkway — the floor
        // spot it used to hold is the lane between the table and the fridge.
        // The sink sits at the counter's other end, at about z = 0.14.
        { "id": "kitchen-plant", "kind": "plant", "at": [1.72, -1.0], "facing": 0, "y": 0.92, "height": 0.4 },
        { "id": "kitchen-pendant", "kind": "pendant", "at": [0.0, -0.6], "facing": 0 },
        // Flattened spares leaning on the east wall, south of the counter run.
        // E takes one; an empty box in the room breaks down with Backspace.
        { "id": "box-stack", "kind": "boxstack", "at": [1.72, 0.85], "facing": 270 }
      ]
    },

    {
      "id": "bathroom",
      "name": "Bathroom",
      // Directly north of the kitchen, on the kitchen's own footprint, so the
      // two walls sit flush and the two roofs meet: -0.3 (the kitchen's edge)
      // - 0.24 (two wall thicknesses) - 1.4 (half of 2.8) = -1.94.
      "origin": [7.24, -1.94],
      "size": [4, 2.8],
      // Lower than the kitchen's 2.7, so the kitchen's gable clears this roof.
      "height": 2.5,
      "floor": "stone",

      "openings": [
        // World x = 6.19, matching the kitchen's north door.
        { "wall": "south", "at": -1.05, "width": 0.9, "height": 2.05, "sill": 0, "kind": "door" },
        // High and small, over the bath, looking north at the water.
        { "wall": "north", "at": 0, "width": 1.0, "height": 0.8, "sill": 1.35, "kind": "window" },
        // North end of the east wall, over the basin. The picture has the other
        // end of it — the two used to be centred on the same wall, one through
        // the other.
        { "wall": "east", "at": 0.7, "width": 0.9, "height": 0.9, "sill": 1.3, "kind": "window" }
      ],

      "shelves": [],

      "furniture": [
        // The bath along the north wall, under its window. Everything else keeps
        // out of the lane from the door at x = -1.05 straight north.
        { "id": "bath", "kind": "bathtub", "at": [0.0, -1.0], "facing": 0 },
        { "id": "loo", "kind": "toilet", "at": [-1.6, 0.6], "facing": 90 },
        { "id": "basin", "kind": "basin", "at": [1.6, 0.5], "facing": 270 },
        { "id": "bath-mat", "kind": "rug", "at": [0.0, 0.35], "facing": 0, "size": [1.4, 0.9] },
        // A deck and no crate: the records live in the great room, so a side of
        // something in here is something you carried in.
        { "id": "bath-table", "kind": "sidetable", "at": [1.55, -0.9], "facing": 0 },
        { "id": "bath-deck", "kind": "recordplayer", "at": [1.55, -0.9], "facing": 180, "y": 0.56 },
        { "id": "bath-plant", "kind": "plant", "at": [-1.7, -1.05], "facing": 0, "height": 0.6 },
        { "id": "picture-7", "kind": "picture", "at": [1.94, -0.7], "facing": 270, "y": 1.5, "size": [0.5, 0.4] },
        { "id": "bath-pendant", "kind": "pendant", "at": [0, 0.2], "facing": 0, "y": 2.05 }
      ]
    },

    {
      "id": "office",
      "name": "Office",
      // South of the kitchen: 3.1 (the kitchen's edge) + 0.24 (two wall
      // thicknesses) + 2.6 (half of 5.2) = 5.94. It is offset a little east of
      // the kitchen so its roof overhang clears the porch's — the two are
      // otherwise near enough to abut in the air without abutting on the ground,
      // which is the one case the overhang rule cannot work out for itself.
      "origin": [8.0, 5.94],
      "size": [4.8, 5.2],
      // A little taller than the kitchen, so the two roofs step rather than
      // meeting in a valley at exactly the same height.
      "height": 2.8,

      "openings": [
        // World x = 8.44, matching the kitchen's south door.
        { "wall": "north", "at": 0.44, "width": 1.0, "height": 2.05, "sill": 0, "kind": "door" },
        { "wall": "west", "at": 0, "width": 1.4, "height": 1.2, "sill": 0.95, "kind": "window" },
        // At the *south* end of the east wall, because the bookcases have the
        // north end of it. A case standing across a window is a window you have
        // walled up from the inside — and it was, until the room grew.
        { "wall": "east", "at": 1.8, "width": 1.2, "height": 1.2, "sill": 0.95, "kind": "window" }
      ],

      // Along the east wall, north of the window and clear of the lane you walk
      // in on — which runs from the door at local x = 0.44 straight south.
      "shelves": [
        { "id": "office-0", "at": [2.225, -1.8], "facing": 270, "rows": 5 },
        { "id": "office-1", "at": [2.225, -0.7], "facing": 270, "rows": 5 },
        { "id": "office-2", "at": [2.225, 0.4], "facing": 270, "rows": 5 }
      ],

      "furniture": [
        // The whiteboard, filling the south wall. It is 3.6 m of board on a
        // 4.8 m wall — the room was grown from four metres square precisely so
        // that there would be somewhere to put a morning's reading. Press P
        // while reading to tear a copy of the page you are on out of the book —
        // the book keeps its page — and E to pin what you are holding to this
        // board, or to any wall in the library. T writes a note, and there is a
        // pad of them on the desk.
        { "id": "board", "kind": "whiteboard", "at": [0, 2.54], "facing": 180, "y": 1.55, "size": [3.6, 1.4] },

        // The marker for it, on the desk. E picks it up, then hold the left
        // mouse button and the line follows the crosshair; F changes pen and G
        // wipes the board. It never moves — the marker in your hand is this one,
        // hidden — so nothing about it is written down.
        { "id": "marker", "kind": "marker", "at": [-0.5, 1.32], "facing": 8, "y": 0.75 },

        // The desk faces the board, at the west end so the doorway lane is
        // clear. The terminal on it is the library's index: E on it searches
        // every book, record, tape and picture the library knows about and says
        // where the thing actually is.
        // Turned so the drawers face the chair — a desk's drawers belong on
        // the side of the person sitting at it.
        { "id": "desk", "kind": "desk", "at": [-1.2, 1.6], "facing": 180, "size": [1.6, 0.75] },
        { "id": "desk-chair", "kind": "diningchair", "at": [-1.2, 0.75], "facing": 0 },
        // The terminal faces 180 while the desk it stands on faces 0, which
        // looks like a mistake and is the opposite: facing points a thing's
        // front, and a screen's front is the side you read. You come at this
        // desk from the north, from the chair — so the screen has to look north
        // at you. Facing 0 showed the room the back of the monitor.
        { "id": "catalogue", "kind": "computer", "at": [-0.75, 1.62], "facing": 180, "y": 0.75 },
        { "id": "notepad", "kind": "postits", "at": [-1.75, 1.42], "facing": 12, "y": 0.75 },

        { "id": "office-rug", "kind": "rug", "at": [-0.4, 0.6], "facing": 0, "size": [3.0, 2.2] },
        { "id": "office-lamp", "kind": "floorlamp", "at": [-1.9, 2.1], "facing": 0 },
        { "id": "office-plant", "kind": "plant", "at": [-1.9, -1.9], "facing": 0, "height": 0.8 },
        { "id": "picture-5", "kind": "picture", "at": [-1.3, -2.54], "facing": 0, "y": 1.6, "size": [0.7, 0.5] },
        { "id": "office-pendant", "kind": "pendant", "at": [0, 0.2], "facing": 0 }
      ]
    },

    {
      "id": "porch",
      "name": "Porch",
      // Flush against the cabin's south wall rather than a doorway away from
      // it, so the decking meets the floorboards and there is nothing to trip
      // over on the way out. "outdoor" gives it decking and no room lights;
      // with no north wall of its own, the cabin's is what you step through.
      //
      // The steps are straight ahead of the cabin's south door, so you walk out
      // of one and down the other; the seating has the whole west end.
      "origin": [0.8, 5.9],
      "size": [7.2, 3.8],
      "height": 2.7,
      "outdoor": true,
      "walls": ["south", "east", "west"],

      // A lean-to over the decking: one slope, low on the south side, climbing
      // north to tuck under the cabin's south wall. "fall" is the low side, and
      // getting it backwards is a roof that drains into the house.
      "roof": { "kind": "shed", "pitch": 18, "fall": "south" },

      "openings": [
        // Railings: waist-high aprons with the whole opening above them, open
        // to the forest rather than glazed. A railing is a *window* with no
        // glass in it, which is also why it stops you: only a door you could
        // walk through is subtracted from the collision.
        //
        // The three south openings tile the wall exactly between them — the
        // door at world x = 2.6 covers local 1.25 to 2.35, and a railing takes
        // everything either side of it — because two openings that overlap
        // would cut each other's panels to ribbons.
        { "wall": "south", "at": -1.175, "width": 4.85, "height": 1.75, "sill": 0.95, "kind": "window", "glazed": false },
        { "wall": "south", "at": 1.8, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" },
        { "wall": "south", "at": 2.975, "width": 1.25, "height": 1.75, "sill": 0.95, "kind": "window", "glazed": false },
        { "wall": "east", "at": 0, "width": 3.0, "height": 1.75, "sill": 0.95, "kind": "window", "glazed": false },
        { "wall": "west", "at": 0, "width": 3.0, "height": 1.75, "sill": 0.95, "kind": "window", "glazed": false }
      ],

      "shelves": [],

      // The cabin's south door is at world x = 2.6 and the steps are directly
      // below it, so the whole of that lane is kept bare. The table, the chairs
      // and the bench live west of it, where nobody has to walk.
      "furniture": [
        { "id": "porch-table", "kind": "table", "at": [-1.0, 0.1], "facing": 0, "size": [1.1, 0.8] },
        { "id": "porch-chair-1", "kind": "diningchair", "at": [-1.0, 0.95], "facing": 180 },
        { "id": "porch-chair-2", "kind": "diningchair", "at": [-1.0, -0.75], "facing": 0 },
        { "id": "porch-bench", "kind": "bench", "at": [-3.0, 0.1], "facing": 90 },
        { "id": "porch-plant", "kind": "plant", "at": [3.1, -1.4], "facing": 0, "height": 0.7 },
        { "id": "porch-lamp", "kind": "pendant", "at": [-1.0, 0.1], "facing": 0, "y": 2.2, "on": false },
        // Strung along the inside of the south railing, over the seating end.
        // "size" is [length, sag] and "y" is the line it hangs from — the shed
        // roof is low on this side, so 2.15 keeps the bulbs under it.
        { "id": "porch-lights", "kind": "fairylights", "at": [-1.0, 1.78], "facing": 0, "y": 2.15, "size": [4.4, 0.16] },

        // Down onto the grass, straight out of the cabin's south door. The
        // treads are decoration: the drop from the decking to the ground is
        // 24 cm, which is inside the step the walk controller will take
        // unaided, so the steps are what makes it look like somewhere to walk
        // down rather than somewhere to fall off. Sized to the doorway — the
        // railing panels own the wall either side of it, and a wider tread
        // comes out through their aprons.
        { "id": "porch-step", "kind": "step", "at": [1.8, 2.21], "facing": 0, "size": [1.1, 0.62] },

        // A little table by the steps, and the headlamp lying on it — where a
        // hand finds it on the way out into the dark. E puts it on; worn, not
        // held, so both hands stay free for books, and E on any empty tabletop
        // sets it back down.
        { "id": "porch-side", "kind": "sidetable", "at": [2.75, 1.45], "facing": 0 },
        { "id": "headlamp", "kind": "headlamp", "at": [2.75, 1.45], "facing": 200, "y": 0.56 },

        // The folding pair, stood against the east end of the porch where such
        // things live. X picks one up and carries it; X again stands it wherever
        // you are — down at the water, over the brook, by the campfire. Where you
        // left it is remembered in books.json, like a shoved box, so this line
        // says where it *lives* and never where it has got to.
        { "id": "folding-chair", "kind": "foldingchair", "at": [3.15, 0.65], "facing": 250 },
        { "id": "folding-table", "kind": "foldingtable", "at": [3.1, -0.45], "facing": 270 }
      ]
    },

    {
      "id": "lakehouse",
      "name": "The lake house",
      // The second building. Nothing in the format ever said there had to be
      // one house: a library folder can describe as many as it likes, and the
      // trail between them is drawn from world/terrain.ts — the *route* between
      // two buildings is a fact about the valley rather than about either one.
      //
      // Sited on the rise above the south-west shore, clear of the walk round
      // the water: near enough that the lake fills the north window, far enough
      // that the path passes it rather than going through it.
      "origin": [-22, -4.6],
      "size": [5.0, 4.4],
      "height": 2.9,
      "roof": { "kind": "gable", "pitch": 32, "overhang": 0.5, "fall": "south" },

      "openings": [
        // North, onto the deck and the water: a door at one end and the window
        // that the whole building is an excuse for at the other.
        { "wall": "north", "at": -1.4, "width": 1.0, "height": 2.05, "sill": 0, "kind": "door" },
        { "wall": "north", "at": 1.0, "width": 2.2, "height": 1.5, "sill": 0.85, "kind": "window" },
        // The way in, off the trail.
        { "wall": "south", "at": 1.4, "width": 1.0, "height": 2.05, "sill": 0, "kind": "door" },
        { "wall": "west", "at": -0.6, "width": 1.2, "height": 1.2, "sill": 0.95, "kind": "window" },
        { "wall": "east", "at": 1.5, "width": 1.2, "height": 1.2, "sill": 0.95, "kind": "window" }
      ],

      "shelves": [
        { "id": "lake-0", "at": [2.325, -1.0], "facing": 270, "rows": 5 },
        { "id": "lake-1", "at": [2.325, 0.2], "facing": 270, "rows": 5 }
      ],

      "furniture": [
        // A stove at the west end of the south wall, well clear of the door.
        { "id": "lake-stove", "kind": "fireplace", "at": [-1.2, 1.95], "facing": 180, "size": [0.9, 0.5], "height": 1.3 },
        { "id": "lake-rug", "kind": "rug", "at": [-0.4, 0.3], "facing": 0, "size": [2.4, 2.0] },
        { "id": "lake-chair", "kind": "armchair", "at": [-0.5, 0.5], "facing": 175 },
        { "id": "lake-stool", "kind": "footstool", "at": [-0.5, -0.4], "facing": 175 },
        { "id": "lake-table", "kind": "sidetable", "at": [0.7, 0.7], "facing": 0 },
        { "id": "lake-lamp", "kind": "floorlamp", "at": [-1.8, 0.9], "facing": 0 },
        { "id": "lake-plant", "kind": "plant", "at": [1.7, -1.7], "facing": 0, "height": 0.7 },
        { "id": "picture-6", "kind": "picture", "at": [-2.44, 1.2], "facing": 90, "y": 1.5, "size": [0.6, 0.8] },
        { "id": "lake-pendant", "kind": "pendant", "at": [0, 0], "facing": 0, "y": 2.15 },

        // A second record crate, so more of music/ has somewhere to be — the
        // deal slices the folder across every crate in the world — and so the
        // walk round the lake has a ritual at the end of it: carry a record
        // over, light the stove, put it on. On the south wall between the
        // stove and the door, deck on top of the crate like the great room's.
        { "id": "lake-records", "kind": "recordshelf", "at": [-0.1, 2.0], "facing": 180 },
        { "id": "lake-deck", "kind": "recordplayer", "at": [-0.1, 1.93], "facing": 180, "y": 0.78 }
      ]
    },

    {
      "id": "lakedeck",
      "name": "The lake deck",
      // Flush against the lake house's north wall, the way the porch is flush
      // against the cabin's south one. Its railing is the same trick: an
      // unglazed window with a waist-high sill.
      //
      // It is low and its roof is shallow deliberately. A lean-to climbs the
      // whole of its span to the high side, so at the porch's 18 degrees this
      // one would peak at 3.3 m — a third of a metre *through* the wall of a
      // 2.9 m house. Ten degrees over 2.4 m of deck tucks under it instead.
      "origin": [-22, -8.0],
      "size": [5.0, 2.4],
      "height": 2.3,
      "outdoor": true,
      "walls": ["north", "east", "west"],
      "roof": { "kind": "shed", "pitch": 10, "fall": "north" },

      "openings": [
        { "wall": "north", "at": 0, "width": 4.2, "height": 1.5, "sill": 0.95, "kind": "window", "glazed": false },
        { "wall": "east", "at": 0, "width": 1.8, "height": 1.5, "sill": 0.95, "kind": "window", "glazed": false },
        { "wall": "west", "at": 0, "width": 1.8, "height": 1.5, "sill": 0.95, "kind": "window", "glazed": false }
      ],

      "shelves": [],

      "furniture": [
        { "id": "deck-bench", "kind": "bench", "at": [-1.5, 0.1], "facing": 0 },
        { "id": "deck-table", "kind": "table", "at": [0.9, 0.0], "facing": 0, "size": [0.9, 0.7], "height": 0.7 },
        { "id": "deck-chair", "kind": "diningchair", "at": [0.9, 0.8], "facing": 180 },
        { "id": "deck-plant", "kind": "plant", "at": [2.0, -0.7], "facing": 0, "height": 0.6 },
        { "id": "deck-lamp", "kind": "pendant", "at": [0, 0], "facing": 0, "y": 1.95, "on": false },
        // Along the north railing, facing the water. This deck's roof only
        // reaches 2.3, so the line hangs at 1.9.
        { "id": "deck-lights", "kind": "fairylights", "at": [0, -1.08], "facing": 0, "y": 1.9, "size": [4.0, 0.14] }
      ]
    },

    {
      "id": "camp",
      "name": "The camp",
      // Across the water: the far shore, just past the walk that rings the
      // lake, looking back at both houses. Not a building — no walls, no
      // roof, a stone pad barely proud of the grass — but a room as far as
      // the format cares, which is what clears the forest around it and
      // gives the fire somewhere to be. The pad sits 2 cm above the ground
      // (which is at -0.24) so the two surfaces never fight for pixels.
      "origin": [-4, -65],
      "size": [6, 5],
      "height": 2.4,
      "elevation": -0.22,
      "outdoor": true,
      "walls": [],
      "ceiling": false,
      "floor": "stone",
      "roof": { "kind": "none", "pitch": 0, "overhang": 0, "fall": "south" },

      "shelves": [],

      // A fire in a ring of stones — lit with E, like a lamp, but not on the
      // house circuit: the switch by the cabin door leaves it alone. The two
      // benches are the logs you sit on, and the tent faces the fire.
      "furniture": [
        { "id": "camp-fire", "kind": "campfire", "at": [0, 0.3], "facing": 0, "on": false },
        { "id": "camp-tent", "kind": "tent", "at": [-1.6, -0.9], "facing": 55 },
        { "id": "camp-log-1", "kind": "bench", "at": [1.3, -0.6], "facing": 305 },
        { "id": "camp-log-2", "kind": "bench", "at": [0.9, 1.55], "facing": 217 }
      ]
    }
  ]
}
`
