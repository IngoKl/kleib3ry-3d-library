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
  // A cabin in the woods, with a lake through the north window.
  //
  // Edit this file and the room reloads as you save it. If an edit is wrong the
  // room you are standing in keeps running and the problem is reported in the
  // panel, so you cannot break your library by mistyping in here. Nothing the
  // app does is ever written back over this file — where you shove the boxes,
  // which lamps you switch off, what you write on a shelf label, all of that
  // lives in books.json and lights.json beside it.
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

      "openings": [
        // "at" is measured from the middle of that wall. The big one faces the
        // lake; the sill is low so it reads as a view rather than as a window.
        { "wall": "north", "at": 0, "width": 4.6, "height": 2.1, "sill": 0.8, "kind": "window" },
        { "wall": "west", "at": 3.0, "width": 1.6, "height": 1.5, "sill": 0.95, "kind": "window" },
        { "wall": "south", "at": 0.3, "width": 1.6, "height": 1.4, "sill": 0.95, "kind": "window" },
        // Doors need a matching door in the next room's facing wall. The east
        // door sits towards the south end of its wall because the staircase
        // owns the north end — a door opening into the side of a flight is a
        // door you cannot use.
        { "wall": "west", "at": 0.9, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" },
        { "wall": "east", "at": 2.1, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" },
        { "wall": "south", "at": 2.6, "width": 1.3, "height": 2.1, "sill": 0, "kind": "door" }
      ],

      // Bookcases. The "id" is what your book layout is keyed by: move a shelf
      // and its books move with it, but rename or delete one and its books are
      // packed into the boxes on the floor rather than being reshuffled.
      // "label" is a starting label for the card on its top edge — you can
      // change it in the app, and that overrides what is written here.
      //
      // A case is 1.0 m wide; these stand 1.2 m apart, so a run of them reads
      // as furniture standing along a wall rather than as built-in shelving
      // crammed edge to edge.
      "shelves": [
        { "id": "west-0", "at": [-4.825, -3.2], "facing": 90, "rows": 5, "label": "Fiction" },
        { "id": "west-1", "at": [-4.825, -2.0], "facing": 90, "rows": 5 },
        { "id": "west-2", "at": [-4.825, -0.8], "facing": 90, "rows": 5 },

        { "id": "north-0", "at": [2.9, -3.825], "facing": 0, "rows": 5 },

        { "id": "east-0", "at": [4.825, 3.4], "facing": 270, "rows": 5 },

        { "id": "south-0", "at": [-4.0, 3.825], "facing": 180, "rows": 6, "label": "Reference" },
        { "id": "south-1", "at": [-2.8, 3.825], "facing": 180, "rows": 5 },
        { "id": "south-2", "at": [-1.6, 3.825], "facing": 180, "rows": 5 }
      ],

      "furniture": [
        // The hearth end of the room. The sofa keeps a fireside rug's width of
        // floor between itself and the hearth — close enough to warm your
        // feet, far enough that nothing reads as pushed against the fire.
        { "id": "hearth", "kind": "fireplace", "at": [-3.4, -3.75], "facing": 0 },
        { "id": "hearth-rug", "kind": "rug", "at": [-3.0, -1.9], "facing": 0, "size": [3.6, 2.8] },
        { "id": "sofa", "kind": "sofa", "at": [-3.0, -2.0], "facing": 180 },
        { "id": "reading-chair", "kind": "armchair", "at": [-1.2, -2.5], "facing": 250 },
        { "id": "hearth-table", "kind": "sidetable", "at": [-1.3, -1.5], "facing": 0 },
        { "id": "hearth-lamp", "kind": "floorlamp", "at": [-4.3, -1.4], "facing": 0 },

        // Records live under the window, with the deck on top of the crate.
        { "id": "records", "kind": "recordshelf", "at": [1.6, -3.8], "facing": 0 },
        { "id": "deck", "kind": "recordplayer", "at": [1.6, -3.73], "facing": 0, "y": 0.78 },

        // A picture over the hearth. With no "source" it takes whatever is next
        // in your artwork/ folder, so dropping images in is enough. It is sized
        // to the band of wall it actually has: above the mantel (1.57) and
        // below the underside of the loft floor (2.28) — a taller frame here
        // stands in the mantel or vanishes into the ceiling.
        { "id": "picture-1", "kind": "picture", "at": [-3.4, -3.96], "facing": 0, "y": 1.92, "size": [0.9, 0.55] },

        { "id": "fern", "kind": "plant", "at": [4.4, -3.5], "facing": 0 },
        { "id": "palm", "kind": "plant", "at": [-4.5, 2.0], "facing": 0, "height": 1.35 },

        // Ceiling lights. "on": false starts one dark; switching a light in the
        // app is remembered in .library/lights.json, not written back here.
        //
        // The two tall ones hang in the open half of the room, south of where
        // the loft floor ends at z = 1.4 — a pendant on a long flex under a
        // loft is a pendant inside the floor above it. The low one lights the
        // hearth end, where the ceiling is the loft.
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
        { "id": "loft-0", "at": [-3.6, -2.525], "facing": 0, "rows": 5, "label": "Poetry" },
        { "id": "loft-1", "at": [-2.4, -2.525], "facing": 0, "rows": 5 },
        { "id": "loft-2", "at": [-1.2, -2.525], "facing": 0, "rows": 5 },
        { "id": "loft-3", "at": [-4.825, 0.0], "facing": 90, "rows": 4 }
      ],

      "furniture": [
        { "id": "loft-rug", "kind": "rug", "at": [-1.0, 0.6], "facing": 0, "size": [3.0, 2.2] },
        { "id": "loft-chair", "kind": "armchair", "at": [-1.7, 0.8], "facing": 20 },
        { "id": "loft-stool", "kind": "footstool", "at": [-1.7, -0.05], "facing": 20 },
        { "id": "loft-table", "kind": "sidetable", "at": [-0.6, 0.95], "facing": 0 },
        { "id": "loft-lamp", "kind": "floorlamp", "at": [-2.7, 1.0], "facing": 0 },
        { "id": "loft-plant", "kind": "plant", "at": [0.5, -2.3], "facing": 0, "height": 0.8 },
        { "id": "picture-2", "kind": "picture", "at": [-4.94, 1.6], "facing": 90, "y": 1.5, "size": [0.7, 0.9] }
      ]
    },

    {
      "id": "reading",
      "name": "Reading corner",
      // 5 (the cabin's edge) + 0.24 (two wall thicknesses) + 2.2 (half of 4.4).
      "origin": [-7.44, 0.9],
      "size": [4.4, 4.4],
      "height": 3.0,

      "openings": [
        { "wall": "east", "at": 0, "width": 1.1, "height": 2.1, "sill": 0, "kind": "door" },
        { "wall": "west", "at": 0, "width": 2.2, "height": 1.6, "sill": 0.85, "kind": "window" },
        { "wall": "north", "at": 1.4, "width": 1.4, "height": 1.4, "sill": 0.95, "kind": "window" }
      ],

      "shelves": [
        { "id": "reading-n0", "at": [-1.2, -2.025], "facing": 0, "rows": 5 },
        { "id": "reading-n1", "at": [-0.15, -2.025], "facing": 0, "rows": 5 },
        { "id": "reading-s0", "at": [-1.2, 2.025], "facing": 180, "rows": 5 },
        { "id": "reading-s1", "at": [-0.15, 2.025], "facing": 180, "rows": 5 }
      ],

      // Everything is kept clear of the line you walk in on, which runs from
      // the door at local x = 2.2 straight across at z = 0 — so nothing solid
      // sits within about 0.6 m of that line. A side table in a doorway is
      // exactly the sort of thing you only notice by walking into it.
      "furniture": [
        { "id": "rug", "kind": "rug", "at": [0.7, 1.3], "facing": 0, "size": [2.6, 2.2] },
        { "id": "chair", "kind": "armchair", "at": [1.35, 1.35], "facing": 265 },
        { "id": "stool", "kind": "footstool", "at": [0.5, 1.5], "facing": 265 },
        { "id": "table", "kind": "sidetable", "at": [1.8, 0.95], "facing": 0 },
        { "id": "lamp", "kind": "floorlamp", "at": [1.85, 1.85], "facing": 0 },
        { "id": "reading-plant", "kind": "plant", "at": [-1.8, 1.8], "facing": 0 },
        { "id": "picture-3", "kind": "picture", "at": [0.9, 2.14], "facing": 180, "y": 1.6, "size": [0.8, 0.6] },
        { "id": "reading-pendant", "kind": "pendant", "at": [0, 0], "facing": 0 }
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
        { "wall": "east", "at": 0, "width": 1.6, "height": 1.2, "sill": 1.05, "kind": "window" },
        { "wall": "north", "at": 0.8, "width": 1.0, "height": 1.1, "sill": 1.15, "kind": "window" }
      ],

      "shelves": [],

      "furniture": [
        { "id": "counter-south", "kind": "kitchencounter", "at": [-0.6, 1.39], "facing": 0 },
        { "id": "counter-east", "kind": "kitchencounter", "at": [1.69, -0.4], "facing": 270 },
        { "id": "coffee", "kind": "coffeemaker", "at": [-1.15, 1.35], "facing": 0, "y": 0.92 },
        { "id": "kitchen-table", "kind": "table", "at": [-0.5, -0.75], "facing": 0, "size": [1.1, 0.72] },
        { "id": "kitchen-chair-1", "kind": "diningchair", "at": [-0.5, -0.05], "facing": 180 },
        { "id": "kitchen-chair-2", "kind": "diningchair", "at": [-0.5, -1.45], "facing": 0 },
        { "id": "kitchen-plant", "kind": "plant", "at": [1.6, 1.35], "facing": 0, "height": 0.55 },
        { "id": "kitchen-pendant", "kind": "pendant", "at": [-0.5, -0.75], "facing": 0 }
      ]
    },

    {
      "id": "porch",
      "name": "Porch",
      // Flush against the cabin's south wall rather than a doorway away from
      // it, so the decking meets the floorboards and there is nothing to trip
      // over on the way out. "outdoor" gives it decking and no room lights;
      // with no north wall of its own, the cabin's is what you step through.
      "origin": [1.3, 5.5],
      "size": [6.2, 3],
      "height": 2.7,
      "outdoor": true,
      "walls": ["south", "east", "west"],

      "openings": [
        // Railings: waist-high aprons with the whole opening above them, open
        // to the forest rather than glazed.
        { "wall": "south", "at": 0, "width": 5.4, "height": 1.75, "sill": 0.95, "kind": "window", "glazed": false },
        { "wall": "east", "at": 0, "width": 2.4, "height": 1.75, "sill": 0.95, "kind": "window", "glazed": false },
        { "wall": "west", "at": 0, "width": 2.4, "height": 1.75, "sill": 0.95, "kind": "window", "glazed": false }
      ],

      "shelves": [],

      // The cabin's south door is at world x = 2.6, and you step straight out
      // of it onto the decking — so the table and chairs sit west of it rather
      // than in front of it.
      "furniture": [
        { "id": "porch-table", "kind": "table", "at": [-0.3, 0.2], "facing": 0, "size": [1.0, 0.8] },
        { "id": "porch-chair-1", "kind": "diningchair", "at": [-0.3, 1.0], "facing": 180 },
        { "id": "porch-chair-2", "kind": "diningchair", "at": [-0.3, -0.6], "facing": 0 },
        { "id": "porch-bench", "kind": "bench", "at": [-2.1, 0.2], "facing": 90 },
        { "id": "porch-plant", "kind": "plant", "at": [2.6, -0.9], "facing": 0, "height": 0.7 },
        { "id": "porch-lamp", "kind": "pendant", "at": [-0.3, 0.2], "facing": 0, "y": 2.2, "on": false }
      ]
    }
  ]
}
`
