/**
 * The world written into a library folder the first time it is opened. Text
 * rather than an object because the user edits this file and its comments are
 * its documentation.
 *
 * Positions are relative to the room's centre, in metres; `facing` is degrees
 * clockwise about Y, 0 pointing the front towards +Z. Rooms sit 0.24 m apart —
 * twice the wall thickness — so a door in each makes one doorway.
 */
export const DEFAULT_WORLD_TEXT = `{
  // A cabin in the woods, with a lake through the north window, a trail round
  // the water, and a little house at the far end of it.
  //
  // Edit this file and the room reloads as you save. A bad edit is reported in
  // the panel and the running room is left alone, so you cannot break your
  // library from in here. The app never writes back over this file: boxes,
  // lamps and shelf labels live in books.json and ambience.json beside it.
  //
  // Nothing carries a "label" — a bookcase stays bare until you write on it
  // with L. A full guide is in docs/custom-maps.md.
  "name": "The Cabin",

  // "facing" for a person is the way they look, so 0 is north (-Z) — the
  // opposite of a bookcase, whose 0 is where its open front points.
  "spawn": { "room": "main", "at": [0, 1.0], "facing": 0 },

  "rooms": [
    {
      "id": "main",
      "name": "Great room",
      // Centre of the room in world metres, then width (X) by depth (Z).
      "origin": [0, 0],
      "size": [10, 8],
      // A cathedral ceiling: the loft lives inside this volume rather than on
      // top of it, and shares the ceiling you see from down here.
      "height": 4.8,

      // Only the topmost room over a patch of ground is roofed, worked out from
      // the document, so the loft inside this one needs no roof of its own.
      //
      // "fall" names the sides the eaves run along, so "south" runs the ridge
      // east to west. Leave the roof out entirely for a 30-degree gable over
      // the longer axis, which is what you want nine times out of ten.
      "roof": { "kind": "gable", "pitch": 28, "overhang": 0.5, "fall": "south" },

      "openings": [
        // "at" is measured from the middle of the wall. The big one faces the
        // lake, wide and low so it reads as a view rather than a window. Its
        // top is the number that matters: the loft slab hangs from 2.28, so
        // anything taller than 1.48 above this sill has a plank through it.
        { "wall": "north", "at": 0, "width": 4.6, "height": 1.38, "sill": 0.8, "kind": "window" },
        // The third window, on the north wall because that is the one side of
        // this room nothing abuts — elsewhere it looks at a neighbour's
        // plaster. Its head stops at 2.2, under the loft slab at 2.28.
        { "wall": "north", "at": 4.2, "width": 1.2, "height": 1.35, "sill": 0.85, "kind": "window" },
        // The loft's window, in this wall because the loft builds no north wall
        // of its own. Its sill is above the loft floor, so it is a window by
        // the sofa upstairs and out of sight below.
        //
        // It must tile with the two below rather than overlap them: openings
        // sharing a stretch of wall cut each other's panels to ribbons.
        { "wall": "north", "at": 2.95, "width": 1.1, "height": 1.25, "sill": 3.05, "kind": "window" },
        { "wall": "south", "at": 0.3, "width": 1.6, "height": 1.4, "sill": 0.95, "kind": "window" },
        // Doors need a matching door in the next room's facing wall. The east
        // one sits south because the staircase owns the north end, and a door
        // opening into the side of a flight is a door you cannot use.
        { "wall": "west", "at": 0.9, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" },
        { "wall": "east", "at": 2.1, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" },
        { "wall": "south", "at": 2.6, "width": 1.3, "height": 2.1, "sill": 0, "kind": "door" }
      ],

      // Bookcases. Your book layout is keyed by "id": move a shelf and its
      // books move with it, but rename one and its books go back into boxes.
      //
      // A case is 1.0 m wide; these stand 1.2 m apart, so a run reads as
      // furniture along a wall rather than built-in shelving.
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
        // The hearth end. The seating is an island rather than a lining of the
        // walls, leaving an open corridor along the west shelf run — room to
        // stand at a case and browse, not sidle past upholstery.
        { "id": "hearth", "kind": "fireplace", "at": [-3.4, -3.75], "facing": 0 },
        { "id": "hearth-rug", "kind": "rug", "at": [-2.3, -1.7], "facing": 0, "size": [3.0, 2.6] },
        { "id": "sofa", "kind": "sofa", "at": [-2.3, -1.15], "facing": 180 },
        { "id": "reading-chair", "kind": "armchair", "at": [-0.85, -2.35], "facing": 250 },
        { "id": "hearth-table", "kind": "sidetable", "at": [-0.85, -1.3], "facing": 0 },
        { "id": "hearth-lamp", "kind": "floorlamp", "at": [-0.15, -3.05], "facing": 0 },

        // Records live under the window, with the deck on top of the crate.
        { "id": "records", "kind": "recordshelf", "at": [1.6, -3.8], "facing": 0 },
        { "id": "deck", "kind": "recordplayer", "at": [1.6, -3.73], "facing": 0, "y": 0.78 },

        // With no "source" it takes whatever is next in your artwork/ folder.
        // Sized to the band of wall between mantel and loft floor, frame
        // included — the frame adds 4.5 cm on every side beyond "size".
        { "id": "picture-1", "kind": "picture", "at": [-3.4, -3.96], "facing": 0, "y": 1.96, "size": [0.78, 0.42] },

        { "id": "fern", "kind": "plant", "at": [4.4, -3.5], "facing": 0 },
        { "id": "palm", "kind": "plant", "at": [-4.5, 2.0], "facing": 0, "height": 1.35 },

        // Telling this machine's own time, on the strip of north wall west of
        // the chimney breast. Like a picture, "y" is the centre of its face and
        // "size" is the dial, and its top must stay under the loft floor.
        { "id": "clock", "kind": "clock", "at": [-4.55, -3.96], "facing": 0, "y": 1.95, "size": [0.34, 0.34] },

        // Ceiling lights. "on": false starts one dark; switching a light in the
        // app is remembered in ambience.json, not written back here.
        //
        // The tall ones hang south of where the loft floor ends — a pendant on
        // a long flex under a loft is a pendant inside the floor above it.
        //
        // The switch by the porch door works every light in the library, not
        // just this room's. Hung like a picture, so "y" is the plate's middle.
        { "id": "main-switch", "kind": "lightswitch", "at": [3.6, 3.97], "facing": 180, "y": 1.15 },

        { "id": "main-pendant-w", "kind": "pendant", "at": [-2.6, 2.6], "facing": 0, "y": 2.9 },
        { "id": "main-pendant-e", "kind": "pendant", "at": [2.6, 2.6], "facing": 0, "y": 2.9 },
        { "id": "hearth-pendant", "kind": "pendant", "at": [-1.5, -1.5], "facing": 0, "y": 1.95 },

        // Up to the loft. A flight climbs towards its facing direction, "size"
        // is [width, run], "rise" is how far up it gets.
        //
        // The number that has to be right is where the run ends: this tops out
        // at z = -2.1 and the loft's stairwell hole ends at the same z, so the
        // last tread and the first floorboard meet. End the hole any later and
        // there is a strip of nothing at the top of the stairs.
        { "id": "stairs", "kind": "stairs", "at": [4.4, -0.4], "facing": 180, "size": [1.05, 3.4], "rise": 2.5 },

        // E swings it, ambience.json remembers whether it stands open, and a
        // closed one really does block the doorway.
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
      // Inside the great room's volume rather than on top of it: same origin,
      // an elevation, no ceiling. "walls" lists only what this room builds —
      // the other three are the cabin's, and building them again doubles them.
      "origin": [0, -1.3],
      "size": [10, 5.4],
      // 2.5 rather than 2.4: a bookcase is 2.24 tall and the slab 0.22 thick,
      // so any lower and the cases downstairs stand up into the boards.
      "elevation": 2.5,
      "height": 2.3,
      "walls": ["south"],
      "ceiling": false,

      // Its far edge is where the flight reaches 2.5, so you walk off the top
      // step onto the boards with no step to climb and no gap to fall down.
      "holes": [{ "at": [4.4, 0.675], "size": [1.45, 2.95] }],

      "openings": [
        // A very wide window with a waist-high sill and no glass: you see the
        // room over it and cannot walk off it. "glazed": false is the whole
        // difference between a window and a hole with a railing under it.
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
        // East of the chair, turned to the same television. A sofa is 1.86
        // wide, so this one runs to 1.68 — clear of the stairwell hole.
        { "id": "loft-sofa", "kind": "sofa", "at": [0.75, 0.75], "facing": 5 },
        { "id": "loft-lamp", "kind": "floorlamp", "at": [-2.7, 1.0], "facing": 0 },
        { "id": "loft-plant", "kind": "plant", "at": [0.5, -2.3], "facing": 0, "height": 0.8 },
        { "id": "picture-2", "kind": "picture", "at": [-4.94, 1.6], "facing": 90, "y": 1.5, "size": [0.7, 0.9] },

        // E on the set plays the tape in your hands or stops the one running;
        // E on a tape takes it out of the crate and Q files it back. The crate
        // fills itself from video/ in folder order, so there is nothing to
        // arrange — the same deal the record crates get from music/.
        { "id": "telly", "kind": "crt", "at": [-1.6, 2.15], "facing": 195 },
        { "id": "tapes", "kind": "tapecrate", "at": [-0.8, 2.25], "facing": 195 },

        // The games corner, in the north-east nook past the stairwell — the
        // cabinet plays whatever is in roms/. The hole ends at local z -0.8,
        // so everything here stands on solid boards.
        { "id": "arcade", "kind": "arcade", "at": [4.61, -1.9], "facing": 270 },
        { "id": "roms", "kind": "rombox", "at": [3.85, -2.53], "facing": 180 },

        // Strung inside the balustrade, just above the railing top — visible
        // from the whole great room, so it is the hearth end's night-light.
        { "id": "loft-lights", "kind": "fairylights", "at": [0, 2.55], "facing": 0, "y": 1.15, "size": [9.6, 0.16] }
      ]
    },

    {
      "id": "reading",
      "name": "Reading corner",
      // 5 (the cabin's edge) + 0.24 (two wall thicknesses) + 2.8 (half of 5.6).
      "origin": [-8.04, 0.9],
      "size": [5.6, 5.0],
      "height": 3.0,
      // The bedroom's floor slab is this room's ceiling; a ceiling plane here
      // as well would be two surfaces in one place, flickering.
      "ceiling": false,

      "openings": [
        { "wall": "east", "at": 0, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" },
        // No west window: the flight to the bedroom runs the length of that
        // wall, and a staircase across a window reads as a mistake.
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

      // Nothing solid sits within 0.6 m of the line you walk in on. A side
      // table in a doorway is the sort of thing you notice by walking into it.
      "furniture": [
        { "id": "rug", "kind": "rug", "at": [0.9, 1.4], "facing": 0, "size": [3.0, 2.4] },
        { "id": "chair", "kind": "armchair", "at": [1.6, 1.5], "facing": 265 },
        { "id": "stool", "kind": "footstool", "at": [0.75, 1.65], "facing": 265 },
        // At the chair's arm, the only place a side table is any use: 3 cm off
        // it, on the rug, clear of the lamp and short of the south wall.
        { "id": "table", "kind": "sidetable", "at": [1.5, 2.2], "facing": 0 },
        { "id": "lamp", "kind": "floorlamp", "at": [2.25, 2.1], "facing": 0 },
        { "id": "reading-plant", "kind": "plant", "at": [2.3, -2.05], "facing": 0 },
        { "id": "picture-3", "kind": "picture", "at": [0.9, 2.44], "facing": 180, "y": 1.6, "size": [0.8, 0.6] },
        { "id": "reading-pendant", "kind": "pendant", "at": [0, 0], "facing": 0 },

        // Up to the bedroom along the west wall, topping out where the
        // bedroom's stairwell hole ends.
        { "id": "bedroom-stairs", "kind": "stairs", "at": [-2.25, 0.1], "facing": 0, "size": [1.0, 3.8], "rise": 3.22 }
      ]
    },

    {
      "id": "bedroom",
      "name": "Bedroom",
      // Over the reading corner: same footprint, slab resting on its walls.
      // 3.22 is its 3.0 walls plus the 0.22 slab.
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
        // Head to the north, so waking up is looking at the lake. A bed is 2.05
        // deep with its headboard on the -Z face.
        { "id": "bed", "kind": "bed", "at": [1.95, -1.475], "facing": 0 },
        { "id": "bedroom-rug", "kind": "rug", "at": [0.2, 0.6], "facing": 0, "size": [2.6, 2.0] },
        // The reading chair, pointed out of the window.
        { "id": "bedroom-chair", "kind": "armchair", "at": [-0.7, -1.7], "facing": 175 },
        { "id": "bedroom-table", "kind": "sidetable", "at": [0.2, -1.8], "facing": 0 },
        { "id": "bedroom-lamp", "kind": "floorlamp", "at": [-1.55, -2.05], "facing": 0, "on": false },
        { "id": "bedroom-plant", "kind": "plant", "at": [2.3, 1.9], "facing": 0, "height": 0.8 },
        { "id": "picture-4", "kind": "picture", "at": [2.74, -1.6], "facing": 270, "y": 1.5, "size": [0.6, 0.8] },
        { "id": "bedroom-pendant", "kind": "pendant", "at": [0.0, 0.5], "facing": 0, "y": 1.85 },
        // The other switch, at the head of the stairs: every light in the
        // library together, which is the one you want from a bed.
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
        // The one window. The bathroom is built against the north wall, so the
        // east wall is this room's only side with the forest behind it.
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
        // Against the south wall, so their fronts face north into the room —
        // facing 0 would point the drawers and the carafe into the plaster.
        { "id": "counter-south", "kind": "kitchencounter", "at": [-0.6, 1.39], "facing": 180 },
        { "id": "counter-east", "kind": "kitchencounter", "at": [1.69, -0.4], "facing": 270 },
        { "id": "coffee", "kind": "coffeemaker", "at": [-1.15, 1.35], "facing": 180, "y": 0.92 },
        // E orders a food delivery, left at the foot of the porch steps a while
        // later; the empty box goes in the bin.
        { "id": "phone", "kind": "phone", "at": [0.0, 1.38], "facing": 180, "y": 0.92 },
        // Full of cold cans, on the north wall clear of the bathroom door's
        // lane. E takes one; the empties go in the bin.
        { "id": "fridge", "kind": "fridge", "at": [-1.74, -1.38], "facing": 0, "size": [0.5, 0.56] },
        // In the corner west of the counter run, clear of the west door's lane.
        // Cans and takeaway boxes go in; it refuses the crockery.
        { "id": "bin", "kind": "bin", "at": [-1.78, 1.45], "facing": 0 },
        // Chairs at the ends rather than at the sides: the north side of the
        // table is now the way through to the bathroom.
        { "id": "kitchen-table", "kind": "table", "at": [0.0, -0.6], "facing": 0, "size": [1.1, 0.72] },
        { "id": "kitchen-chair-1", "kind": "diningchair", "at": [0.0, 0.15], "facing": 180 },
        { "id": "kitchen-chair-2", "kind": "diningchair", "at": [0.9, -0.6], "facing": 270 },
        // A rug and a clock, or the kitchen reads as a workroom. A rug is not
        // solid, so the lanes to both doors stay walkable.
        { "id": "kitchen-rug", "kind": "rug", "at": [0.0, -0.5], "facing": 0, "size": [1.7, 1.2] },
        { "id": "kitchen-clock", "kind": "clock", "at": [-0.6, 1.66], "facing": 180, "y": 2.1, "size": [0.3, 0.3] },
        // On the east counter's north end, up out of the walkway between the
        // table and the fridge. The sink is at the counter's other end, z ~ 0.14.
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
      // North of the kitchen on its footprint, so the walls sit flush and the
      // roofs meet: -0.3 - 0.24 (two wall thicknesses) - 1.4 = -1.94.
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
        // North end of the east wall, over the basin. The picture takes the
        // other end, so the two do not overlap.
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
      // South of the kitchen: 3.1 + 0.24 (two wall thicknesses) + 2.6 = 5.94.
      // Offset east so its roof overhang clears the porch's — abutting in the
      // air but not on the ground is the one case the overhang rule misses.
      "origin": [8.0, 5.94],
      "size": [4.8, 5.2],
      // A little taller than the kitchen, so the two roofs step rather than
      // meeting in a valley at exactly the same height.
      "height": 2.8,

      "openings": [
        // World x = 8.44, matching the kitchen's south door.
        { "wall": "north", "at": 0.44, "width": 1.0, "height": 2.05, "sill": 0, "kind": "door" },
        { "wall": "west", "at": 0, "width": 1.4, "height": 1.2, "sill": 0.95, "kind": "window" },
        // At the south end, because the bookcases have the north end. A case
        // across a window is a window walled up from the inside.
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
        // 3.6 m of board on a 4.8 m wall, for a morning's reading. P tears a
        // copy of the page you are on out of a book — the book keeps its own —
        // and E pins what you hold here, or to any wall. T writes a note.
        { "id": "board", "kind": "whiteboard", "at": [0, 2.54], "facing": 180, "y": 1.55, "size": [3.6, 1.4] },

        // E picks it up, then hold the left mouse button and the line follows
        // the crosshair; F changes pen, G wipes the board. It never moves, so
        // nothing about it is written down.
        { "id": "marker", "kind": "marker", "at": [-0.5, 1.32], "facing": 8, "y": 0.75 },

        // At the west end so the doorway lane is clear, drawers towards the
        // chair. The terminal on it is the library's index: E searches every
        // book, record, tape and picture, and says where the thing is.
        { "id": "desk", "kind": "desk", "at": [-1.2, 1.6], "facing": 180, "size": [1.6, 0.75] },
        { "id": "desk-chair", "kind": "diningchair", "at": [-1.2, 0.75], "facing": 0 },
        // Facing 180 while the desk faces 0 is deliberate: facing points a
        // thing's front, and a screen's front is the side you read it from.
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
      // Flush against the cabin's south wall rather than a doorway away, so the
      // decking meets the floorboards. "outdoor" gives it decking and no room
      // lights; with no north wall, the cabin's is what you step through.
      "origin": [0.8, 5.9],
      "size": [7.2, 3.8],
      "height": 2.7,
      "outdoor": true,
      "walls": ["south", "east", "west"],

      // One slope, low on the south side, climbing north to tuck under the
      // cabin's wall. "fall" is the low side; backwards drains into the house.
      "roof": { "kind": "shed", "pitch": 18, "fall": "south" },

      "openings": [
        // Waist-high aprons, open to the forest. A railing is a window with no
        // glass, which is also why it stops you: only a door is subtracted from
        // the collision. The three south openings tile the wall exactly rather
        // than overlapping, or they cut each other's panels to ribbons.
        { "wall": "south", "at": -1.175, "width": 4.85, "height": 1.75, "sill": 0.95, "kind": "window", "glazed": false },
        { "wall": "south", "at": 1.8, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" },
        { "wall": "south", "at": 2.975, "width": 1.25, "height": 1.75, "sill": 0.95, "kind": "window", "glazed": false },
        { "wall": "east", "at": 0, "width": 3.0, "height": 1.75, "sill": 0.95, "kind": "window", "glazed": false },
        { "wall": "west", "at": 0, "width": 3.0, "height": 1.75, "sill": 0.95, "kind": "window", "glazed": false }
      ],

      "shelves": [],

      // The lane from the cabin's south door to the steps is kept bare; the
      // table, chairs and bench live west of it, where nobody has to walk.
      "furniture": [
        { "id": "porch-table", "kind": "table", "at": [-1.0, 0.1], "facing": 0, "size": [1.1, 0.8] },
        { "id": "porch-chair-1", "kind": "diningchair", "at": [-1.0, 0.95], "facing": 180 },
        { "id": "porch-chair-2", "kind": "diningchair", "at": [-1.0, -0.75], "facing": 0 },
        { "id": "porch-bench", "kind": "bench", "at": [-3.0, 0.1], "facing": 90 },
        { "id": "porch-plant", "kind": "plant", "at": [3.1, -1.4], "facing": 0, "height": 0.7 },
        { "id": "porch-lamp", "kind": "pendant", "at": [-1.0, 0.1], "facing": 0, "y": 2.2, "on": false },
        // "size" is [length, sag] and "y" is the line it hangs from — the shed
        // roof is low on this side, so 2.15 keeps the bulbs under it.
        { "id": "porch-lights", "kind": "fairylights", "at": [-1.0, 1.78], "facing": 0, "y": 2.15, "size": [4.4, 0.16] },

        // The treads are decoration: the 24 cm drop is inside what the walk
        // controller takes unaided, so they only make it look like somewhere to
        // walk down. Sized to the doorway, or they come out through the aprons.
        { "id": "porch-step", "kind": "step", "at": [1.8, 2.21], "facing": 0, "size": [1.1, 0.62] },

        // The headlamp lies here, where a hand finds it on the way out into the
        // dark. E puts it on — worn, not held, so both hands stay free — and E
        // on any empty tabletop sets it down again.
        { "id": "porch-side", "kind": "sidetable", "at": [2.75, 1.45], "facing": 0 },
        { "id": "headlamp", "kind": "headlamp", "at": [2.75, 1.45], "facing": 200, "y": 0.56 },

        // X picks one up and carries it; X again stands it wherever you are.
        // books.json remembers where you left it, so this line says where it
        // lives and never where it has got to.
        { "id": "folding-chair", "kind": "foldingchair", "at": [3.15, 0.65], "facing": 250 },
        { "id": "folding-table", "kind": "foldingtable", "at": [3.1, -0.45], "facing": 270 }
      ]
    },

    {
      "id": "lakehouse",
      "name": "The lake house",
      // The second building — nothing in the format limits a library folder to
      // one house, and the trail between them comes from world/terrain.ts.
      // Sited above the south-west shore so the lake fills its north window
      // while the walk round the water passes it rather than going through it.
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

        // A second crate, so more of music/ has somewhere to be: the deal
        // slices the folder across every crate in the world. Deck on top of it,
        // like the great room's.
        { "id": "lake-records", "kind": "recordshelf", "at": [-0.1, 2.0], "facing": 180 },
        { "id": "lake-deck", "kind": "recordplayer", "at": [-0.1, 1.93], "facing": 180, "y": 0.78 }
      ]
    },

    {
      "id": "lakedeck",
      "name": "The lake deck",
      // Flush against the lake house's north wall, the way the porch is against
      // the cabin's, with the same unglazed-window railing. Low and shallow
      // deliberately: a lean-to climbs its whole span, so the porch's 18
      // degrees would peak a third of a metre through a 2.9 m house.
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
      // The far shore, looking back at both houses. Not a building — no walls,
      // no roof, a stone pad — but a room as far as the format cares, which is
      // what clears the forest around it. The pad sits 2 cm above the ground so
      // the two surfaces never fight for pixels.
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

      // Lit with E, like a lamp, but not on the house circuit: the switch by
      // the cabin door leaves it alone.
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
