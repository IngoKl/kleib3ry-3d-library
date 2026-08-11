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
 * their walls sit flush and a door in each makes one short doorway.
 */
export const DEFAULT_WORLD_TEXT = `{
  // Your library. Edit this file and the room reloads as you save it.
  // If an edit is wrong the room you are standing in keeps running and the
  // problem is reported in the panel, so you cannot break your library by
  // mistyping in here.
  "schemaVersion": 1,
  "name": "My Library",

  // Where you stand when the library opens.
  "spawn": { "room": "main", "at": [0, 2.1], "facing": 0 },

  "rooms": [
    {
      "id": "main",
      "name": "Main room",
      // Centre of the room in world metres, then width (X) by depth (Z).
      "origin": [0, 0],
      "size": [8, 6],
      "height": 3.2,

      "openings": [
        // "at" is measured from the middle of that wall.
        { "wall": "north", "at": 0, "width": 2.6, "height": 1.5, "sill": 0.9, "kind": "window" },
        // Doors need a matching door in the next room's facing wall.
        { "wall": "east", "at": 0, "width": 1.1, "height": 2.05, "sill": 0, "kind": "door" }
      ],

      // Bookcases. The "id" is what your book layout is keyed by: move a shelf
      // and its books move with it, but rename or delete one and its books are
      // packed into the boxes on the floor rather than being reshuffled.
      "shelves": [
        { "id": "west-0", "at": [-3.835, -1.9], "facing": 90, "rows": 5 },
        { "id": "west-1", "at": [-3.835, -0.95], "facing": 90, "rows": 5 },
        { "id": "west-2", "at": [-3.835, 0], "facing": 90, "rows": 5 },
        { "id": "west-3", "at": [-3.835, 0.95], "facing": 90, "rows": 5 },
        { "id": "west-4", "at": [-3.835, 1.9], "facing": 90, "rows": 5 },

        { "id": "east-0", "at": [3.835, -2.0], "facing": 270, "rows": 5 },
        { "id": "east-1", "at": [3.835, -1.05], "facing": 270, "rows": 5 },
        { "id": "east-2", "at": [3.835, 1.05], "facing": 270, "rows": 5 },
        { "id": "east-3", "at": [3.835, 2.0], "facing": 270, "rows": 5 },

        { "id": "north-0", "at": [-2.76, -2.835], "facing": 0, "rows": 5 },
        { "id": "north-1", "at": [-1.81, -2.835], "facing": 0, "rows": 5 },
        { "id": "north-2", "at": [1.81, -2.835], "facing": 0, "rows": 5 },
        { "id": "north-3", "at": [2.76, -2.835], "facing": 0, "rows": 5 }
      ],

      // Books with nowhere to go end up in these. Add more if you run out.
      "furniture": [
        { "id": "box-1", "kind": "box", "at": [-2.7, 2.4], "facing": 8 },
        { "id": "box-2", "kind": "box", "at": [-2.1, 2.5], "facing": -6 },
        { "id": "box-3", "kind": "box", "at": [-1.4, 2.38], "facing": 3 },
        { "id": "box-4", "kind": "box", "at": [-2.4, 1.85], "facing": -12 }
      ]
    },

    {
      "id": "reading",
      "name": "Reading corner",
      // 4 (the main room's edge) + 0.24 (two wall thicknesses) + 2.5 (half of 5).
      "origin": [6.74, 0],
      "size": [5, 5],
      "height": 3.0,

      "openings": [
        { "wall": "west", "at": 0, "width": 1.1, "height": 2.05, "sill": 0, "kind": "door" },
        { "wall": "east", "at": 0, "width": 1.8, "height": 1.4, "sill": 0.85, "kind": "window" }
      ],

      "shelves": [
        { "id": "reading-n0", "at": [-1.2, -2.335], "facing": 0, "rows": 5 },
        { "id": "reading-n1", "at": [-0.25, -2.335], "facing": 0, "rows": 5 },
        { "id": "reading-s0", "at": [-1.2, 2.335], "facing": 180, "rows": 5 },
        { "id": "reading-s1", "at": [-0.25, 2.335], "facing": 180, "rows": 5 }
      ],

      // Kept clear of the line you walk in on, which runs from the door at
      // local x = -2.5 straight across at z = 0. A footstool in a doorway is
      // exactly the sort of thing you only notice by walking into it.
      "furniture": [
        { "id": "rug", "kind": "rug", "at": [1.0, 0.3], "facing": 0, "size": [2.6, 2.4] },
        { "id": "chair", "kind": "armchair", "at": [1.55, 0.25], "facing": 265 },
        { "id": "stool", "kind": "footstool", "at": [0.78, 0.45], "facing": 265 },
        { "id": "table", "kind": "sidetable", "at": [1.6, 1.35], "facing": 0 },
        { "id": "lamp", "kind": "floorlamp", "at": [1.75, -0.95], "facing": 0 }
      ]
    }
  ]
}
`
